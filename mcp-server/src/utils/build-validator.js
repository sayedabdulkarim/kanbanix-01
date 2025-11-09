import { spawn, execSync } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

class BuildValidator {
  constructor(options = {}) {
    // Configuration with defaults
    this.maxAttempts = options.maxAttempts || parseInt(process.env.BUILD_VALIDATION_MAX_ATTEMPTS) || 3;
    this.restoreOnFail = options.restoreOnFail !== false && process.env.BUILD_VALIDATION_RESTORE_ON_FAIL !== 'false';
    this.debugMode = options.debugMode || process.env.BUILD_VALIDATION_DEBUG_MODE === 'true';
    this.mode = options.mode || process.env.BUILD_VALIDATION_MODE || 'smart'; // smart | strict | skip
    
    // Internal state
    this.originalFiles = new Map(); // Track original file contents
    this.fixHistory = []; // Track all fixes applied
    
    if (this.debugMode) {
      console.log('[Build Validator] Debug mode enabled');
      console.log('[Build Validator] Configuration:', {
        maxAttempts: this.maxAttempts,
        restoreOnFail: this.restoreOnFail,
        mode: this.mode
      });
    }
  }

  /**
   * Debug logging helper
   */
  debug(message, data = null) {
    if (this.debugMode) {
      console.log(`[Build Validator DEBUG] ${message}`);
      if (data) {
        console.log('[Build Validator DEBUG] Data:', JSON.stringify(data, null, 2));
      }
    }
  }

  /**
   * Detect if we're in a fix loop (same files being modified repeatedly)
   */
  isInFixLoop(filePath, attempt) {
    // Check if the same file has been modified in the last 2 attempts
    const recentFixes = this.fixHistory.filter(fix => 
      fix.filePath === filePath && fix.attempt >= attempt - 1
    );
    
    if (recentFixes.length >= 2) {
      console.log(`[Build Validator] Detected fix loop for ${filePath}, stopping...`);
      return true;
    }
    return false;
  }

