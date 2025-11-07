import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { buildSystemDetector } from './build-system-detector.js';
import { StubGenerator } from './stub-generator.js';
import TypeAwareGenerator from './type-aware-generator.js';
import { mcpConfig } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper function to apply intelligent file modifications
async function applyFileModifications(existingContent, newContent, modifications) {
  let result = existingContent;
  
  // Handle different modification types
  if (modifications.type === 'add_to_prisma_schema' || modifications.type === 'add_model') {
    // Add Prisma models to existing schema
    const newModels = modifications.models || modifications.content || newContent;
    
    // Check if the new content is already a complete schema
    if (newModels.includes('generator client') || newModels.includes('datasource db')) {
      // It's a complete schema, extract just the models
      const modelMatches = newModels.match(/model\s+\w+\s*{[^}]+}/gs) || [];
      if (modelMatches.length > 0) {
        // Append models to existing schema
        result = existingContent.trimEnd() + '\n\n' + modelMatches.join('\n\n') + '\n';
      } else {
        result = existingContent; // No models found, keep existing
      }
    } else {
      // It's just model definitions, append them
      result = existingContent.trimEnd() + '\n\n' + newModels + '\n';
    }
  } else if (modifications.type === 'add_imports') {
    // Add imports at the top of the file
    const imports = modifications.imports || [];
    const importStatements = imports.join('\n');
    
    // Check if imports already exist
    const missingImports = imports.filter(imp => !existingContent.includes(imp));
    if (missingImports.length > 0) {
      // Add after existing imports or at the top
      const importMatch = existingContent.match(/^(import .+\n)+/m);
      if (importMatch) {
        const lastImportIndex = importMatch.index + importMatch[0].length;
        result = existingContent.slice(0, lastImportIndex) + 
                missingImports.join('\n') + '\n' + 
                existingContent.slice(lastImportIndex);
      } else {
        result = missingImports.join('\n') + '\n\n' + existingContent;
      }
    }
  } else if (modifications.type === 'add_functions') {
    // Add functions to the file
    const functions = modifications.functions || [];
    for (const func of functions) {
      if (!existingContent.includes(func.name)) {
        // Add function before the last closing brace or at the end
        const lastBraceIndex = existingContent.lastIndexOf('}');
        if (lastBraceIndex !== -1) {
          result = existingContent.slice(0, lastBraceIndex) + 
                  '\n' + func.content + '\n' + 
                  existingContent.slice(lastBraceIndex);
        } else {
          result = existingContent + '\n\n' + func.content;
        }
      }
    }
  } else if (modifications.type === 'add_to_section') {
    // Add content to a specific section (like routes, middleware, etc.)
    const { section, content, marker } = modifications;
    
    if (marker && existingContent.includes(marker)) {
      // Insert after the marker
      const markerIndex = existingContent.indexOf(marker);
      const insertIndex = markerIndex + marker.length;
      result = existingContent.slice(0, insertIndex) + 
              '\n' + content + 
              existingContent.slice(insertIndex);
    } else if (section) {
      // Try to find the section by pattern
      const sectionPattern = new RegExp(`(${section}[^{]*{)`, 'i');
      const sectionMatch = existingContent.match(sectionPattern);
      if (sectionMatch) {
        const insertIndex = sectionMatch.index + sectionMatch[0].length;
        result = existingContent.slice(0, insertIndex) + 
                '\n  ' + content + 
                existingContent.slice(insertIndex);
      } else {
        // Append to end if section not found
        result = existingContent + '\n\n' + content;
      }
    }
  } else if (modifications.type === 'merge_objects') {
    // For JSON or object files, merge the objects
    try {
      const existingObj = JSON.parse(existingContent);
      const newObj = JSON.parse(newContent);
      const merged = { ...existingObj, ...newObj };
      result = JSON.stringify(merged, null, 2);
    } catch (e) {
      // Not JSON, fall back to replacement
      console.log('[Context-Enhanced] Not JSON content, using full replacement');
      result = newContent;
    }
  } else {
    // Default: Use the new content if no specific modification type
    result = newContent;
  }
  
  return result;
}

// Build Validator with Reflection Loop
class BuildValidator {
  constructor(anthropic) {
    this.anthropic = anthropic;
  }

  async validateWithReflectionLoop(workspacePath, generatedFiles, maxAttempts = 5) {
    // Skip validation if explicitly disabled
    if (process.env.SKIP_BUILD_VALIDATION === 'true') {
      console.log('[BuildValidator] Skipping validation (SKIP_BUILD_VALIDATION=true)');
      return { success: true, skipped: true };
    }

    console.log('[BuildValidator] Starting build validation with Reflection Loop...');
    let attempt = 0;
    
    while (attempt < maxAttempts) {
      console.log(`[BuildValidator] Attempt ${attempt + 1}/${maxAttempts}`);
      
      // Step 1: Run build
      const buildResult = await this.runBuild(workspacePath);
      
      if (buildResult.success) {
        console.log(`[BuildValidator] ✅ Build succeeded after ${attempt + 1} attempts`);
        return { 
          success: true, 
          attempts: attempt + 1 
        };
      }
      
      // Step 2: Diagnose errors by type
      console.log('[BuildValidator] Diagnosing build errors...');
      const diagnosis = await this.categorizeErrors(buildResult.errors, workspacePath);
      
      // Log error categories
      Object.entries(diagnosis).forEach(([type, errors]) => {
        if (errors.length > 0) {
          console.log(`[BuildValidator] Found ${errors.length} ${type}`);
        }
      });
      
      // Step 3: Generate targeted fixes
      console.log('[BuildValidator] Generating targeted fixes...');
      const fixes = await this.generateTargetedFixes(diagnosis, generatedFiles, workspacePath);
      
      if (!fixes || fixes.length === 0) {
        console.log('[BuildValidator] No fixes generated for attempt ' + (attempt + 1));
        // Still increment attempt counter to show we tried
        attempt++;
        
        // Continue trying - sometimes builds need multiple runs (e.g., after prisma generate)
        // or errors might resolve after file system updates
        console.log('[BuildValidator] Will retry build in case errors self-resolve...');
        continue;
      }
      
      // Step 4: Apply fixes
      console.log(`[BuildValidator] Applying ${fixes.length} fixes...`);
      await this.applyFixes(workspacePath, fixes);
      
      attempt++;
    }
    
    // Step 5: Failed after max attempts - return with warning
    console.log(`[BuildValidator] ⚠️ Build validation failed after ${attempt} attempts`);
    return { 
      success: false,
      partial: true,
      warningBadge: true,
      message: 'Code generated with build errors. Use Dev Server panel to validate and fix.',
      attempts: attempt || 1  // Ensure at least 1 attempt is reported
    };
  }
  
  async runBuild(workspacePath) {
    try {
      // Use framework-agnostic build system detector
      const buildInfo = await buildSystemDetector.getBuildCommand(workspacePath, this.anthropic);
      
      if (!buildInfo.detected || !buildInfo.command) {
        console.log('[BuildValidator] No build system detected, skipping validation');
        return { success: true, skipped: true };
      }
      
      console.log(`[BuildValidator] Detected ${buildInfo.language} project${buildInfo.framework ? ` (${buildInfo.framework})` : ''}`);
      console.log(`[BuildValidator] Running: ${buildInfo.command}`);
      
      // Parse command into executable and args
      const commandParts = buildInfo.command.split(' ');
      const buildCommand = commandParts[0];
      const buildArgs = commandParts.slice(1);
      
      return new Promise((resolve) => {
        const buildProcess = spawn(buildCommand, buildArgs, {
          cwd: workspacePath,
          env: { 
            ...process.env, 
            NODE_ENV: 'production',
            FORCE_COLOR: '0'
          }
        });
        
        let stdout = '';
        let stderr = '';
        let errors = [];
        
        buildProcess.stdout?.on('data', (data) => {
          stdout += data.toString();
        });
        
        buildProcess.stderr?.on('data', (data) => {
          stderr += data.toString();
        });
        
        buildProcess.on('close', (code) => {
          if (code === 0) {
            console.log('[BuildValidator] Build completed successfully (exit code 0)');
            resolve({ success: true });
          } else {
            console.log(`[BuildValidator] Build failed with exit code ${code}`);
            const allOutput = stdout + stderr;
            
            // Extract error lines for better diagnosis
            const errorLines = allOutput.split('\n').filter(line => 
              line.includes('error') || 
              line.includes('Error') ||
              line.includes('Failed')
            );
            
            resolve({ 
              success: false, 
              errors: errorLines.length > 0 ? errorLines : ['Build failed with exit code ' + code],
              fullOutput: allOutput,
              exitCode: code
            });
          }
        });
        
        // Timeout after 60 seconds
        setTimeout(() => {
          buildProcess.kill();
          resolve({ 
            success: false, 
            errors: ['Build timeout after 60 seconds'],
            timeout: true 
          });
        }, 60000);
      });
    } catch (error) {
      console.error('[BuildValidator] Error running build:', error);
      return { 
        success: false, 
        errors: [error.message],
        exception: true
      };
    }
  }
  
