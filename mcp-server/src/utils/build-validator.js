import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

class BuildValidator {
  constructor() {
    this.maxAttempts = 3;
  }

  /**
   * Main validation loop - build, check errors, fix with LLM if needed
   * Adapted from SynthAI's llm-build-validator.js
   */
  async validateAndFix(projectPath, taskDescription, apiKey) {
    let attempt = 0;
    
    console.log(`[Build Validator] Starting validation for project: ${projectPath}`);
    
    // First, clean up any stale .next directory
    await this.cleanupIncompleteBuilds(projectPath);
    
    while (attempt < this.maxAttempts) {
      attempt++;
      
      console.log(`[Build Validator] Attempt ${attempt}/${this.maxAttempts}...`);
      
      // Run build and capture output
      const buildResult = await this.runBuild(projectPath);
      
      if (buildResult.success) {
        console.log('[Build Validator] Build successful!');
        return {
          success: true,
          attempts: attempt
        };
      }
      
      console.log('[Build Validator] Build failed, analyzing errors...');
      
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
          const fixes = await this.getFixesFromLLM(buildResult.output, taskDescription, projectPath, apiKey);
          
          if (fixes && fixes.files && fixes.files.length > 0) {
            console.log(`[Build Validator] Applying ${fixes.files.length} AI fixes...`);
            
            // Apply fixes
            for (const file of fixes.files) {
              const filePath = path.join(projectPath, file.path);
              
              // Create directory if needed
              await fs.mkdir(path.dirname(filePath), { recursive: true });
              
              // Write fixed content
              await fs.writeFile(filePath, file.content, 'utf-8');
              
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
    
    return {
      success: false,
      attempts: attempt,
      message: 'Build validation failed but project was generated'
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
          CI: 'true',
          FORCE_COLOR: '0'
        },
        shell: true
      });

      let output = '';
      let hasErrors = false;

      buildProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        
        // Check for error indicators
        if (chunk.includes('Failed to compile') || 
            chunk.includes('Module parse failed') ||
            chunk.includes('Type error:') ||
            chunk.includes('Error:') ||
            chunk.includes('tailwindcss') && chunk.includes('PostCSS') ||
            chunk.includes("It looks like you're trying to use") ||
            chunk.includes("Package subpath './nesting' is not defined") ||
            chunk.includes('An error occurred in')) {
          hasErrors = true;
        }
      });

      buildProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        hasErrors = true;
      });

      buildProcess.on('close', (code) => {
        resolve({
          success: code === 0 && !hasErrors,
          output: output,
          exitCode: code
        });
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        buildProcess.kill();
        resolve({
          success: false,
          output: output + '\n[Build Validator] Build timed out',
          exitCode: -1
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
            const tailwindDep = packageJson.dependencies?.tailwindcss || packageJson.devDependencies?.tailwindcss;
            if (tailwindDep) {
              const versionMatch = tailwindDep.match(/[~^]?(\d+)\./);
              if (versionMatch) {
                tailwindVersion = parseInt(versionMatch[1]);
              }
              // Special check for v4 alpha/beta versions
              if (tailwindDep.includes('4.0.0-alpha') || tailwindDep.includes('4.0.0-beta') || tailwindDep.includes('^4.')) {
                tailwindVersion = 4;
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
  async getFixesFromLLM(buildOutput, taskDescription, projectPath, apiKey) {
    try {
      const anthropic = new Anthropic({ apiKey });
      
      // Extract the most relevant error information
      const errorSummary = this.extractErrorSummary(buildOutput);
      
      const prompt = `You are fixing build errors in a Next.js project.

Task that was implemented: ${taskDescription}

Build errors:
${errorSummary}

Analyze these errors and provide fixes. Return ONLY a valid JSON object with this structure:
{
  "files": [
    {
      "path": "src/components/Counter.tsx",
      "content": "// Complete fixed file content here"
    }
  ],
  "summary": "Brief description of fixes applied"
}

Important:
- Return complete file contents, not partial updates
- Ensure all syntax errors are fixed
- Add 'use client' directive where needed
- Fix any import/export issues
- Return ONLY the JSON object, no explanations`;

      const message = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });
      
      const responseText = message.content[0].text;
      
      // Parse the response
      try {
        return JSON.parse(responseText);
      } catch (error) {
        // Try extracting JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        throw new Error('Could not parse LLM response');
      }
    } catch (error) {
      console.error('[Build Validator] LLM error:', error.message);
      throw error;
    }
  }

  /**
   * Extract the most relevant error information from build output
   */
  extractErrorSummary(buildOutput) {
    const lines = buildOutput.split('\n');
    const errorLines = [];
    let inError = false;
    let errorCount = 0;
    const maxErrors = 5; // Limit to prevent token overflow
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Start of error
      if (line.includes('Failed to compile') ||
          line.includes('Module parse failed') ||
          line.includes('Type error:') ||
          line.includes('Error:') ||
          line.includes('./src/')) {
        inError = true;
        errorCount++;
      }
      
      // Capture error context
      if (inError) {
        errorLines.push(line);
        
        // Look for end of error (empty line or new file)
        if (line.trim() === '' || (i < lines.length - 1 && lines[i + 1].includes('./src/'))) {
          inError = false;
          errorLines.push(''); // Add separator
        }
      }
      
      // Stop if we have enough errors
      if (errorCount >= maxErrors) {
        break;
      }
    }
    
    return errorLines.join('\n');
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