  /**
   * Backup a file before modifying it
   */
  async backupFile(filePath) {
    if (!this.originalFiles.has(filePath)) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        this.originalFiles.set(filePath, content);
        console.log(`[Build Validator] Backed up: ${path.relative(process.cwd(), filePath)}`);
      } catch (error) {
        // File doesn't exist yet, no need to backup
      }
    }
  }

  /**
   * Restore original files if build validation fails completely
   */
  async restoreOriginalFiles() {
    console.log('[Build Validator] Restoring original files...');
    for (const [filePath, content] of this.originalFiles.entries()) {
      try {
        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`[Build Validator] Restored: ${path.relative(process.cwd(), filePath)}`);
      } catch (error) {
        console.error(`[Build Validator] Failed to restore ${filePath}:`, error.message);
      }
    }
  }

  /**
   * Ensure dependencies are installed before running build
   * Prevents exit code 127 "command not found" errors
   */
  async ensureDependenciesInstalled(projectPath) {
    console.log('[BuildValidator] Checking dependencies...');

    // Step 1: Check if node_modules exists
    const nodeModulesPath = path.join(projectPath, 'node_modules');
    const nodeModulesExists = fsSync.existsSync(nodeModulesPath);

    if (nodeModulesExists) {
      console.log('[BuildValidator] ✅ node_modules found');
      return; // Dependencies already installed, exit early
    }

    // Step 2: Check if package.json exists
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJsonExists = fsSync.existsSync(packageJsonPath);

    if (!packageJsonExists) {
      console.log('[BuildValidator] ⚠️ No package.json found, skipping install');
      return; // Not a Node.js project
    }

    // Step 3: Detect which package manager to use
    const yarnLockPath = path.join(projectPath, 'yarn.lock');
    const packageLockPath = path.join(projectPath, 'package-lock.json');
    const pnpmLockPath = path.join(projectPath, 'pnpm-lock.yaml');

    let installCommand;
    if (fsSync.existsSync(yarnLockPath)) {
      installCommand = 'yarn install';
      console.log('[BuildValidator] Detected yarn.lock → using yarn');
    } else if (fsSync.existsSync(pnpmLockPath)) {
      installCommand = 'pnpm install';
      console.log('[BuildValidator] Detected pnpm-lock.yaml → using pnpm');
    } else {
      installCommand = 'npm install';
      console.log('[BuildValidator] Using npm (default)');
    }

    // Step 4: Run installation
    console.log(`[BuildValidator] Running: ${installCommand}`);
    console.log('[BuildValidator] This may take a moment...');

    try {
      execSync(installCommand, {
        cwd: projectPath,
        stdio: 'inherit', // Show installation progress
        timeout: 300000 // 5 minute timeout
      });

      console.log('[BuildValidator] ✅ Dependencies installed successfully');
    } catch (error) {
      console.error('[BuildValidator] ❌ Failed to install dependencies:', error.message);
      throw new Error(`Dependency installation failed: ${error.message}`);
    }
  }

  /**
   * Main validation loop - build, check errors, fix with LLM if needed
   * Adapted from SynthAI's llm-build-validator.js
   */
  async validateAndFix(projectPath, taskDescription, apiKey) {
    // Skip mode - return success immediately
    if (this.mode === 'skip') {
      console.log('[Build Validator] Skip mode enabled, bypassing validation');
      return {
        success: true,
        attempts: 0,
        skipped: true
      };
    }
    
    let attempt = 0;
    let lastMainError = null;
    let stuckCount = 0;
    
    console.log(`[Build Validator] Starting validation for project: ${projectPath} (mode: ${this.mode})`);
    this.debug('Task description', taskDescription);

    // Skip cleanup when dev server might be running
    // Dev servers need their build folders (.next, dist, etc.) to serve pages
    // Only clean if explicitly requested or if we detect no dev server
    if (this.mode === 'strict' && !process.env.DEV_SERVER_RUNNING) {
      await this.cleanupIncompleteBuilds(projectPath);
    }

    // NEW: Ensure dependencies are installed before attempting build
    // This prevents exit code 127 "command not found" errors
    await this.ensureDependenciesInstalled(projectPath);

    while (attempt < this.maxAttempts) {
      attempt++;
      
      console.log(`[Build Validator] Attempt ${attempt}/${this.maxAttempts}...`);
      
      // Clean build cache before each attempt to prevent stale errors
      // This ensures we don't get errors from previously generated files
      const nextDir = path.join(projectPath, '.next');
      if (fsSync.existsSync(nextDir)) {
        console.log('[Build Validator] Cleaning .next directory before build attempt...');
        await fs.rm(nextDir, { recursive: true, force: true });
      }
      
      // Run build and capture output
      const buildResult = await this.runBuild(projectPath);
      
      if (buildResult.success) {
        console.log('[Build Validator] Build successful! (exit code: 0)');
        return {
          success: true,
          attempts: attempt,
          exitCode: buildResult.exitCode
        };
      }
      
      // Check if it's just warnings (exit code 0 but we detected something)
      if (buildResult.exitCode === 0) {
        console.log('[Build Validator] Build completed with warnings (exit code: 0)');
        return {
          success: true,
          attempts: attempt,
          hasWarnings: true,
          exitCode: 0
        };
      }
      
      // Following Micro Agent pattern: if exit code is not 0, it needs fixing
      // No need to filter or categorize errors
      if (!buildResult.hasRealErrors) {
        // This should rarely happen now since hasRealErrors = (exitCode !== 0)
        console.log('[Build Validator] Unexpected state: exit code indicates failure but no errors detected');
      }
      
      console.log('[Build Validator] Build failed with real errors (exit code:', buildResult.exitCode, ')');
      
      // Check if we're stuck on the same error (use stderr for real errors)
      const currentMainError = this.extractMainError(buildResult.stderr || buildResult.output);
      this.debug('Extracted main error', currentMainError);
      
      if (currentMainError && lastMainError && 
          currentMainError.type === lastMainError.type && 
          currentMainError.module === lastMainError.module &&
          currentMainError.file === lastMainError.file) {
        stuckCount++;
        console.log(`[Build Validator] Same error detected (${stuckCount} times): ${currentMainError.type}`);
        
        if (stuckCount >= 2) {
          console.log('[Build Validator] Stuck on same error after 2 attempts, stopping...');
          break;
        }
      } else {
        stuckCount = 0;
      }
      lastMainError = currentMainError;
      
      // Try quick fixes for common errors
      const quickFixes = await this.applyQuickFixes(buildResult.output, projectPath);
      
      if (quickFixes.length > 0) {
        console.log(`[Build Validator] Applied ${quickFixes.length} quick fixes`);
        // Try building again after quick fixes
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      // If no quick fixes or still failing, use LLM to fix
      if (apiKey) {
        try {
          console.log('[Build Validator] Using AI to fix build errors...');
          // Pass stderr for real errors, or output if stderr is empty
          const errorOutput = buildResult.stderr || buildResult.output;
          const fixes = await this.getFixesFromLLM(errorOutput, taskDescription, projectPath, apiKey, currentMainError);
          
          if (fixes && fixes.files && fixes.files.length > 0) {
            // Limit the number of files to fix in one attempt (prevent over-fixing)
            const maxFixesPerAttempt = 5;
            if (fixes.files.length > maxFixesPerAttempt) {
              console.log(`[Build Validator] Limiting fixes from ${fixes.files.length} to ${maxFixesPerAttempt} files`);
              fixes.files = fixes.files.slice(0, maxFixesPerAttempt);
            }
            
            console.log(`[Build Validator] Applying ${fixes.files.length} AI fixes...`);
            
            // Apply fixes
            for (const file of fixes.files) {
              const filePath = path.join(projectPath, file.path);
              
              // Check for fix loops
              if (this.isInFixLoop(file.path, attempt)) {
                console.log(`[Build Validator] Skipping ${file.path} due to fix loop`);
                continue;
              }
              
              // Backup file before modifying
              await this.backupFile(filePath);
              
              // Create directory if needed
              await fs.mkdir(path.dirname(filePath), { recursive: true });
              
              // Unescape the content - convert literal \n to actual newlines
              const unescapedContent = file.content
                .replace(/\\n/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\r/g, '\r')
                .replace(/\\\\/g, '\\');
              
              // Track this fix in history
              this.fixHistory.push({
                attempt,
                filePath: file.path,
                timestamp: new Date().toISOString(),
                summary: fixes.summary || 'AI fix applied'
              });
              
              // Write fixed content
              await fs.writeFile(filePath, unescapedContent, 'utf-8');
              
              console.log(`[Build Validator] Fixed: ${file.path}`);
            }
            
            // Add a small delay before next attempt
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            console.log('[Build Validator] No fixes could be generated.');
            break;
          }
        } catch (error) {
          console.error('[Build Validator] LLM fix generation failed:', error.message);
          break;
        }
      } else {
        console.log('[Build Validator] No API key provided, skipping AI fixes');
        break;
      }
    }
    
    // Failed after all attempts
    console.log('[Build Validator] Validation failed after maximum attempts');
    
    // Optionally restore original files if build is worse than before
    if (this.restoreOnFail && this.originalFiles.size > 0) {
      console.log('[Build Validator] Restoring original files due to validation failure...');
      await this.restoreOriginalFiles();
    }
    
    // Log fix history for debugging
    if (this.fixHistory.length > 0) {
      this.debug('Fix history', this.fixHistory);
      if (!this.debugMode) {
        console.log(`[Build Validator] ${this.fixHistory.length} fix attempts were made`);
      }
    }
    
    return {
      success: false,
      attempts: attempt,
      message: this.restoreOnFail ? 
        'Build validation failed, original files restored' : 
        'Build validation failed but project was generated',
      fixHistory: this.debugMode ? this.fixHistory : undefined
    };
  }

  /**
   * Run Next.js build and capture all output
   */
  async runBuild(projectPath) {
    return new Promise((resolve) => {
      const buildProcess = spawn('npm', ['run', 'build'], {
        cwd: projectPath,
        env: {
          ...process.env,
          NODE_ENV: 'production',  // Explicitly set to production for build
          FORCE_COLOR: '0'  // Removed CI: 'true' to match manual build behavior
        },
        shell: true
      });

      let stdout = '';
      let stderr = '';
      let timeoutId;

      buildProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        this.debug('Build stdout:', chunk.substring(0, 200));
      });

      buildProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        this.debug('Build stderr:', chunk.substring(0, 200));
      });

      buildProcess.on('close', (code) => {
        clearTimeout(timeoutId);
        
        // Follow Micro Agent approach: Trust the exit code completely
        const exitCodeSuccess = code === 0;
        
        // If exit code is not 0, there are real errors - no filtering needed
        // This matches how Micro Agent and Claude handle errors
        let hasRealErrors = !exitCodeSuccess;
        
        resolve({
          success: exitCodeSuccess,
          stdout,
          stderr,
          output: stdout + '\n' + stderr, // Keep for backwards compatibility
          exitCode: code,
          hasRealErrors
        });
      });

      // Timeout after 60 seconds
      timeoutId = setTimeout(() => {
        buildProcess.kill();
        resolve({
          success: false,
          stdout,
          stderr,
          output: stdout + '\n' + stderr + '\n[Build Validator] Build timed out',
          exitCode: -1,
          hasRealErrors: true
        });
      }, 60000);
    });
  }

  /**
   * Apply quick fixes for common errors (from SynthAI)
   */
  async applyQuickFixes(buildOutput, projectPath) {
    const fixes = [];
    
    // Fix 0: Tailwind CSS v4 PostCSS compatibility issue
    if (buildOutput.includes("It looks like you're trying to use `tailwindcss` directly as a PostCSS plugin") ||
        buildOutput.includes("Package subpath './nesting' is not defined")) {
      console.log('[Build Validator] Fixing Tailwind CSS PostCSS configuration...');
      
      try {
        // First, detect which version of Tailwind is installed
        let tailwindVersion = 3; // Default to v3
        let packageJson = null;
        
        try {
          const packageJsonPath = path.join(projectPath, 'package.json');
          packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
          
          // Check actual installed version in node_modules if available
          try {
            const tailwindPackagePath = path.join(projectPath, 'node_modules', 'tailwindcss', 'package.json');
            const tailwindPackage = JSON.parse(await fs.readFile(tailwindPackagePath, 'utf-8'));
            const installedVersion = tailwindPackage.version;
            tailwindVersion = parseInt(installedVersion.split('.')[0]);
            console.log(`[Build Validator] Detected installed Tailwind CSS v${installedVersion}`);
          } catch (e) {
            // If can't read from node_modules, check package.json dependency
            // First check for @tailwindcss/postcss - definitive sign of v4
            const hasTailwindPostCSS = packageJson.dependencies?.['@tailwindcss/postcss'] || 
                                       packageJson.devDependencies?.['@tailwindcss/postcss'];
            
            if (hasTailwindPostCSS) {
              tailwindVersion = 4;
              console.log('[Build Validator] Detected Tailwind v4 via @tailwindcss/postcss package');
            } else {
              const tailwindDep = packageJson.dependencies?.tailwindcss || packageJson.devDependencies?.tailwindcss;
              if (tailwindDep) {
                const versionMatch = tailwindDep.match(/[~^]?(\d+)\./);
                if (versionMatch) {
                  tailwindVersion = parseInt(versionMatch[1]);
                }
                // Special check for v4 versions
                if (tailwindDep.includes('^4') || tailwindDep.includes('~4') || tailwindDep.match(/^4\./)) {
                  tailwindVersion = 4;
                }
              }
            }
          }
        } catch (e) {
          console.log('[Build Validator] Could not determine Tailwind version, defaulting to v3');
        }
        
        const postcssConfigPath = path.join(projectPath, 'postcss.config.js');
        
        if (tailwindVersion >= 4) {
          // Tailwind v4 requires @tailwindcss/postcss
          console.log('[Build Validator] Applying Tailwind CSS v4 PostCSS configuration...');
          
          // Install @tailwindcss/postcss if not present
          if (packageJson && !packageJson.devDependencies?.['@tailwindcss/postcss']) {
            console.log('[Build Validator] Installing @tailwindcss/postcss...');
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            
            try {
              const installer = packageJson.packageManager?.includes('yarn') ? 'yarn' : 'npm';
              const installCmd = installer === 'yarn' ? 'add --dev' : 'install --save-dev';
              await execAsync(`${installer} ${installCmd} @tailwindcss/postcss`, {
                cwd: projectPath
              });
              console.log('[Build Validator] @tailwindcss/postcss installed successfully');
            } catch (installError) {
              console.warn('[Build Validator] Failed to install @tailwindcss/postcss:', installError.message);
            }
          }
          
          // Write v4 PostCSS config
          const postcssConfig = `/** @type {import('postcss-load-config').Config} */
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}`;
          await fs.writeFile(postcssConfigPath, postcssConfig, 'utf-8');
          fixes.push('Updated PostCSS config for Tailwind CSS v4 compatibility');
        } else {
          // Tailwind v3 configuration
          console.log('[Build Validator] Applying Tailwind CSS v3 PostCSS configuration...');
          const postcssConfig = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`;
          await fs.writeFile(postcssConfigPath, postcssConfig, 'utf-8');
          fixes.push('Updated PostCSS config for Tailwind CSS v3 compatibility');
        }
        
        // Ensure tailwind.config.js exists
        const tailwindConfigPath = path.join(projectPath, 'tailwind.config.js');
        try {
          await fs.access(tailwindConfigPath);
        } catch {
          // Create a basic Tailwind config
          const tailwindConfig = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}`;
          await fs.writeFile(tailwindConfigPath, tailwindConfig, 'utf-8');
          fixes.push(`Created Tailwind CSS configuration`);
        }
      } catch (err) {
        console.error('[Build Validator] Error fixing Tailwind config:', err);
      }
    }
    
    // Fix 1: Missing 'use client' directive
    if (buildOutput.includes("You're importing a component that needs") ||
        buildOutput.includes("useState") && buildOutput.includes("Server Component")) {
      console.log('[Build Validator] Applying "use client" fixes...');
      
      // Find files mentioned in error
      const fileMatches = buildOutput.match(/\.\/src\/[^\s:]+\.(tsx?|jsx?)/g) || [];
      
      for (const file of fileMatches) {
        const filePath = path.join(projectPath, file.replace('./', ''));
        
        try {
          let content = await fs.readFile(filePath, 'utf-8');
          
          // Add 'use client' if not present
          if (!content.includes('use client')) {
            content = "'use client';\n\n" + content;
            await fs.writeFile(filePath, content, 'utf-8');
            fixes.push(`Added 'use client' to ${file}`);
          }
        } catch (err) {
          // File doesn't exist or can't be read
        }
      }
    }
    
    // Fix 2: TypeScript type errors - convert to .js
    if (buildOutput.includes('Type error:')) {
      console.log('[Build Validator] Converting TypeScript files to JavaScript...');
      
      const tsFiles = buildOutput.match(/\.\/src\/[^\s:]+\.tsx?/g) || [];
      
      for (const tsFile of tsFiles) {
        const oldPath = path.join(projectPath, tsFile.replace('./', ''));
        const newPath = oldPath.replace(/\.tsx?$/, '.js');
        
        try {
          let content = await fs.readFile(oldPath, 'utf-8');
          
          // Remove TypeScript-specific syntax
          content = content
            .replace(/: React\.FC[^=]*/g, '')
            .replace(/: any/g, '')
            .replace(/: string/g, '')
            .replace(/: number/g, '')
            .replace(/: boolean/g, '')
            .replace(/interface \w+ \{[^}]+\}/g, '')
            .replace(/type \w+ = [^;]+;/g, '');
          
          await fs.writeFile(newPath, content, 'utf-8');
          
          // Delete old TS file if different
          if (oldPath !== newPath) {
            await fs.unlink(oldPath);
            fixes.push(`Converted ${tsFile} to JavaScript`);
          }
        } catch (err) {
          // File doesn't exist
        }
      }
    }
    
    return fixes;
  }

  /**
   * Send build errors to LLM and get fixes
   */
  async getFixesFromLLM(buildOutput, taskDescription, projectPath, apiKey, currentMainError = null) {
    try {
      const anthropic = new Anthropic({ apiKey });
      
      // Extract the most relevant error information
      const errorSummary = this.extractErrorSummary(buildOutput);
      
      // Ensure errorSummary is safe for the prompt
      const safeErrorSummary = errorSummary.substring(0, 2000); // Limit error summary length
      const safeBuildOutput = buildOutput.substring(0, 4000); // Include more build output like SynthAI
      
      // Detect existing project structure to provide context
      const projectStructure = await this.detectProjectStructure(projectPath);
      
      // Following SynthAI's pattern with system prompt
      const systemPrompt = `You are an expert developer fixing build errors in a JavaScript/TypeScript project.

YOUR PRIMARY GOAL: Fix ONLY the specific errors mentioned, preserving all existing functionality.

CRITICAL RULES:
1. MINIMAL CHANGES ONLY
   - Fix only the specific errors mentioned
   - Do NOT rewrite entire files
   - Preserve ALL existing code that isn't causing errors
   - Keep the original structure and logic intact

2. PROJECT STRUCTURE AWARENESS
   - NEVER create files in pages/ if app/ exists
   - NEVER create files in app/ if pages/ exists
   - Respect the existing routing system (App Router vs Pages Router)
   
3. IMPORT AND DEPENDENCY RULES
   - Add missing imports for undefined variables
   - Use existing dependencies from package.json
   - NEVER add new external dependencies
   
4. PRESERVE EXISTING CODE
   - Keep all existing components, functions, and logic
   - Maintain existing styling and class names
   - Preserve framework-specific directives ('use client', 'use server', etc.)
   
5. OUTPUT FORMAT
   - Return ONLY valid JSON
   - Include complete file content (not patches)
   - Explain what specific fix was applied in summary

PROJECT STRUCTURE DETECTED:
${projectStructure}

IMPORTANT: You have access to the current file contents below. Use them as the base and make MINIMAL modifications.`;

      // Read current file contents for files mentioned in errors
      const errorFiles = this.extractFilesFromErrors(safeBuildOutput);
      let currentFileContents = '';
      
      // Read error files with more context
      for (const filePath of errorFiles) {
        try {
          const fullPath = path.join(projectPath, filePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          currentFileContents += `\n### Current content of ${filePath}:\n\`\`\`typescript\n${content}\n\`\`\`\n`;
        } catch (e) {
          // File doesn't exist yet
          currentFileContents += `\n### File ${filePath} does not exist yet\n`;
        }
      }
      
      // Also read package.json for dependency context
      try {
        const packageJsonPath = path.join(projectPath, 'package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        currentFileContents += `\n### Dependencies from package.json:\n\`\`\`json\n${JSON.stringify({
          dependencies: packageJson.dependencies || {},
          devDependencies: packageJson.devDependencies || {}
        }, null, 2)}\n\`\`\`\n`;
      } catch (e) {
        // No package.json
      }
      
      // Create structured prompt with XML-style tags (micro-agent inspired)
      const userPrompt = `Fix the build errors in this project.

<task-description>
${taskDescription || 'No specific task description provided'}
</task-description>

<main-error>
${currentMainError ? JSON.stringify(currentMainError, null, 2) : 'No specific error extracted'}
</main-error>

<error-summary>
${safeErrorSummary}
</error-summary>

<package-json>
${currentFileContents.includes('Dependencies from package.json') ? 
  currentFileContents.split('### Dependencies from package.json:')[1].split('```')[1] : 
  'No package.json found'}
