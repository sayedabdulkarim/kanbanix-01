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
    
    // Fix 3: Extension mismatches (language-aware)
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
    
    // Fix 4: Type errors
    // Type errors - check for specific patterns we can fix
    if (diagnosis.typeErrors && diagnosis.typeErrors.length > 0) {
      console.log(`[BuildValidator] Found ${diagnosis.typeErrors.length} type errors - checking for fixable patterns...`);
      
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
        
        // Check for missing type definitions
        if (error.includes('Cannot find type definition')) {
          const typeMatch = error.match(/Cannot find type definition.*['"]([^'"]+)['"]/i);
          if (typeMatch) {
            console.log(`[BuildValidator] Missing type definition: ${typeMatch[1]}`);
            // Could add @types package or create .d.ts file
          }
        }
      }
      
      if (fixes.length === 0) {
        console.log(`[BuildValidator] No automatic fixes available for ${diagnosis.typeErrors.length} type errors`);
      }
    }
    
    return fixes;
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
  
  // Removed generateAIFixes - AI-based fixes were unreliable
  // Now using deterministic fixes only (ESLint, file creation, etc.)
  
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
      
      // Load content of affected files
      const affectedFilesContent = {};
      for (const file of affectedFiles.slice(0, 5)) {
        try {
          const content = await fs.readFile(path.join(workspace_path, file), 'utf-8');
          affectedFilesContent[file] = {
            exists: true,
            content: content.slice(0, 2000), // Limit content for context
            lines: content.split('\n').length
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
## Existing Files to Modify:
${Object.entries(affectedFilesContent).map(([filePath, fileData]) => `
File: ${filePath} (${fileData.lines} lines)
Preview: ${fileData.content.slice(0, 500)}...
`).join('\n')}

IMPORTANT: These files exist - MODIFY them, don't create duplicates
` : ''}

## Code Generation Requirements:
1. ${projectContext?.backendType ? 'USE EXISTING BACKEND - Do not create new backend infrastructure' : 'Create backend if needed for this task'}
2. ${projectContext?.projectType ? `Follow ${projectContext.projectType} patterns and conventions` : 'Detect and follow project patterns'}
3. ${projectContext?.ormType ? `Use existing ${projectContext.ormType} for database operations` : 'Set up database if needed'}
4. Preserve ALL existing functionality - NEVER overwrite existing code
5. Build incrementally on previous work
6. When modifying existing files, provide modification instructions

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
      
      while (retries > 0) {
        try {
          message = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-latest',  // This should map to Sonnet 4
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
          if (useTypeAware && typeAnalysis) {
            console.log(`[Phase 4] Pre-validating ${filePath}...`);
            const validator = new TypeAwareGenerator().validator || new (await import('./type-aware-generator.js')).PreValidationSystem(workspace_path);
            
            const validation = await validator.validateBeforeWrite(
              { [filePath]: fileContent },
              typeAnalysis
            );
            
            if (!validation.valid) {
              console.log(`[Phase 4] Validation failed for ${filePath}:`, validation.issues);
              // Still write the file but mark it as having issues
              generatedFiles[filePath].validationIssues = validation.issues;
            } else {
              console.log(`[Phase 4] ✅ Validation passed for ${filePath}`);
            }
          }
          
          // Write the file
          await fs.writeFile(fullPath, fileContent, 'utf-8');
          console.log(`[Context-Enhanced] ${exists ? 'Modified' : 'Created'} file: ${filePath}`);
          
          changes.push({
            path: filePath,
            type: exists ? 'modified' : 'created'
          });
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