  async categorizeErrors(errors, workspacePath) {
    // Direct pattern-based categorization - NO AI
    console.log('[BuildValidator] Categorizing errors directly from build output');
    
    const categorized = {
      missingImports: [],
      typeErrors: [],
      syntaxErrors: [],
      missingFiles: [],
      missingDeps: [],
      extensionMismatch: [],
      other: []
    };
    
    for (const error of errors) {
      // Missing module/import errors - Updated patterns to handle both quoted and unquoted paths
      if (error.match(/Module not found.*Can't resolve ['"]?([^'"]+)['"]?/i) ||
          error.match(/Cannot find module ['"]?([^'"]+)['"]?/i) ||
          error.match(/Could not resolve ['"]?([^'"]+)['"]?/i) ||
          error.match(/Can't resolve ['"]?([^'"]+)['"]?/i) ||
          error.includes("Module not found") ||
          error.includes("Cannot resolve")) {
        categorized.missingImports.push(error);
      }
      // TypeScript type errors
      else if (error.match(/TS\d+:/i) || 
               error.match(/Type .* is not assignable to type/i) ||
               error.match(/Property .* does not exist on type/i)) {
        categorized.typeErrors.push(error);
      }
      // Syntax errors
      else if (error.match(/SyntaxError:/i) ||
               error.match(/Unexpected token/i) ||
               error.match(/Parsing error:/i)) {
        categorized.syntaxErrors.push(error);
      }
      // File not found errors
      else if (error.match(/ENOENT.*no such file or directory/i) ||
               error.match(/File not found:/i)) {
        categorized.missingFiles.push(error);
      }
      // Missing npm packages
      else if (error.match(/Cannot find package/i) ||
               error.match(/Module not installed/i)) {
        categorized.missingDeps.push(error);
      }
      // Extension mismatch
      else if (error.match(/\.jsx?' imported from/i) ||
               error.match(/expected '\.ts' extension/i)) {
        categorized.extensionMismatch.push(error);
      }
      // TailwindCSS v4 PostCSS issue
      else if (error.includes("tailwindcss") && error.includes("PostCSS plugin")) {
        categorized.missingDeps.push(error);
      }
      // Everything else
      else {
        categorized.other.push(error);
      }
    }
    
    console.log(`[BuildValidator] Categorized: ${categorized.missingImports.length} imports, ${categorized.typeErrors.length} types, ${categorized.syntaxErrors.length} syntax, ${categorized.missingFiles.length} files, ${categorized.missingDeps.length} deps`);
    console.log(`[BuildValidator] Found ${categorized.other.length} other`);
    
    return categorized;
  }
  
  async generateTargetedFixes(diagnosis, generatedFiles, workspacePath) {
    const fixes = [];

    // Detect project language for context
    const buildInfo = await buildSystemDetector.detect(workspacePath);
    const projectLanguage = buildInfo.language || 'unknown';

    console.log(`[BuildValidator] Generating fixes for ${projectLanguage} project`);

    // PHASE 1: Fast deterministic fixes (no AI needed)
    console.log('[BuildValidator] Phase 1: Applying deterministic fixes...');

    // Fix 1: Missing files/imports
    const allMissingFileErrors = [...(diagnosis.missingFiles || []), ...(diagnosis.missingImports || [])];
    if (allMissingFileErrors.length > 0) {
      console.log('[BuildValidator] Processing missing file/import errors...');
      
      for (const error of allMissingFileErrors) {
        console.log(`[BuildValidator] Processing: ${error.substring(0, 200)}`);
        
        // Extract the actual file path from the error message
        let missingFile = null;
        
        // Pattern 1: Module not found: Can't resolve '@/lib/prisma' (with or without quotes)
        const moduleMatch = error.match(/Module not found.*Can't resolve ['"]?([^'"\s]+)['"]?/i) ||
                           error.match(/Can't resolve ['"]?([^'"\s]+)['"]?/i);
        if (moduleMatch) {
          missingFile = moduleMatch[1];
        }
        
        // Pattern 2: Cannot find module './something' (with or without quotes)
        const cannotFindMatch = error.match(/Cannot find module ['"]?([^'"\s]+)['"]?/i);
        if (!missingFile && cannotFindMatch) {
          missingFile = cannotFindMatch[1];
        }
        
        // Pattern 3: Could not resolve (common in Vite/Rollup)
        const couldNotResolveMatch = error.match(/Could not resolve ['"]?([^'"\s]+)['"]?/i);
        if (!missingFile && couldNotResolveMatch) {
          missingFile = couldNotResolveMatch[1];
        }
        
        if (!missingFile) {
          console.log('[BuildValidator] Could not extract file path from error');
          continue;
        }
        
        console.log(`[BuildValidator] Extracted path: ${missingFile}`);
        
        // Handle path aliases
        let resolvedPath = missingFile;
        if (missingFile.startsWith('@/')) {
          // In Next.js, @/ typically maps to root or src/
          // Check if src directory exists
          const srcPath = path.join(workspacePath, 'src');
          const srcExists = await fs.access(srcPath).then(() => true).catch(() => false);
          
          if (srcExists) {
            // Pages Router with src directory
            resolvedPath = missingFile.replace('@/', 'src/');
          } else {
            // App Router or no src directory
            resolvedPath = missingFile.replace('@/', '');
          }
          console.log(`[BuildValidator] Resolved @/ alias: ${missingFile} -> ${resolvedPath}`);
        }
        
        // Check if file already exists (try with and without extension)
        const fullPath = path.join(workspacePath, resolvedPath);
        let fileExists = false;
          
          try {
            await fs.access(fullPath);
            fileExists = true;
          } catch {
            // Try with common extensions if no extension provided
            if (!path.extname(missingFile)) {
              const extensions = ['.ts', '.tsx', '.js', '.jsx'];
              for (const ext of extensions) {
                try {
                  await fs.access(fullPath + ext);
                  fileExists = true;
                  console.log(`[BuildValidator] File exists with extension: ${missingFile}${ext}`);
                  break;
                } catch {
                  // Continue checking
                }
              }
            }
          }
          
          if (fileExists) {
            console.log(`[BuildValidator] File already exists, checking for alias issue: ${missingFile}`);
            
            // If file exists but import fails, it's likely an alias configuration issue
            if (error.includes('@/')) {
              console.log(`[BuildValidator] Detected @/ alias issue, configuring jsconfig/tsconfig`);
              
              // Check if we need to update jsconfig.json or tsconfig.json
              const configFile = projectLanguage === 'typescript' ? 'tsconfig.json' : 'jsconfig.json';
              const configPath = path.join(workspacePath, configFile);
              
              try {
                const configContent = await fs.readFile(configPath, 'utf-8');
                const config = JSON.parse(configContent);
                
                // Add path mapping for @/
                if (!config.compilerOptions) config.compilerOptions = {};
                if (!config.compilerOptions.paths) config.compilerOptions.paths = {};
                
                config.compilerOptions.paths['@/*'] = ['./src/*'];
                
                fixes.push({
                  type: 'update',
                  path: configFile,
                  content: JSON.stringify(config, null, 2)
                });
                
                console.log(`[BuildValidator] Added @/ alias configuration to ${configFile}`);
              } catch (err) {
                // Create new config file with alias
                const newConfig = {
                  compilerOptions: {
                    paths: {
                      '@/*': ['./src/*']
                    }
                  }
                };
                
                fixes.push({
                  type: 'create',
                  path: configFile,
                  content: JSON.stringify(newConfig, null, 2)
                });
                
                console.log(`[BuildValidator] Created ${configFile} with @/ alias configuration`);
              }
              continue;
            }
        } else {
          // File doesn't exist, create stub
          console.log(`[BuildValidator] File doesn't exist, creating: ${resolvedPath}`);
          
          // Special handling for common library files
          let filePath = resolvedPath;
            
            // Ensure TypeScript files have .ts extension
            if (projectLanguage === 'typescript' && !path.extname(filePath)) {
              // Check if it's a known library file that should be .ts
              if (filePath.includes('lib/prisma') || filePath.includes('lib/db')) {
                filePath += '.ts';
              } else if (filePath.includes('components/')) {
                filePath += '.tsx';
              } else {
                filePath += '.ts';
              }
              console.log(`[BuildValidator] Added TypeScript extension: ${filePath}`);
            }
            
            // Generate appropriate stub content
            const stubContent = StubGenerator.generateStub(filePath, projectLanguage);
            
            fixes.push({
              type: 'create',
              path: filePath,
              content: stubContent
            });
          }
      }
    }
    
    // Fix 2: Syntax errors with ESLint --fix
    if (diagnosis.syntaxErrors && diagnosis.syntaxErrors.length > 0) {
      console.log('[BuildValidator] Attempting to fix syntax errors with ESLint...');
      
      // Check if eslint is available
      const eslintPath = path.join(workspacePath, 'node_modules', '.bin', 'eslint');
      const hasEslint = await fs.access(eslintPath).then(() => true).catch(() => false);
      
      if (hasEslint) {
        try {
          const { exec } = await import('child_process');
          const execPromise = promisify(exec);
          
          // Run ESLint --fix on all JS/TS files
          console.log('[BuildValidator] Running ESLint --fix...');
          await execPromise('npx eslint . --fix --ext .js,.jsx,.ts,.tsx', {
            cwd: workspacePath,
            timeout: 30000
          });
          
          console.log('[BuildValidator] ESLint --fix completed');
          // Return early as ESLint may have fixed the issues
          return fixes;
        } catch (error) {
          console.log('[BuildValidator] ESLint --fix failed:', error.message);
        }
      } else {
        console.log('[BuildValidator] ESLint not available, skipping syntax fixes');
      }
    }
    
    // Fix 3: Missing dependencies
    if (diagnosis.missingDeps && diagnosis.missingDeps.length > 0) {
      console.log('[BuildValidator] Fixing missing dependencies...');
      
      // Check for TailwindCSS v4 PostCSS issue
      const hasTailwindIssue = diagnosis.missingDeps.some(err => 
        err.includes("tailwindcss") && err.includes("PostCSS plugin")
      );
      
      if (hasTailwindIssue) {
        console.log('[BuildValidator] Detected TailwindCSS v4 PostCSS issue');
        
        // Install @tailwindcss/postcss
        try {
          const { exec } = await import('child_process');
          const execPromise = promisify(exec);
          
          console.log('[BuildValidator] Installing @tailwindcss/postcss...');
          await execPromise('npm install @tailwindcss/postcss', {
            cwd: workspacePath,
            timeout: 60000
          });
          
          // Update postcss.config.js
          const postcssPath = path.join(workspacePath, 'postcss.config.js');
          const postcssExists = await fs.access(postcssPath).then(() => true).catch(() => false);
          
          if (postcssExists) {
            let content = await fs.readFile(postcssPath, 'utf-8');
            content = content.replace('tailwindcss: {}', "'@tailwindcss/postcss': {}");
            await fs.writeFile(postcssPath, content);
            console.log('[BuildValidator] Updated postcss.config.js for TailwindCSS v4');
          }
          
          // Update tsconfig.json moduleResolution if needed
          const tsconfigPath = path.join(workspacePath, 'tsconfig.json');
          const tsconfigExists = await fs.access(tsconfigPath).then(() => true).catch(() => false);
          
          if (tsconfigExists) {
            let content = await fs.readFile(tsconfigPath, 'utf-8');
            content = content.replace('"moduleResolution": "node"', '"moduleResolution": "bundler"');
            await fs.writeFile(tsconfigPath, content);
            console.log('[BuildValidator] Updated tsconfig.json moduleResolution to bundler');
          }
          
          fixes.push({
            type: 'dependency',
            action: 'installed @tailwindcss/postcss and updated configs'
          });
        } catch (error) {
          console.error('[BuildValidator] Failed to fix TailwindCSS issue:', error);
        }
      }
    }
    
    // Fix 4: Extension mismatches (language-aware)
    if (diagnosis.extensionMismatch && diagnosis.extensionMismatch.length > 0) {
      console.log('[BuildValidator] Fixing file extension mismatches...');
      
      for (const error of diagnosis.extensionMismatch) {
        // Use AI or patterns to detect the correct extension
        const match = error.match(/expected\s+(\.\w+)\s+but\s+got\s+(\.\w+)/i);
        if (match) {
          const expectedExt = match[1];
          const actualExt = match[2];
          
          // Find files with wrong extension and fix them
          for (const [filePath, content] of Object.entries(generatedFiles)) {
            if (filePath.endsWith(actualExt)) {
              const newPath = filePath.replace(actualExt, expectedExt);
              fixes.push({
                type: 'rename',
                oldPath: filePath,
                newPath: newPath,
                content: content
              });
            }
          }
        }
      }
    }
    
    // Fix 3: Missing dependencies (package manager agnostic)
    if (diagnosis.missingDeps && diagnosis.missingDeps.length > 0) {
      console.log('[BuildValidator] Detecting missing dependencies...');
      
      for (const error of diagnosis.missingDeps) {
        // Extract package name from error
        const packageMatch = error.match(/(?:package|module|dependency)\s+['"]?([^'"\s]+)['"]?\s+(?:not found|missing)/i);
        if (packageMatch) {
          const packageName = packageMatch[1];
          
          // Determine install command based on project type
          let installCommand = null;
          switch (projectLanguage) {
            case 'javascript':
            case 'typescript':
              installCommand = buildInfo.buildTool?.includes('yarn') ? 
                `yarn add ${packageName}` : `npm install ${packageName}`;
              break;
            case 'python':
              installCommand = `pip install ${packageName}`;
              break;
            case 'java':
              // Would need to update pom.xml or build.gradle
              console.log(`[BuildValidator] Java dependency ${packageName} needs manual addition to build file`);
              break;
            case 'go':
              installCommand = `go get ${packageName}`;
              break;
            case 'rust':
              // Would need to update Cargo.toml
              console.log(`[BuildValidator] Rust dependency ${packageName} needs manual addition to Cargo.toml`);
              break;
            case 'ruby':
              installCommand = `gem install ${packageName}`;
              break;
            case 'php':
              installCommand = `composer require ${packageName}`;
              break;
          }
          
          if (installCommand) {
            fixes.push({
              type: 'install',
              command: installCommand,
              package: packageName
            });
          }
        }
      }
    }
    
    // Fix 4: Quick pattern-based type error fixes
    if (diagnosis.typeErrors && diagnosis.typeErrors.length > 0) {
      console.log(`[BuildValidator] Checking ${diagnosis.typeErrors.length} type errors for simple patterns...`);

      for (const error of diagnosis.typeErrors) {
        // Check for Prisma client errors
        if (error.includes('PrismaClient') && (error.includes('Property') || error.includes('does not exist'))) {
          console.log('[BuildValidator] Detected Prisma schema/client mismatch - will regenerate client');
          fixes.push({
            type: 'command',
            command: 'npx prisma generate',
            description: 'Regenerate Prisma client from schema'
          });
          break; // Only need to run once
        }
      }
    }

    // PHASE 2: AI-powered fixes for complex errors
    console.log('[BuildValidator] Phase 2: AI-powered error fixing...');

    // Collect all complex errors that need AI fixing
    const complexErrors = [
      ...(diagnosis.typeErrors || []),
      ...(diagnosis.syntaxErrors || []),
      ...(diagnosis.other || [])
    ].filter(error => {
      // Filter out errors we already fixed deterministically
      const alreadyFixed =
        fixes.some(fix => fix.type === 'command' && fix.command.includes('prisma')) ||
        fixes.some(fix => error.includes(fix.path));
      return !alreadyFixed;
    });

    if (complexErrors.length > 0) {
      console.log(`[BuildValidator] Using AI to fix ${complexErrors.length} complex errors...`);
      const aiFixes = await this.generateAIFixes(complexErrors, workspacePath, generatedFiles);
      fixes.push(...aiFixes);
    } else {
      console.log('[BuildValidator] No complex errors requiring AI fixing');
    }

    return fixes;
  }

  /**
   * AI-powered error fixing system
   * Uses Claude to intelligently fix code errors
   */
  async generateAIFixes(errors, workspacePath, generatedFiles) {
    const fixes = [];

    if (!this.anthropic) {
      console.log('[BuildValidator] Anthropic client not available, skipping AI fixes');
      return fixes;
    }

    // Group errors by file for efficient processing
    const errorsByFile = this.groupErrorsByFile(errors);

    console.log(`[BuildValidator] Grouped ${errors.length} errors into ${Object.keys(errorsByFile).length} files`);

    // Process each file with errors
    for (const [filePath, fileErrors] of Object.entries(errorsByFile)) {
      try {
        console.log(`[BuildValidator] AI fixing ${fileErrors.length} errors in ${filePath}...`);

        // Read the problematic file
        const fullPath = path.join(workspacePath, filePath);
        let currentContent;

        try {
          currentContent = await fs.readFile(fullPath, 'utf-8');
        } catch (readError) {
          console.log(`[BuildValidator] Could not read ${filePath}, skipping AI fix`);
          continue;
        }

        // Build the prompt for AI
        const prompt = this.buildErrorFixPrompt(filePath, currentContent, fileErrors, workspacePath);

        // Call AI with retry logic
        let response;
        let retries = 2;

        while (retries > 0) {
          try {
            response = await this.anthropic.messages.create({
              model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
              max_tokens: 4096,
              temperature: 0.1, // Low temperature for consistent, deterministic fixes
              messages: [{
                role: 'user',
                content: prompt
              }]
            });
            break; // Success
          } catch (error) {
            if (error.status === 529 && retries > 1) {
              console.log(`[BuildValidator] API overloaded, retrying...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              retries--;
            } else {
              throw error;
            }
          }
        }

        if (!response) {
          console.log(`[BuildValidator] Failed to get AI response for ${filePath}`);
          continue;
        }

        // Extract fixed code from response
        const fixedCode = this.extractCodeFromAIResponse(response.content[0].text);

        if (!fixedCode) {
          console.log(`[BuildValidator] Could not extract code from AI response for ${filePath}`);
          continue;
        }

        // Validate the fix is actually different and looks valid
        if (fixedCode === currentContent) {
          console.log(`[BuildValidator] AI returned unchanged code for ${filePath}`);
          continue;
        }

        if (!this.validateFixedCode(fixedCode, currentContent)) {
          console.log(`[BuildValidator] AI fix validation failed for ${filePath}`);
          continue;
        }

        // Add the fix
        fixes.push({
          type: 'update',
          path: filePath,
          content: fixedCode,
          description: `AI fixed ${fileErrors.length} error(s): ${fileErrors[0].substring(0, 80)}...`
        });

        console.log(`[BuildValidator] ✅ AI successfully generated fix for ${filePath}`);

      } catch (error) {
        console.error(`[BuildValidator] AI fix failed for ${filePath}:`, error.message);
        // Continue with other files even if one fails
      }
    }

    if (fixes.length > 0) {
      console.log(`[BuildValidator] ✅ AI generated ${fixes.length} fixes`);
    } else {
      console.log(`[BuildValidator] ⚠️ AI could not generate any fixes`);
    }

    return fixes;
  }

  /**
   * Group errors by the file they occurred in
   */
  groupErrorsByFile(errors) {
    const grouped = {};

    for (const error of errors) {
      // Extract file path from error message
      // Common patterns:
      // - ./src/app/page.tsx:1:8
      // - src/components/Counter.tsx:25:10
      // - Type error in /full/path/to/file.tsx

      let filePath = null;

      // Pattern 1: Relative path with line:col
      const relativeMatch = error.match(/\.?\/?([^:\s]+\.[jt]sx?):(\d+):(\d+)/i);
      if (relativeMatch) {
        filePath = relativeMatch[1].replace(/^\.\//, '');
      }

      // Pattern 2: File path in quotes
      if (!filePath) {
        const quotedMatch = error.match(/["']([^"']+\.[jt]sx?)["']/);
        if (quotedMatch) {
          filePath = quotedMatch[1].replace(/^\.\//, '');
        }
      }

      // Pattern 3: "in <filename>"
      if (!filePath) {
        const inMatch = error.match(/in\s+([^\s]+\.[jt]sx?)/i);
        if (inMatch) {
          filePath = inMatch[1].replace(/^\.\//, '');
        }
      }

      if (filePath) {
        // Normalize path
        filePath = filePath.replace(/\\/g, '/');

        if (!grouped[filePath]) {
          grouped[filePath] = [];
        }
        grouped[filePath].push(error);
      } else {
        console.log(`[BuildValidator] Could not extract file from error: ${error.substring(0, 100)}...`);
      }
    }

    return grouped;
  }

  /**
   * Build an intelligent prompt for AI to fix errors
   */
  buildErrorFixPrompt(filePath, currentContent, errors, workspacePath) {
    // Get file extension to determine language
    const ext = path.extname(filePath);
    const language = ext === '.tsx' ? 'typescript' :
                     ext === '.ts' ? 'typescript' :
                     ext === '.jsx' ? 'javascript' :
                     ext === '.js' ? 'javascript' : 'code';

    return `You are an expert code fixing assistant. Your task is to fix build errors in a ${language} file.

**CRITICAL RULES**:
1. Fix ONLY the errors listed below
2. Do NOT change working code
3. Do NOT add new features or refactor
4. Preserve all existing comments, formatting, and logic
5. Return ONLY the complete fixed code - no explanations, no markdown formatting
6. The code must be syntactically valid and ready to use

**File**: ${filePath}

**Current Code**:
\`\`\`${language}
${currentContent}
\`\`\`

**Build Errors to Fix**:
${errors.map((err, i) => `${i + 1}. ${err}`).join('\n')}

**Common Error Patterns & Solutions**:
- "has no default export" → Change \`import X from 'Y'\` to \`import { X } from 'Y'\`
- "has no exported member" → Change \`import { X } from 'Y'\` to \`import X from 'Y'\`
- "Cannot find name" → Add missing import or define the variable
- "needs useState/useEffect" + "Client Component" → Add 'use client' directive at top
- Missing type annotations → Add appropriate TypeScript types
- Unused variables → Remove them or use them

**Instructions**:
1. Analyze each error carefully
2. Apply the minimal fix needed
3. Ensure all imports are correct
4. Return the complete fixed file content
5. Do NOT wrap in markdown code blocks - return raw code only

**Fixed Code**:`;
  }

  /**
   * Extract code from AI response
   * Handles various response formats
   */
  extractCodeFromAIResponse(responseText) {
    if (!responseText) return null;

    // Strategy 1: Look for code blocks
    const codeBlockMatch = responseText.match(/```(?:typescript|tsx|javascript|jsx|ts|js)?\s*\n([\s\S]+?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Strategy 2: Check if entire response looks like code
    // Valid code should have certain characteristics
    const looksLikeCode =
      responseText.includes('import') ||
      responseText.includes('export') ||
      responseText.includes('function') ||
      responseText.includes('const ') ||
      responseText.includes('let ') ||
      responseText.includes('class ') ||
      responseText.includes('interface ');

    if (looksLikeCode) {
      // Remove any leading/trailing text that's clearly not code
      let code = responseText.trim();

      // Remove common non-code prefixes
      const prefixes = [
        'Here is the fixed code:',
        'Fixed code:',
        'The fixed code is:',
        'Here\'s the solution:',
        'Solution:',
      ];

      for (const prefix of prefixes) {
        if (code.toLowerCase().startsWith(prefix.toLowerCase())) {
          code = code.substring(prefix.length).trim();
        }
      }

      return code;
    }

    // Strategy 3: If response has multiple lines and starts with valid code syntax
    const lines = responseText.trim().split('\n');
    if (lines.length > 1) {
      const firstLine = lines[0].trim();
      if (firstLine.startsWith('import ') ||
          firstLine.startsWith('export ') ||
          firstLine.startsWith("'use ") ||
          firstLine.startsWith('"use ') ||
          firstLine.startsWith('//') ||
          firstLine.startsWith('/*')) {
        return responseText.trim();
      }
    }

    console.log('[BuildValidator] Could not extract code from AI response');
    return null;
  }

  /**
   * Validate that fixed code is reasonable
   */
  validateFixedCode(fixedCode, originalCode) {
    // Basic sanity checks

    // 1. Must not be empty
    if (!fixedCode || fixedCode.trim().length === 0) {
      console.log('[BuildValidator] Validation failed: empty code');
      return false;
    }

    // 2. Must not be drastically shorter (likely truncated)
    if (fixedCode.length < originalCode.length * 0.5) {
      console.log('[BuildValidator] Validation failed: code too short (possible truncation)');
      return false;
    }

    // 3. Must not be drastically longer (AI added too much)
    if (fixedCode.length > originalCode.length * 3) {
      console.log('[BuildValidator] Validation failed: code too long (AI added too much)');
      return false;
    }

    // 4. Should contain similar structure (imports, exports)
    const originalHasImports = originalCode.includes('import ');
    const fixedHasImports = fixedCode.includes('import ');

    if (originalHasImports && !fixedHasImports) {
      console.log('[BuildValidator] Validation failed: missing imports');
      return false;
    }

    const originalHasExports = originalCode.includes('export ');
    const fixedHasExports = fixedCode.includes('export ');

    if (originalHasExports && !fixedHasExports) {
      console.log('[BuildValidator] Validation failed: missing exports');
      return false;
    }

    // 5. Should not have obvious syntax errors
    const hasMismatchedBraces = this.checkBraceBalance(fixedCode);
    if (hasMismatchedBraces) {
      console.log('[BuildValidator] Validation failed: mismatched braces');
      return false;
    }

    return true;
  }

  /**
   * Check if braces/brackets/parens are balanced
   */
  checkBraceBalance(code) {
    const stack = [];
    const pairs = {
      '{': '}',
      '[': ']',
      '(': ')'
    };

    // Simple check - doesn't handle strings/comments perfectly, but catches major issues
    for (let i = 0; i < code.length; i++) {
      const char = code[i];

      if (char in pairs) {
        stack.push(pairs[char]);
      } else if (Object.values(pairs).includes(char)) {
        if (stack.length === 0 || stack.pop() !== char) {
          return true; // Mismatch found
        }
      }
    }

    return stack.length !== 0; // Should be empty if balanced
  }
  
  async generateImportFixes(missingImports, workspacePath) {
    const fixes = [];
    
    for (const error of missingImports) {
      // Extract module name from error
      const moduleMatch = error.match(/Cannot find module ['"](.+?)['"]/);
      if (moduleMatch) {
        const moduleName = moduleMatch[1];
        
        // Check if it's a relative import that needs fixing
        if (moduleName.startsWith('.') || moduleName.startsWith('../')) {
          // Try adding .js or .ts extension
          const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx'];
          for (const ext of possibleExtensions) {
            const testPath = path.join(workspacePath, moduleName + ext);
            const exists = await fs.access(testPath).then(() => true).catch(() => false);
            if (exists) {
              // Found the file, need to update import
              fixes.push({
                type: 'updateImport',
                from: moduleName,
                to: moduleName + ext
              });
              break;
            }
          }
        }
      }
    }
    
    return fixes;
  }

  async applyFixes(workspacePath, fixes) {
    const { exec } = await import('child_process');
    const execPromise = promisify(exec);
    
    for (const fix of fixes) {
      try {
        switch (fix.type) {
          case 'create':
          case 'update':
            const fullPath = path.join(workspacePath, fix.path);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, fix.content, 'utf-8');
            console.log(`[BuildValidator] ${fix.type === 'create' ? 'Created' : 'Updated'}: ${fix.path}`);
            break;
            
          case 'rename':
            const oldFullPath = path.join(workspacePath, fix.oldPath);
            const newFullPath = path.join(workspacePath, fix.newPath);
            await fs.rename(oldFullPath, newFullPath);
            console.log(`[BuildValidator] Renamed: ${fix.oldPath} → ${fix.newPath}`);
            break;
            
          case 'install':
            // Install missing dependency
            console.log(`[BuildValidator] Installing dependency: ${fix.package}`);
            try {
              await execPromise(fix.command, { cwd: workspacePath });
              console.log(`[BuildValidator] Installed: ${fix.package}`);
            } catch (installError) {
              console.error(`[BuildValidator] Failed to install ${fix.package}:`, installError.message);
            }
            break;
            
          case 'command':
            // Run a command (like prisma generate)
            console.log(`[BuildValidator] Running command: ${fix.command}`);
            try {
              const { stdout, stderr } = await execPromise(fix.command, { 
                cwd: workspacePath,
                timeout: 30000 // 30 second timeout
              });
              if (stdout) console.log(`[BuildValidator] Command output: ${stdout.substring(0, 200)}`);
              if (stderr && !stderr.includes('warning')) {
                console.error(`[BuildValidator] Command stderr: ${stderr.substring(0, 200)}`);
              }
              console.log(`[BuildValidator] ✅ Command completed: ${fix.description || fix.command}`);
            } catch (cmdError) {
              console.error(`[BuildValidator] Failed to run command:`, cmdError.message);
            }
            break;
            
          case 'updateImport':
            // This would need to scan files and update import statements
            console.log(`[BuildValidator] Import fix needed: ${fix.from} → ${fix.to}`);
            break;
            
          default:
            console.log(`[BuildValidator] Unknown fix type: ${fix.type}`);
        }
      } catch (error) {
        console.error(`[BuildValidator] Failed to apply fix:`, error);
      }
    }
  }
}

// Load project context from database
async function loadProjectContext(projectId) {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({
      datasourceUrl: `file:${path.join(__dirname, '../../../client/prisma/prisma/dev.db')}`
    });
    
    const context = await prisma.projectContext.findUnique({
      where: { projectId }
    });
    
    await prisma.$disconnect();
    return context;
  } catch (error) {
    console.log('Could not load project context:', error.message);
    return null;
  }
}

// Build enhanced prompt with context
function buildContextAwarePrompt(task, projectContext, existingFiles) {
  let contextSection = '';
  
  if (projectContext) {
    // Parse context data
    const taskHistory = projectContext.taskHistory ? JSON.parse(projectContext.taskHistory) : [];
    const dependencies = projectContext.dependencies ? JSON.parse(projectContext.dependencies) : {};
    const backendFiles = projectContext.backendFiles ? JSON.parse(projectContext.backendFiles) : [];
    
    contextSection = `
## Project Context (From Previous Tasks):
- **Project Type**: ${projectContext.projectType || 'Unknown'}
- **Backend Type**: ${projectContext.backendType || 'None detected'}
- **Database/ORM**: ${projectContext.ormType || 'None detected'}
- **Last Updated**: ${projectContext.updatedAt}

## Previous Tasks Completed:
${taskHistory.slice(-5).map(t => `- ${t.title} (${t.filesCreated?.length || 0} files created, ${t.filesModified?.length || 0} files modified)`).join('\n')}

## Key Dependencies:
${Object.entries(dependencies).slice(0, 10).map(([name, version]) => `- ${name}: ${version}`).join('\n')}

## Backend Infrastructure:
${projectContext.backendType ? `
- Backend Type: ${projectContext.backendType}
- Backend Files: ${backendFiles.slice(0, 5).join(', ')}
- API Pattern: ${projectContext.backendType === 'nextjs-api' ? 'App Router API routes in app/api/' : 
                  projectContext.backendType === 'express' ? 'Express routes in routes/' : 
                  'Custom backend structure'}
` : '- No backend detected yet'}

## CRITICAL INSTRUCTIONS BASED ON CONTEXT:
${projectContext.projectType === 'nextjs' ? `
- This is a Next.js project - use App Router patterns
- Put API routes in app/api/ directory
- Use 'use client' for interactive components
- Follow existing file structure patterns
` : ''}
${projectContext.backendType ? `
- IMPORTANT: Backend already exists (${projectContext.backendType})
- DO NOT create a new backend - use the existing one
- Add new endpoints to the existing backend structure
- Follow the existing API patterns
` : ''}
${projectContext.ormType ? `
- Database ORM already set up: ${projectContext.ormType}
- Use existing database models and patterns
- Add new models to existing schema file
` : ''}
`;
  }
  
  return contextSection;
}

// ============================================================================
// BOILERPLATE DETECTION & CLI COMMAND SYSTEM
// ============================================================================

/**
 * Detect if task is creating a boilerplate/project from scratch
 */
async function detectBoilerplateIntent(task_title, existingFiles = [], anthropicClient) {
  try {
    console.log('[BoilerplateDetector] Analyzing task intent...');

    const prompt = `Analyze this task and determine if it's creating a project from scratch (boilerplate) or adding a feature to existing code.

Task: "${task_title}"

Context:
- Existing files: ${existingFiles.length} files
- Files: ${existingFiles.slice(0, 5).join(', ')}${existingFiles.length > 5 ? '...' : ''}

Return ONLY valid JSON:
{
  "isBoilerplate": true/false,
  "framework": "nextjs" | "vite-react" | "vue" | "astro" | null,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

Rules:
1. isBoilerplate = TRUE if:
   - Contains: "create", "initialize", "setup", "scaffold", "boilerplate", "new project", "from scratch", "blank", "starter"
   - AND mentions framework: "Next.js", "React", "Vite", "Vue", "Astro"
   - AND NO specific feature mentioned (counter, login, navbar, todo, etc.)
   - AND few/no existing files

2. isBoilerplate = FALSE if:
   - Contains: "add", "create [specific feature]", "implement", "build [component]"
   - OR mentions specific features: "counter", "login", "navbar", "todo", "dashboard", "form", "button"
   - OR project already has many files (${existingFiles.length} files)

Examples:
✅ "Create a Next.js boilerplate" → isBoilerplate: true, framework: "nextjs"
✅ "Next.js app" → isBoilerplate: true (framework-only = setup)
✅ "Setup React project" → isBoilerplate: true, framework: "vite-react"
❌ "Add a counter component" → isBoilerplate: false
❌ "Create a counter app" → isBoilerplate: false (specific feature)
❌ "Counter with Next.js" → isBoilerplate: false (feature overrides framework)`;

    // Retry logic for API overload errors
    let response;
    let retries = 3;
    while (retries > 0) {
      try {
        response = await anthropicClient.messages.create({
          model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
          max_tokens: 512,
          temperature: 0.1,
          messages: [{ role: 'user', content: prompt }]
        });
        break; // Success, exit retry loop
      } catch (apiError) {
        retries--;
        // Check if error is overloaded (429 or 529)
        if ((apiError.status === 429 || apiError.status === 529) && retries > 0) {
          const waitTime = (4 - retries) * 2000; // 2s, 4s, 6s
          console.log(`[BoilerplateDetector] API overloaded, retrying in ${waitTime}ms... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw apiError; // Re-throw if not overload error or no retries left
        }
      }
    }

    // Parse JSON response (handle markdown-wrapped JSON)
    let responseText = response.content[0].text.trim();

    // Strip markdown code fences if present
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) ||
                     responseText.match(/```\s*([\s\S]*?)```/);
    if (jsonMatch) {
      responseText = jsonMatch[1].trim();
    }

    const result = JSON.parse(responseText);
    console.log(`[BoilerplateDetector] Intent: ${result.isBoilerplate ? 'BOILERPLATE' : 'FEATURE'}, Framework: ${result.framework || 'none'}, Confidence: ${result.confidence}`);
    console.log(`[BoilerplateDetector] Reasoning: ${result.reasoning}`);

    return result;
  } catch (error) {
    console.error('[BoilerplateDetector] Error detecting intent:', error);
    // Default to false (use AI generation) on error
    return { isBoilerplate: false, framework: null, confidence: 0, reasoning: 'Error during detection' };
  }
}

/**
 * Search web for latest CLI command using Anthropic web search
 */
async function searchForLatestCLICommand(framework, anthropicClient) {
  try {
    console.log(`[WebSearch] Searching for latest ${framework} CLI command...`);

    const currentYear = new Date().getFullYear();

    // Retry logic for API overload errors
    let response;
    let retries = 3;
    while (retries > 0) {
      try {
        response = await anthropicClient.messages.create({
          model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
          max_tokens: 2048,
          tools: [{
            type: mcpConfig.tools.webSearch,
            name: "web_search"
          }],
          messages: [{
            role: 'user',
            content: `Find the latest official ${framework} boilerplate creation command for ${currentYear}.

Search the official documentation (e.g., nextjs.org, vitejs.dev, vuejs.org) and extract:

1. The EXACT CLI command with all recommended flags for creating a new project
2. What's included by default (TypeScript, Tailwind, ESLint, etc.)
3. Current stable version
4. Official source URL

Return ONLY valid JSON:
{
  "command": "exact CLI command to run (use {PROJECT_NAME} as placeholder for project name)",
  "includes": ["TypeScript", "Tailwind CSS", "ESLint"],
  "version": "x.x.x",
  "source": "https://official-url"
}

CRITICAL - Commands MUST be non-interactive (no prompts):
- For Next.js: MUST include --yes flag → npx create-next-app@latest {PROJECT_NAME} --yes
- For Vite: Use --template flag → npm create vite@latest {PROJECT_NAME} -- --template react-ts
- For Vue: Use --yes or individual feature flags
- For Astro: Use --yes flag
- The command must work in automated/CI environments without user input`
          }]
        });
        break; // Success, exit retry loop
      } catch (apiError) {
        retries--;
        // Check if error is overloaded (429 or 529)
        if ((apiError.status === 429 || apiError.status === 529) && retries > 0) {
          const waitTime = (4 - retries) * 2000; // 2s, 4s, 6s
          console.log(`[WebSearch] API overloaded, retrying in ${waitTime}ms... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw apiError; // Re-throw if not overload error or no retries left
        }
      }
    }

    // Find the text content block (skip tool_use blocks)
    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || !textBlock.text) {
      throw new Error('No text response from web search');
    }

    let resultText = textBlock.text.trim();

    // Strip markdown code fences if present
    const jsonMatch = resultText.match(/```json\s*([\s\S]*?)```/) ||
                     resultText.match(/```\s*([\s\S]*?)```/);
    if (jsonMatch) {
      resultText = jsonMatch[1].trim();
    }

    const result = JSON.parse(resultText);

    console.log(`[WebSearch] ✅ Found command: ${result.command}`);
    console.log(`[WebSearch] Version: ${result.version}, Source: ${result.source}`);

    return result;
  } catch (error) {
    console.error('[WebSearch] Error searching for CLI command:', error);
    throw error;
  }
}

/**
 * Execute CLI command to create boilerplate
 */
async function executeCLICommand(command, workspacePath, projectName) {
  return new Promise((resolve, reject) => {
    console.log(`[CLI] Executing: ${command}`);

    // Replace placeholder with '.' to create in current directory (avoid nested folders)
    // Using '.' ensures files are created directly in workspace_path, not in a subfolder
    let finalCommand = command.replace(/{PROJECT_NAME}/g, '.');

    // Ensure non-interactive execution by adding appropriate flags
    // For Next.js: add --yes if not present
    if (finalCommand.includes('create-next-app') && !finalCommand.includes('--yes')) {
      finalCommand = finalCommand.replace('create-next-app@latest', 'create-next-app@latest --yes');
      console.log(`[CLI] Added --yes flag for non-interactive execution`);
    }

    console.log(`[CLI] Final command: ${finalCommand}`);

    const child = spawn(finalCommand, {
      cwd: workspacePath,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']  // Close stdin to prevent interactive prompts
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(`[CLI] ${output}`);
    });

    child.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.error(`[CLI] ${output}`);
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`[CLI] ✅ Command completed successfully`);
        resolve({ success: true, stdout, stderr });
      } else {
        console.error(`[CLI] ❌ Command failed with code ${code}`);
        reject(new Error(`CLI command failed with code ${code}: ${stderr}`));
      }
    });

    child.on('error', (error) => {
      console.error('[CLI] Error executing command:', error);
      reject(error);
    });
  });
}

export const contextEnhancedGenerator = [
  {
    name: 'generate_code_with_context',
    description: 'Generate code with full project context awareness',
    inputSchema: {
      type: 'object',
      properties: {
        task_title: {
          type: 'string',
          description: 'Task title',
        },
        task_description: {
          type: 'string',
          description: 'Task description',
        },
        project_id: {
          type: 'string',
          description: 'Project ID for context lookup',
        },
        workspace_path: {
          type: 'string',
          description: 'Path to the workspace',
        },
      },
      required: ['task_title', 'workspace_path'],
    },
    handler: async ({ task_title, task_description, project_id, workspace_path }) => {
      console.log(`[Context-Enhanced] Generating code for: "${task_title}"`);
      
      // Load project context
      const projectContext = project_id ? await loadProjectContext(project_id) : null;
      
      if (projectContext) {
        console.log(`[Context-Enhanced] Loaded context for ${projectContext.projectType} project`);
      } else {
        console.log('[Context-Enhanced] No context available, proceeding without history');
      }
      
      // Initialize Anthropic client
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      });
      
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not configured');
      }
      
      // Scan existing files
      const projectFiles = await scanProjectFiles(workspace_path);
      console.log(`Found ${projectFiles.length} existing files`);

      // ====================================================================
      // STEP 1: DETECT IF THIS IS A BOILERPLATE OR FEATURE TASK
      // ====================================================================
      const intent = await detectBoilerplateIntent(task_title, projectFiles, anthropic);

      if (intent.isBoilerplate && intent.framework) {
        console.log(`\n${'='.repeat(70)}`);
        console.log('🚀 BOILERPLATE DETECTED - Using CLI Command Approach');
        console.log(`${'='.repeat(70)}`);
        console.log(`Framework: ${intent.framework}`);
        console.log(`Confidence: ${(intent.confidence * 100).toFixed(0)}%`);
        console.log(`Reasoning: ${intent.reasoning}`);
        console.log(`${'='.repeat(70)}\n`);

        // Always fetch latest CLI command from web
        console.log('[Boilerplate] Fetching latest CLI command from web...');
        let cliCommand = null;
        try {
          cliCommand = await searchForLatestCLICommand(intent.framework, anthropic);
          console.log(`[Boilerplate] ✅ Found latest command`);
          console.log(`[Boilerplate] Command: ${cliCommand.command}`);
          console.log(`[Boilerplate] Includes: ${cliCommand.includes.join(', ')}`);
          console.log(`[Boilerplate] Version: ${cliCommand.version}`);
        } catch (error) {
          console.error('[Boilerplate] Web search failed, falling back to AI generation:', error.message);
          // Fall through to AI generation below
          cliCommand = null;
        }

        // Execute CLI command if we have it
        if (cliCommand) {
          try {
            // Check if workspace only has starter files created by Kanbanix
            const starterFiles = ['.gitignore', 'LICENSE', 'README.md'];
            const onlyHasStarterFiles = projectFiles.length > 0 &&
              projectFiles.every(f => starterFiles.includes(f));

            if (onlyHasStarterFiles) {
              console.log('[Boilerplate] Detected starter files from Kanbanix, removing them temporarily...');
              // Remove starter files so CLI can create its own versions
              for (const file of projectFiles) {
                try {
                  await fs.unlink(path.join(workspace_path, file));
                  console.log(`[Boilerplate] Removed: ${file}`);
                } catch (error) {
                  console.error(`[Boilerplate] Failed to remove ${file}:`, error.message);
                }
              }
            }

            // Generate project name from workspace path
            const projectName = path.basename(workspace_path);

            console.log(`[Boilerplate] Creating ${intent.framework} project: ${projectName}`);
            const result = await executeCLICommand(cliCommand.command, workspace_path, projectName);

            // Get list of created files
            const createdFiles = await scanProjectFiles(workspace_path);
            const newFiles = createdFiles.filter(f => !projectFiles.includes(f));

            console.log(`\n${'='.repeat(70)}`);
            console.log('✅ BOILERPLATE CREATED SUCCESSFULLY');
            console.log(`${'='.repeat(70)}`);
            console.log(`Framework: ${intent.framework}`);
            console.log(`Files created: ${newFiles.length}`);
            console.log(`Version: ${cliCommand.version}`);
            console.log(`Includes: ${cliCommand.includes.join(', ')}`);
            console.log(`${'='.repeat(70)}\n`);

            // Return success response
            return {
              success: true,
              framework: intent.framework,
              operation_type: 'boilerplate_cli',
              files: newFiles.reduce((acc, file) => {
                acc[file] = `[Created by ${cliCommand.command}]`;
                return acc;
              }, {}),
              summary: `Created ${intent.framework} boilerplate with ${cliCommand.includes.join(', ')}`,
              version: cliCommand.version,
              source: cliCommand.source,
              dependencies: []
            };
          } catch (error) {
            console.error('[Boilerplate] CLI execution failed:', error.message);
            console.log('[Boilerplate] Falling back to AI generation...');
            // Fall through to AI generation below
          }
        }
      } else {
        console.log(`\n${'='.repeat(70)}`);
        console.log('🎨 FEATURE TASK DETECTED - Using AI Code Generation');
        console.log(`${'='.repeat(70)}`);
        console.log(`Reasoning: ${intent.reasoning}`);
        console.log(`${'='.repeat(70)}\n`);
      }

      // ====================================================================
      // STEP 2: AI CODE GENERATION (for features or fallback)
      // ====================================================================

      // Load package.json if exists
      let packageJson = null;
      try {
        const packagePath = path.join(workspace_path, 'package.json');
        packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
      } catch (e) {
        // No package.json
      }
      
      // Build context-aware prompt
      const contextSection = buildContextAwarePrompt(
        { title: task_title, description: task_description },
        projectContext,
        projectFiles
      );
      
      // Detect what files might be affected
      const affectedFiles = await detectAffectedFiles(task_title, projectFiles, projectContext);
      console.log(`Detected ${affectedFiles.length} potentially affected files`);
      
      // Load content of affected files (FULL CONTENT - NO TRUNCATION)
      const affectedFilesContent = {};
      for (const file of affectedFiles.slice(0, 5)) {
        try {
          const content = await fs.readFile(path.join(workspace_path, file), 'utf-8');
          affectedFilesContent[file] = {
            exists: true,
            content: content, // FIXED: Send FULL content so AI can preserve existing code
            lines: content.split('\n').length,
            size: content.length
          };
        } catch (e) {
          // File doesn't exist yet
        }
      }
      
      // PHASE 4: Type-Aware Pre-Generation Analysis
      let typeAnalysis = null;
      let useTypeAware = false;
      
      // Check if project has TypeScript or complex schemas
      const hasTypeScript = projectFiles.some(f => f.endsWith('.ts') || f.endsWith('.tsx'));
      const hasPrisma = projectFiles.some(f => f.includes('prisma/schema.prisma'));
      
      if (hasTypeScript || hasPrisma) {
        console.log('\n[Phase 4] Type-Aware Generation Enabled!');
        try {
          const typeAwareGen = new TypeAwareGenerator();
          typeAnalysis = await typeAwareGen.analyzer.analyzeProject(workspace_path);
          useTypeAware = true;
          console.log('[Phase 4] Project analysis complete');
        } catch (error) {
          console.log('[Phase 4] Type analysis failed, falling back to standard generation:', error.message);
        }
      }
      
      // Create the enhanced prompt (with type context if available)
      const typeContext = useTypeAware && typeAnalysis ? `
## Type System Context:
- Available Types: ${Array.from(typeAnalysis.types.keys()).slice(0, 20).join(', ')}
- Prisma Models: ${typeAnalysis.schemas.prisma ? Object.keys(typeAnalysis.schemas.prisma.models).join(', ') : 'None'}
- Import Style: ${typeAnalysis.patterns?.importStyle || 'mixed'}
- Component Style: ${typeAnalysis.patterns?.componentStyle || 'function'}
- Styling: ${typeAnalysis.patterns?.styling || 'css'}
` : '';

      const prompt = `Task: ${task_title}
Description: ${task_description || 'No additional description'}

${contextSection}

${typeContext}

## Current Project State:
- Total files: ${projectFiles.length}
- Main directories: ${[...new Set(projectFiles.map(f => f.split('/')[0]))].slice(0, 10).join(', ')}
- Package.json dependencies: ${packageJson ? Object.keys(packageJson.dependencies || {}).slice(0, 15).join(', ') : 'No package.json'}

${Object.keys(affectedFilesContent).length > 0 ? `
## Existing Files to Modify (COMPLETE CONTENT):
${Object.entries(affectedFilesContent).map(([filePath, fileData]) => `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 File: ${filePath} (${fileData.lines} lines, ${fileData.size} characters)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${fileData.content}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`).join('\n')}

⚠️  CRITICAL: These files exist with the COMPLETE content shown above.
You MUST MODIFY them, NOT create duplicates or overwrite!
` : ''}

## Code Generation Requirements:
1. ${projectContext?.backendType ? 'USE EXISTING BACKEND - Do not create new backend infrastructure' : 'Create backend if needed for this task'}
2. ${projectContext?.projectType ? `Follow ${projectContext.projectType} patterns and conventions` : 'Detect and follow project patterns'}
3. ${projectContext?.ormType ? `Use existing ${projectContext.ormType} for database operations` : 'Set up database if needed'}
4. **CRITICAL**: When creating new projects or adding dependencies, ALWAYS use the LATEST STABLE versions (e.g., Next.js 15+, React 19+, not outdated versions like 14.x or 18.x)

## ⚠️  CRITICAL PRESERVATION RULES (READ CAREFULLY):
${Object.keys(affectedFilesContent).length > 0 ? `
**YOU HAVE BEEN GIVEN COMPLETE EXISTING FILES ABOVE. YOUR JOB IS TO ADD/MODIFY, NOT REGENERATE!**

1. **READ THE COMPLETE CONTENT**: The files shown above contain the FULL, COMPLETE, UNTRUNCATED code
2. **IDENTIFY EXISTING FEATURES**: Carefully note ALL existing:
   - Functions, components, variables
   - Styles, colors, CSS classes
   - Event handlers, state management
   - Props, types, interfaces
   - Comments and formatting
3. **PRESERVE EVERYTHING**: Your task is to ADD the requested feature to the existing code
   - DO NOT remove or modify existing features unless explicitly asked
   - DO NOT change existing styles, colors, or CSS classes
   - DO NOT rewrite or refactor code that's working
   - DO NOT change variable names or restructure the code
   - DO NOT remove comments or alter formatting
4. **INCREMENTAL CHANGES ONLY**:
   - Add ONLY what the task requests
   - Keep all existing code exactly as it is
   - Return the COMPLETE modified file with both old and new code
5. **EXAMPLE**: If file has red and green buttons, and task says "add reset button":
   - ✅ CORRECT: Add reset button, KEEP red and green buttons with their colors
   - ❌ WRONG: Add reset button and change all buttons to black/default
` : `
**NEW FILE CREATION MODE**: No existing files detected, you can create from scratch.
`}

6. Build incrementally on previous work
7. When modifying existing files, return the COMPLETE file with ALL original code plus your additions

Output Format:
Return a valid JSON object with:
{
  "framework": "detected framework",
  "operation_type": "modify" or "create" or "replace",
  "modifications": {
    "path/to/file.js": {
      "type": "add_imports" | "add_functions" | "add_to_section" | "merge_objects",
      "imports": ["array of import statements to add"],
      "functions": [{"name": "functionName", "content": "function code"}],
      "section": "section name to add to",
      "content": "content to add",
      "marker": "optional marker to insert after"
    }
  },
  "files": {
    "path/to/file": "file content with proper escaping"
  },
  "summary": "what was done",
  "dependencies": ["new dependencies if any"],
  "context_used": {
    "existing_backend": true/false,
    "modified_existing": true/false,
    "followed_patterns": true/false
  }
}

Return ONLY valid JSON, no markdown or explanations.`;

      console.log('[Context-Enhanced] Calling Claude API with enhanced context...');
      
      // Retry logic for handling overload
      let message;
      let retries = 3;
      let delay = 2000; // Start with 2 second delay

      // Debug: Log actual model being used
      const modelToUse = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
      console.log(`[DEBUG] Using Claude model: ${modelToUse}`);
      console.log(`[DEBUG] CLAUDE_MODEL env var: ${process.env.CLAUDE_MODEL}`);

      while (retries > 0) {
        try {
          message = await anthropic.messages.create({
            model: modelToUse,
            max_tokens: 4096,
            temperature: 0.7,
            messages: [{
              role: 'user',
              content: prompt
            }]
          });
          break; // Success, exit loop
        } catch (error) {
          if (error.status === 529 && retries > 1) {
            console.log(`[Context-Enhanced] API overloaded, retrying in ${delay}ms... (${retries - 1} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff (2s, 4s, 8s)
            retries--;
          } else {
            throw error; // Re-throw if not overload or no retries left
          }
        }
      }
      
      if (!message) {
        throw new Error('Failed to get response from Claude after retries');
      }
      
      // Parse response
      const responseText = message.content[0].text;
      let generatedCode;
      
      try {
        generatedCode = JSON.parse(responseText);
        console.log('[Context-Enhanced] Successfully parsed Claude response');
      } catch (error) {
        console.log('[Context-Enhanced] Failed to parse response, attempting cleanup...');
        // Try to extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            generatedCode = JSON.parse(jsonMatch[0]);
          } catch (e) {
            throw new Error('Could not parse Claude response as JSON');
          }
        } else {
          throw new Error('No JSON found in Claude response');
        }
      }
      
      // Write files to disk with intelligent merging
      const changes = [];
      if (generatedCode.files && workspace_path) {
        console.log(`[Context-Enhanced] Writing ${Object.keys(generatedCode.files).length} files to disk...`);
        
        for (const [filePath, content] of Object.entries(generatedCode.files)) {
          const fullPath = path.join(workspace_path, filePath);
          const dir = path.dirname(fullPath);
          
          // Create directory if it doesn't exist
          await fs.mkdir(dir, { recursive: true });
          
          // Check if file exists
          const exists = await fs.access(fullPath).then(() => true).catch(() => false);
          
          // Prepare content as string
          let fileContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
          
          // If file exists and we're modifying, try to merge intelligently
          if (exists && generatedCode.operation_type !== 'replace') {
            console.log(`[Context-Enhanced] File exists: ${filePath}, attempting intelligent merge...`);
            
            try {
              const existingContent = await fs.readFile(fullPath, 'utf-8');
              
              // Check if this is a modification with specific instructions
              if (generatedCode.modifications && generatedCode.modifications[filePath]) {
                // Apply specific modifications (like adding imports, functions, etc.)
                fileContent = await applyFileModifications(
                  existingContent, 
                  fileContent,
                  generatedCode.modifications[filePath]
                );
                console.log(`[Context-Enhanced] Applied targeted modifications to: ${filePath}`);
              } else {
                // Try to intelligently merge based on file type
                const fileExt = path.extname(filePath);
                
                if (fileExt === '.json') {
                  // For JSON files, try to merge objects
                  try {
                    const existingObj = JSON.parse(existingContent);
                    const newObj = JSON.parse(fileContent);
                    fileContent = JSON.stringify({ ...existingObj, ...newObj }, null, 2);
                    console.log(`[Context-Enhanced] Merged JSON content for: ${filePath}`);
                  } catch (e) {
                    console.log(`[Context-Enhanced] Could not parse as JSON, replacing: ${filePath}`);
                  }
                } else if (fileExt === '.prisma') {
                  // For Prisma schema files, merge models intelligently
                  try {
                    // Extract existing models
                    const existingModels = existingContent.match(/model\s+\w+\s*{[^}]+}/g) || [];
                    const existingModelNames = existingModels.map(m => {
                      const match = m.match(/model\s+(\w+)/);
                      return match ? match[1] : null;
                    }).filter(Boolean);
                    
                    // Extract new models
                    const newModels = fileContent.match(/model\s+\w+\s*{[^}]+}/g) || [];
                    const newModelNames = newModels.map(m => {
                      const match = m.match(/model\s+(\w+)/);
                      return match ? match[1] : null;
                    }).filter(Boolean);
                    
                    // Check for model name conflicts
                    const conflictingModels = existingModelNames.filter(name => newModelNames.includes(name));
                    
                    if (conflictingModels.length > 0) {
                      console.log(`[Context-Enhanced] Updating existing models in Prisma schema: ${conflictingModels.join(', ')}`);
                      // Replace existing models with new versions
                      let mergedContent = existingContent;
                      for (const modelName of conflictingModels) {
                        const oldModel = existingModels.find(m => m.includes(`model ${modelName}`));
                        const newModel = newModels.find(m => m.includes(`model ${modelName}`));
                        if (oldModel && newModel) {
                          mergedContent = mergedContent.replace(oldModel, newModel);
                        }
                      }
                      
                      // Add new models that don't exist
                      const uniqueNewModels = newModels.filter(m => {
                        const modelName = m.match(/model\s+(\w+)/)?.[1];
                        return modelName && !existingModelNames.includes(modelName);
                      });
                      
                      if (uniqueNewModels.length > 0) {
                        // Add new models at the end of the schema
                        mergedContent = mergedContent.trimEnd() + '\n\n' + uniqueNewModels.join('\n\n') + '\n';
                      }
                      
                      fileContent = mergedContent;
                    } else {
                      // No conflicts, just append new models
                      console.log(`[Context-Enhanced] Adding new models to Prisma schema`);
                      fileContent = existingContent.trimEnd() + '\n\n' + newModels.join('\n\n') + '\n';
                    }
                  } catch (e) {
                    console.log(`[Context-Enhanced] Error merging Prisma schema, replacing: ${e.message}`);
                  }
                } else if (['.js', '.ts', '.jsx', '.tsx'].includes(fileExt)) {
                  // For JavaScript/TypeScript files, try to append if it looks like additions
                  // Check if new content references existing content (likely a modification)
                  const existingFunctions = (existingContent.match(/(?:function|const|let|var)\s+(\w+)/g) || [])
                    .map(m => m.split(/\s+/)[1]);
                  const hasReferences = existingFunctions.some(fn => fileContent.includes(fn));
                  
                  if (!hasReferences && !fileContent.includes('export default')) {
                    // Looks like new additions, append to existing
                    console.log(`[Context-Enhanced] Appending new code to: ${filePath}`);
                    
                    // Remove duplicate imports
                    const existingImports = existingContent.match(/^import .+$/gm) || [];
                    const newImports = fileContent.match(/^import .+$/gm) || [];
                    const uniqueNewImports = newImports.filter(imp => 
                      !existingImports.some(existing => existing === imp)
                    );
                    
                    // Remove imports from new content that are already in existing
                    let cleanNewContent = fileContent;
                    newImports.forEach(imp => {
                      if (existingImports.includes(imp)) {
                        cleanNewContent = cleanNewContent.replace(imp + '\n', '');
                      }
                    });
                    
                    // Append the cleaned content
                    fileContent = existingContent + '\n\n' + cleanNewContent;
                  } else {
                    // Has references or exports, probably meant to replace
                    console.log(`[Context-Enhanced] ⚠️ Warning: Replacing file with references: ${filePath}`);
                  }
                } else {
                  // For other file types, default to replacement with warning
                  console.log(`[Context-Enhanced] ⚠️ Warning: Replacing entire file content for: ${filePath}`);
                  console.log(`[Context-Enhanced] Consider using modifications object for better preservation`);
                }
              }
            } catch (error) {
              console.error(`[Context-Enhanced] Error reading existing file: ${error.message}`);
              // Fall back to overwriting if we can't read the file
            }
          }
          
          // PHASE 4: Pre-validate BEFORE writing (if type-aware is enabled)
          let shouldWriteFile = true;
          
          if (useTypeAware && typeAnalysis) {
            console.log(`[Phase 4] Pre-validating ${filePath}...`);
            const TypeAwareGen = await import('./type-aware-generator.js');
            const generator = new TypeAwareGen.TypeAwareGenerator();
            const validator = new TypeAwareGen.PreValidationSystem(workspace_path);

            const validation = await validator.validateBeforeWrite(
              { [filePath]: fileContent },
              typeAnalysis
            );
            
            if (!validation.valid) {
              console.log(`[Phase 4] Validation failed for ${filePath}:`, validation.issues);
              
              // Try to auto-fix the issues
              console.log(`[Phase 4] Attempting to auto-fix ${validation.issues.length} issues...`);
              const fixedContent = await generator.fixValidationIssues(
                fileContent,
                validation.issues,
                typeAnalysis
              );
              
              if (fixedContent && fixedContent !== fileContent) {
                console.log(`[Phase 4] ✅ Auto-fixed issues in ${filePath}`);
                fileContent = fixedContent;
                shouldWriteFile = true;
              } else {
                console.log(`[Phase 4] ❌ Could not auto-fix issues in ${filePath}, skipping file`);
                shouldWriteFile = false;
                // Track validation issues for reporting
                if (!generatedCode.validationIssues) {
                  generatedCode.validationIssues = {};
                }
                generatedCode.validationIssues[filePath] = validation.issues;
              }
            } else {
              console.log(`[Phase 4] ✅ Validation passed for ${filePath}`);
            }
          }
          
          // Only write the file if validation passed or issues were fixed
          if (shouldWriteFile) {
            await fs.writeFile(fullPath, fileContent, 'utf-8');
            console.log(`[Context-Enhanced] ${exists ? 'Modified' : 'Created'} file: ${filePath}`);
            
            changes.push({
              path: filePath,
              type: exists ? 'modified' : 'created'
            });
          } else {
            console.log(`[Context-Enhanced] ⚠️ Skipped writing ${filePath} due to validation errors`);
          }
        }
      }
      
      // Install dependencies if needed
      if (generatedCode.dependencies && generatedCode.dependencies.length > 0 && workspace_path) {
        console.log(`[Context-Enhanced] Installing dependencies: ${generatedCode.dependencies.join(', ')}`);
        const { execSync } = await import('child_process');
        
        try {
          // Check if yarn.lock exists
          const useYarn = await fs.access(path.join(workspace_path, 'yarn.lock')).then(() => true).catch(() => false);
          const cmd = useYarn ? 'yarn add' : 'npm install';
          
          execSync(`${cmd} ${generatedCode.dependencies.join(' ')}`, {
            cwd: workspace_path,
            stdio: 'inherit'
          });
          
          console.log('[Context-Enhanced] Dependencies installed successfully');
        } catch (error) {
          console.error('[Context-Enhanced] Failed to install dependencies:', error.message);
        }
      }
      
      // Update project context with this task
      if (project_id && generatedCode) {
        await updateProjectContextAfterTask(project_id, {
          taskId: `task_${Date.now()}`,
          title: task_title,
          filesCreated: Object.keys(generatedCode.files || {}).filter(f => !affectedFiles.includes(f)),
          filesModified: Object.keys(generatedCode.files || {}).filter(f => affectedFiles.includes(f)),
          summary: generatedCode.summary
        });
      }
      
      // Step 3: Run build validation with Reflection Loop
      console.log('[Context-Enhanced] Starting build validation...');
      const validator = new BuildValidator(anthropic);
      const validationResult = await validator.validateWithReflectionLoop(
        workspace_path,
        generatedCode.files || {},
        5 // max attempts
      );
      
      // Return result based on validation outcome
      if (validationResult.success) {
        console.log('[Context-Enhanced] ✅ Build validation passed');
        return {
          success: true,
          ...generatedCode,
          changes: changes,
          context_aware: true,
          buildValidation: {
            passed: true,
            attempts: validationResult.attempts,
            skipped: validationResult.skipped
          },
          context_used: {
            project_type: projectContext?.projectType,
            backend_type: projectContext?.backendType,
            task_history_available: !!projectContext?.taskHistory
          }
        };
      } else {
        // Build failed but code was generated
        console.log('[Context-Enhanced] ⚠️ Build validation failed - returning with warning');
        return {
          success: false,
          partial: true,
          warningBadge: true,
          ...generatedCode,
          changes: changes,
          context_aware: true,
          buildValidation: {
            passed: false,
            attempts: validationResult.attempts,
            message: validationResult.message
          },
          context_used: {
            project_type: projectContext?.projectType,
            backend_type: projectContext?.backendType,
            task_history_available: !!projectContext?.taskHistory
          },
          message: validationResult.message
        };
      }
    }
  }
];

// Helper functions
async function scanProjectFiles(workspacePath) {
  const files = [];
  
  async function scan(dir, base) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) {
          continue;
        }
        
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(base, fullPath);
        
        if (entry.isDirectory()) {
          await scan(fullPath, base);
        } else {
          files.push(relativePath);
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }
  
  await scan(workspacePath, workspacePath);
  return files;
}

async function detectAffectedFiles(taskTitle, projectFiles, context) {
  const affected = [];
  const taskLower = taskTitle.toLowerCase();
  
  // Use context to better detect affected files
  if (context?.backendType && (taskLower.includes('todo') || taskLower.includes('api'))) {
    // For backend tasks, prioritize backend files
    const backendFiles = context.backendFiles ? JSON.parse(context.backendFiles) : [];
    affected.push(...backendFiles);
  }
  
  // Pattern matching for common file types
  for (const file of projectFiles) {
    const fileLower = file.toLowerCase();
    
    if (taskLower.includes('todo') && fileLower.includes('todo')) {
      affected.push(file);
    } else if (taskLower.includes('counter') && fileLower.includes('counter')) {
      affected.push(file);
    } else if (taskLower.includes('auth') && (fileLower.includes('auth') || fileLower.includes('login'))) {
      affected.push(file);
    }
  }
  
  return [...new Set(affected)];
}

async function updateProjectContextAfterTask(projectId, taskResult) {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const dbPath = path.join(__dirname, '../../../client/prisma/dev.db');
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: `file:${dbPath}`
        }
      }
    });
    
    // Get existing context
    const existing = await prisma.projectContext.findUnique({
      where: { projectId }
    });
    
    // Update task history
    const taskHistory = existing?.taskHistory ? JSON.parse(existing.taskHistory) : [];
    taskHistory.push({
      ...taskResult,
      timestamp: new Date()
    });
    
    // Keep only last 20 tasks
    if (taskHistory.length > 20) {
      taskHistory.shift();
    }
    
    await prisma.projectContext.update({
      where: { projectId },
      data: {
        taskHistory: JSON.stringify(taskHistory),
        updatedAt: new Date()
      }
    });
    
    await prisma.$disconnect();
    console.log('[Context-Enhanced] Updated project context with task results');
  } catch (error) {
    console.error('Error updating context:', error);
  }
}