</package-json>

<project-structure>
${projectStructure}
</project-structure>

<files-with-errors>
${currentFileContents || 'No existing files found for the errors mentioned.'}
</files-with-errors>

<build-output>
${safeBuildOutput}
</build-output>

<instructions>
1. Fix ONLY the specific errors mentioned above
2. Use the existing file contents in <files-with-errors> as your base
3. Make MINIMAL changes - do not refactor or improve unrelated code
4. Common fixes needed:
   - Add missing imports at the top of files
   - Fix syntax errors (missing brackets, semicolons)
   - Add proper TypeScript types
   - Remove conflicting route files
5. Preserve ALL existing functionality
6. Maintain 'use client' and 'use server' directives
7. Do NOT add new dependencies not in package.json
</instructions>

<output-format>
Return ONLY valid JSON:
{
  "files": [
    {
      "path": "src/app/layout.tsx",
      "content": "// Complete file content with minimal fixes"
    }
  ],
  "summary": "Specific fixes applied: [e.g., 'Added React import', 'Fixed unclosed bracket on line 15']"
}
</output-format>`;

      const message = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: userPrompt
        }]
      });
      
      const responseText = message.content[0].text;
      
      // Clean the response text before parsing
      const cleanedResponse = responseText
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
        .replace(/\\n/g, '\\\\n') // Escape newlines properly
        .replace(/\\r/g, '\\\\r') // Escape carriage returns
        .replace(/\\t/g, '\\\\t'); // Escape tabs
      
      // Parse the response
      try {
        // First try direct parsing
        return JSON.parse(cleanedResponse);
      } catch (error) {
        // Try extracting JSON from response
        const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            // Additional cleaning for extracted JSON
            const cleanJson = jsonMatch[0]
              .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
              .replace(/([^\\])\\n/g, '$1\\\\n')
              .replace(/([^\\])\\r/g, '$1\\\\r')
              .replace(/([^\\])\\t/g, '$1\\\\t');
            
            return JSON.parse(cleanJson);
          } catch (parseErr) {
            console.error('[Build Validator] Failed to parse extracted JSON:', parseErr);
            console.error('[Build Validator] Problematic JSON:', jsonMatch[0].substring(0, 200));
            // Return a minimal valid response to prevent complete failure
            return {
              files: [],
              summary: 'Could not parse LLM response, skipping auto-fix'
            };
          }
        }
        console.error('[Build Validator] No JSON found in LLM response');
        return {
          files: [],
          summary: 'No valid JSON in LLM response'
        };
      }
    } catch (error) {
      console.error('[Build Validator] LLM error:', error.message);
      throw error;
    }
  }

  /**
   * Extract the main error type and details for targeted fixing
   */
  extractMainError(buildOutput) {
    // Clean output first
    const cleanOutput = buildOutput
      .replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI color codes
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remove control characters

    // Priority 1: Missing imports/modules
    const importError = cleanOutput.match(/Cannot find module '([^']+)'|Cannot find name '([^']+)'/);
    if (importError) {
      const module = importError[1] || importError[2];
      const fileMatch = cleanOutput.match(/(?:in|at)\s+([^\s:]+\.[jt]sx?)/);
      return {
        type: 'missing_import',
        module,
        file: fileMatch ? fileMatch[1] : null,
        priority: 1
      };
    }

    // Priority 2: Syntax errors
    const syntaxError = cleanOutput.match(/SyntaxError:\s*(.+?)(?:\s+at\s+)?([^\s:]+\.[jt]sx?):?(\d+)?:?(\d+)?/);
    if (syntaxError) {
      return {
        type: 'syntax',
        message: syntaxError[1].trim(),
        file: syntaxError[2],
        line: syntaxError[3] || null,
        column: syntaxError[4] || null,
        priority: 1
      };
    }

    // Priority 3: Type errors
    const typeError = cleanOutput.match(/Type error:\s*(.+)/);
    if (typeError) {
      const message = typeError[1];
      const fileMatch = cleanOutput.match(/(?:\.\/)?([^\s:]+\.[jt]sx?)/);
      return {
        type: 'type_error',
        message,
        file: fileMatch ? fileMatch[1] : null,
        priority: 2
      };
    }

    // Priority 4: Conflicting route errors
    const conflictError = cleanOutput.match(/Conflicting\s+app\s+and\s+page(?:s)?\s+file/i);
    if (conflictError) {
      const fileMatch = cleanOutput.match(/(?:page|route):\s+([^\s]+)/);
      return {
        type: 'route_conflict',
        message: 'Conflicting app and pages routes',
        file: fileMatch ? fileMatch[1] : null,
        priority: 1
      };
    }

    // Priority 5: Module parse failed
    const parseError = cleanOutput.match(/Module parse failed:\s*(.+)/);
    if (parseError) {
      const fileMatch = cleanOutput.match(/File was processed with[^:]+:\s*([^\s]+)/);
      return {
        type: 'parse_error',
        message: parseError[1],
        file: fileMatch ? fileMatch[1] : null,
        priority: 1
      };
    }

    return null;
  }

  /**
   * Extract file paths mentioned in errors
   */
  extractFilesFromErrors(buildOutput) {
    const files = new Set();
    const filePattern = /(?:\.\/)?(?:src\/|app\/|pages\/|components\/)[^\s:]+\.[jt]sx?/g;
    const matches = buildOutput.match(filePattern) || [];
    matches.forEach(match => {
      // Clean up the path
      const cleanPath = match.replace(/^\.\//, '');
      files.add(cleanPath);
    });
    return Array.from(files);
  }
  
  /**
   * Extract the most relevant error information from build output
   */
  extractErrorSummary(buildOutput) {
    // First, clean up ANSI color codes and control characters
    const cleanOutput = buildOutput
      .replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI color codes
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters except \n and \r
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\r/g, '\n');
    
    const lines = cleanOutput.split('\n');
    const errors = [];
    let currentError = [];
    let inError = false;
    let errorCount = 0;
    const maxErrors = 3; // Limit to prevent token overflow
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines unless we're in an error
      if (!line && !inError) continue;
      
      // Start of error indicators
      if (line.includes('Failed to compile') ||
          line.includes('Module parse failed') ||
          line.includes('Type error:') ||
          line.includes('Error:') ||
          line.includes('SyntaxError:') ||
          (line.includes('./src/') && line.includes(':'))) {
        
        // Save previous error if exists
        if (currentError.length > 0) {
          errors.push(currentError.join(' ').substring(0, 500)); // Limit each error to 500 chars
          currentError = [];
          errorCount++;
          if (errorCount >= maxErrors) break;
        }
        
        inError = true;
        currentError.push(line);
      } else if (inError) {
        // Continue capturing error details
        if (line) {
          currentError.push(line);
        }
        
        // End of error on empty line or new file reference
        if (!line || line.startsWith('./')) {
          inError = false;
        }
      }
    }
    
    // Don't forget the last error
    if (currentError.length > 0 && errorCount < maxErrors) {
      errors.push(currentError.join(' ').substring(0, 500));
    }
    
    // Create a clean summary for the LLM
    const summary = errors.map((error, idx) => {
      // Further sanitize for JSON safety
      const safeError = error
        .replace(/\\/g, '/') // Replace backslashes with forward slashes
        .replace(/"/g, "'") // Replace quotes with single quotes
        .replace(/[\n\r\t]/g, ' ') // Replace newlines and tabs with spaces
        .replace(/\s+/g, ' '); // Collapse multiple spaces
      
      return `Error ${idx + 1}: ${safeError}`;
    }).join(' | ');
    
    // Final safety check - ensure no control characters remain
    return summary.replace(/[\x00-\x1F\x7F]/g, '');
  }
  
  /**
   * Detect project structure and framework
   */
  async detectProjectStructure(projectPath) {
    const structure = [];
    
    try {
      // Check for package.json to understand dependencies
      const packageJsonPath = path.join(projectPath, 'package.json');
      let packageInfo = '';
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        // Detect framework from dependencies
        if (deps.next) {
          packageInfo += 'Framework: Next.js\n';
          // Check which routing system Next.js uses
          const hasAppDir = await fs.access(path.join(projectPath, 'app')).then(() => true).catch(() => false);
          const hasSrcAppDir = await fs.access(path.join(projectPath, 'src/app')).then(() => true).catch(() => false);
          const hasPagesDir = await fs.access(path.join(projectPath, 'pages')).then(() => true).catch(() => false);
          const hasSrcPagesDir = await fs.access(path.join(projectPath, 'src/pages')).then(() => true).catch(() => false);
          
          if (hasAppDir || hasSrcAppDir) {
            packageInfo += `Routing: App Router (${hasSrcAppDir ? 'src/app' : 'app'} directory)\n`;
            packageInfo += 'IMPORTANT: This project uses App Router. Do NOT create files in pages/ directory\n';
          } else if (hasPagesDir || hasSrcPagesDir) {
            packageInfo += `Routing: Pages Router (${hasSrcPagesDir ? 'src/pages' : 'pages'} directory)\n`;
            packageInfo += 'IMPORTANT: This project uses Pages Router. Do NOT create files in app/ directory\n';
          }
        } else if (deps.react && !deps.next) {
          packageInfo += 'Framework: React (not Next.js)\n';
        } else if (deps.vue) {
          packageInfo += 'Framework: Vue.js\n';
        } else if (deps['@angular/core']) {
          packageInfo += 'Framework: Angular\n';
        } else if (deps.svelte) {
          packageInfo += 'Framework: Svelte\n';
        } else {
          packageInfo += 'Framework: Plain JavaScript/TypeScript\n';
        }
        
        structure.push(packageInfo);
      } catch (e) {
        structure.push('No package.json found or could not parse it');
      }
      
      // List key directories that exist
      const importantDirs = ['src', 'app', 'pages', 'components', 'lib', 'utils', 'public', 'styles'];
      const existingDirs = [];
      
      for (const dir of importantDirs) {
        if (await fs.access(path.join(projectPath, dir)).then(() => true).catch(() => false)) {
          existingDirs.push(dir);
        }
        // Also check in src/
        if (await fs.access(path.join(projectPath, 'src', dir)).then(() => true).catch(() => false)) {
          existingDirs.push(`src/${dir}`);
        }
      }
      
      if (existingDirs.length > 0) {
        structure.push(`Existing directories: ${existingDirs.join(', ')}`);
      }
      
    } catch (e) {
      structure.push('Could not detect project structure');
    }
    
    return structure.join('\n');
  }
  
  /**
   * Clean up incomplete build artifacts
   */
  async cleanupIncompleteBuilds(projectPath) {
    const dirsToClean = ['.next', 'node_modules/.cache'];
    
    for (const dir of dirsToClean) {
      const dirPath = path.join(projectPath, dir);
      
      try {
        await fs.access(dirPath);
        console.log(`[Build Validator] Cleaning up ${dir}...`);
        await fs.rm(dirPath, { recursive: true, force: true });
        console.log(`[Build Validator] Cleaned ${dir}`);
      } catch (err) {
        // Directory doesn't exist, which is fine
      }
    }
  }
}

export default BuildValidator;