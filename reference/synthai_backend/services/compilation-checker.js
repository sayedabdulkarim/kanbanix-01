const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const TypeScriptHelper = require('./typescript-helper');
const StructuralFixer = require('./structural-fixer');
const TypeErrorFixer = require('./type-error-fixer');

class CompilationChecker {
  constructor() {
    this.typescriptHelper = new TypeScriptHelper();
    this.structuralFixer = new StructuralFixer();
    this.typeErrorFixer = new TypeErrorFixer();
    this.commonFixes = {
      'useClient': {
        pattern: /You're importing a component that needs.*This React Hook only works in a Client Component/,
        fix: this.addUseClientDirective
      },
      'importError': {
        pattern: /Module not found|Cannot find module/,
        fix: this.fixImportPath
      },
      'typeError': {
        pattern: /Type error:|TS\d+:/,
        fix: this.fixTypeError
      },
      'missingPackage': {
        pattern: /Can't resolve '([^']+)'|Cannot find module '([^']+)'/,
        fix: this.installMissingPackage
      }
    };
  }

  /**
   * Run Next.js build to check for compilation errors
   */
  async checkCompilation(projectPath, socket) {
    if (socket) {
      socket.emit('output', '\n\x1b[1;34m> Running compilation check...\x1b[0m\n');
    }

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

      let stdout = '';
      let stderr = '';
      let hasErrors = false;
      const errors = [];

      buildProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        
        // Check for compilation errors
        if (output.includes('Error:') || output.includes('Failed to compile')) {
          hasErrors = true;
        }
        
        if (socket) {
          socket.emit('output', output);
        }
      });

      buildProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        hasErrors = true;
        
        if (socket) {
          socket.emit('output', `\x1b[31m${output}\x1b[0m`);
        }
      });

      buildProcess.on('close', (code) => {
        resolve({
          success: code === 0 && !hasErrors,
          stdout,
          stderr,
          errors: this.parseErrors(stdout + stderr)
        });
      });
    });
  }

  /**
   * Parse compilation errors from output
   */
  parseErrors(output) {
    const errors = [];
    const lines = output.split('\n');
    
    let currentError = null;
    let inError = false;
    
    for (const line of lines) {
      if (line.includes('Error:') || line.includes('⨯') || line.includes('Type error:')) {
        inError = true;
        currentError = {
          type: 'compilation',
          message: '',
          file: null,
          line: null
        };
      }
      
      if (inError && currentError) {
        currentError.message += line + '\n';
        
        // Extract file path
        const fileMatch = line.match(/[./]*(src\/[^:]+\.(ts|tsx|js|jsx))(?::(\d+):(\d+))?/);
        if (fileMatch) {
          currentError.file = fileMatch[1];
          currentError.line = fileMatch[3] ? parseInt(fileMatch[3]) : null;
        }
        
        // Also check for TypeScript error format
        const tsMatch = line.match(/(.+\.tsx?)\((\d+),(\d+)\)/);
        if (tsMatch && !currentError.file) {
          currentError.file = tsMatch[1];
          currentError.line = parseInt(tsMatch[2]);
        }
        
        // Check if error is complete
        if (line.includes('`----') || (line.trim() === '' && currentError.message.length > 100)) {
          errors.push(currentError);
          currentError = null;
          inError = false;
        }
      }
    }
    
    return errors;
  }

  /**
   * Fix common compilation errors
   */
  async fixErrors(projectPath, errors, socket) {
    const fixes = [];
    
    for (const error of errors) {
      if (socket) {
        socket.emit('output', `\n\x1b[36m> Attempting to fix: ${error.file || 'unknown file'}\x1b[0m\n`);
      }
      
      // Check for use client directive issue
      if (error.message.includes('This React Hook only works in a Client Component')) {
        const fixed = await this.addUseClientDirective(projectPath, error);
        if (fixed) {
          fixes.push({
            file: error.file,
            type: 'use_client',
            success: true
          });
        }
      }
      
      // Check for missing package errors
      const packageMatch = error.message.match(/Can't resolve '([^'\/]+)'/) || 
                          error.message.match(/Cannot find module '([^'\/]+)'/);
      if (packageMatch && !packageMatch[1].startsWith('.') && !packageMatch[1].startsWith('@/')) {
        const fixed = await this.installMissingPackage(projectPath, packageMatch[1], socket);
        if (fixed) {
          fixes.push({
            file: error.file,
            type: 'package_install',
            package: packageMatch[1],
            success: true
          });
          continue; // Skip other checks if package was installed
        }
      }
      
      // Check for TypeScript type errors
      if (error.message.includes('Type error:') || error.message.includes('TS')) {
        // Try the enhanced type error fixer first
        const fixed = await this.typeErrorFixer.fixTypeError(projectPath, error, socket) || 
                      await this.fixTypeError(projectPath, error);
        if (fixed) {
          fixes.push({
            file: error.file,
            type: 'type_error',
            success: true
          });
        }
      }
      
      // Check for import errors
      if (error.message.includes('Module not found') || error.message.includes('Cannot find module')) {
        const fixed = await this.fixImportPath(projectPath, error);
        if (fixed) {
          fixes.push({
            file: error.file,
            type: 'import',
            success: true
          });
        }
      }
    }
    
    return fixes;
  }

  /**
   * Add 'use client' directive to files that need it
   */
  async addUseClientDirective(projectPath, error) {
    if (!error.file) return false;
    
    const filePath = path.join(projectPath, error.file);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Check if already has 'use client'
      if (content.startsWith("'use client'") || content.startsWith('"use client"')) {
        return false;
      }
      
      // Add 'use client' at the beginning
      const newContent = `'use client';\n\n${content}`;
      await fs.writeFile(filePath, newContent, 'utf-8');
      
      console.log(`Added 'use client' directive to ${error.file}`);
      return true;
    } catch (err) {
      console.error(`Failed to fix ${error.file}:`, err);
      return false;
    }
  }

  /**
   * Fix import path errors
   */
  async fixImportPath(projectPath, error) {
    if (!error.file) return false;
    
    const filePath = path.join(projectPath, error.file);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Extract the problematic import
      const importMatch = error.message.match(/Cannot find module '([^']+)'/);
      if (!importMatch) return false;
      
      const badImport = importMatch[1];
      
      // Try to fix common import issues
      let newContent = content;
      
      // Fix missing @ alias
      if (badImport.startsWith('@/')) {
        newContent = content.replace(
          new RegExp(`from ['"]${badImport}['"]`),
          `from '${badImport.replace('@/', '../')}'`
        );
      }
      
      // Fix missing file extensions
      if (!badImport.includes('.')) {
        const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx'];
        for (const ext of possibleExtensions) {
          const testPath = path.join(projectPath, 'src', badImport + ext);
          try {
            await fs.access(testPath);
            newContent = content.replace(
              new RegExp(`from ['"]${badImport}['"]`),
              `from '${badImport}${ext}'`
            );
            break;
          } catch (e) {
            // Continue trying other extensions
          }
        }
      }
      
      if (newContent !== content) {
        await fs.writeFile(filePath, newContent, 'utf-8');
        console.log(`Fixed import path in ${error.file}`);
        return true;
      }
      
      return false;
    } catch (err) {
      console.error(`Failed to fix import in ${error.file}:`, err);
      return false;
    }
  }

  /**
   * Fix TypeScript type errors
   */
  async fixTypeError(projectPath, error) {
    if (!error.file) return false;
    
    const filePath = path.join(projectPath, error.file);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      let newContent = content;
      let fixed = false;
      
      // Check for property does not exist errors (structural mismatches)
      if (error.message.includes('does not exist on type')) {
        // Use the structural fixer for complex mismatches
        const fixed = await this.structuralFixer.analyzeAndFixMismatch(projectPath, error, null);
        if (fixed) return true;
      }
      
      // Check for type literal mismatches
      if (error.message.includes('is not assignable to type')) {
        const literalMatch = error.message.match(/Type '"([^"]+)"' is not assignable to type '([^']+)'/);
        if (literalMatch) {
          const [, wrongValue, expectedType] = literalMatch;
          
          // Extract the line number from error
          const lineMatch = error.message.match(/>(\s*\d+)\s*\|/);
          const lineNumber = lineMatch ? parseInt(lineMatch[1].trim()) : error.line;
          
          // Fix common variant/type mismatches
          if (expectedType.includes('|')) {
            // This is a union type, extract valid values
            const validValues = expectedType.match(/"([^"]+)"/g)?.map(v => v.replace(/"/g, '')) || [];
            
            // Find the closest match
            const closestMatch = this.findClosestMatch(wrongValue, validValues);
            if (closestMatch) {
              // Replace the wrong value with the closest match
              newContent = newContent.replace(
                new RegExp(`(["'])${wrongValue}(["'])`, 'g'),
                `$1${closestMatch}$2`
              );
              fixed = true;
            }
          }
        }
      }
      
      // Fix common type errors
      
      // 1. Missing 'any' type for event handlers
      if (error.message.includes("Parameter 'e' implicitly has an 'any' type")) {
        newContent = newContent.replace(
          /(\w+)\s*=\s*\((e)\)\s*=>/g,
          '$1 = ($2: any) =>'
        );
        fixed = true;
      }
      
      // 2. Missing return type
      if (error.message.includes('Missing return type on function')) {
        // Add void return type to functions without explicit return
        newContent = newContent.replace(
          /const\s+(\w+)\s*=\s*\(([^)]*)\)\s*=>/g,
          (match, name, params) => {
            if (!match.includes(':') && !content.includes(`return`)) {
              return `const ${name} = (${params}): void =>`;
            }
            return match;
          }
        );
        fixed = true;
      }
      
      // 3. Unused variables
      if (error.message.includes("is declared but its value is never read")) {
        const varMatch = error.message.match(/'([^']+)' is declared but/);
        if (varMatch) {
          const varName = varMatch[1];
          // Prefix with underscore to indicate intentionally unused
          newContent = newContent.replace(
            new RegExp(`\\b${varName}\\b`, 'g'),
            `_${varName}`
          );
          fixed = true;
        }
      }
      
      // 4. Missing types for useState
      if (error.message.includes("Argument of type") && content.includes('useState')) {
        // Add explicit types to useState calls
        newContent = newContent.replace(
          /useState\(([^)]*)\)/g,
          (match, initialValue) => {
            if (initialValue === '0' || !isNaN(Number(initialValue))) {
              return `useState<number>(${initialValue})`;
            } else if (initialValue === "''") {
              return `useState<string>(${initialValue})`;
            } else if (initialValue === 'true' || initialValue === 'false') {
              return `useState<boolean>(${initialValue})`;
            } else if (initialValue === '[]') {
              return `useState<any[]>(${initialValue})`;
            } else if (initialValue === '{}') {
              return `useState<Record<string, any>>(${initialValue})`;
            }
            return match;
          }
        );
        fixed = true;
      }
      
      // 5. Fix missing props types
      if (error.message.includes("Binding element") && error.message.includes("implicitly has an 'any' type")) {
        // Add any type to destructured props
        newContent = newContent.replace(
          /\(\{([^}]+)\}\)\s*=>/g,
          '({ $1 }: any) =>'
        );
        fixed = true;
      }
      
      if (fixed && newContent !== content) {
        await fs.writeFile(filePath, newContent, 'utf-8');
        console.log(`Fixed type error in ${error.file}`);
        return true;
      }
      
      return false;
    } catch (err) {
      console.error(`Failed to fix type error in ${error.file}:`, err);
      return false;
    }
  }

  /**
   * Install missing package
   */
  async installMissingPackage(projectPath, packageName, socket) {
    if (socket) {
      socket.emit('output', `\n\x1b[36m> Installing missing package: ${packageName}...\x1b[0m\n`);
    }
    
    try {
      // Use yarn if yarn.lock exists, otherwise npm
      const hasYarnLock = await fs.access(path.join(projectPath, 'yarn.lock'))
        .then(() => true)
        .catch(() => false);
      
      const packageManager = hasYarnLock ? 'yarn' : 'npm';
      const installCommand = hasYarnLock ? 'add' : 'install';
      
      return new Promise((resolve) => {
        const installProcess = spawn(packageManager, [installCommand, packageName], {
          cwd: projectPath,
          shell: true,
          env: {
            ...process.env,
            CI: 'false' // Allow interactive install
          }
        });
        
        installProcess.stdout.on('data', (data) => {
          if (socket) {
            socket.emit('output', data.toString());
          }
        });
        
        installProcess.stderr.on('data', (data) => {
          if (socket) {
            socket.emit('output', data.toString());
          }
        });
        
        installProcess.on('close', (code) => {
          if (code === 0) {
            console.log(`Successfully installed ${packageName}`);
            if (socket) {
              socket.emit('output', `\x1b[32m✓ Package ${packageName} installed successfully\x1b[0m\n`);
            }
            resolve(true);
          } else {
            console.error(`Failed to install ${packageName}, exit code: ${code}`);
            if (socket) {
              socket.emit('output', `\x1b[31m✗ Failed to install ${packageName}\x1b[0m\n`);
            }
            resolve(false);
          }
        });
      });
    } catch (err) {
      console.error(`Error installing package ${packageName}:`, err);
      return false;
    }
  }

  /**
   * Run full check and fix cycle
   */
  async checkAndFix(projectPath, socket, maxAttempts = 3) {
    let attempt = 0;
    let lastResult = null;
    
    // First, clean up any incomplete builds
    await this.cleanupBuildArtifacts(projectPath, socket);
    
    // Ensure proper TypeScript configuration
    if (socket) {
      socket.emit('output', '\n\x1b[36m> Setting up TypeScript configuration...\x1b[0m\n');
    }
    await this.typescriptHelper.ensureStrictTypeChecking(projectPath);
    await this.typescriptHelper.createTypeDeclarations(projectPath);
    
    while (attempt < maxAttempts) {
      attempt++;
      
      if (socket) {
        socket.emit('output', `\n\x1b[1;34m> Compilation check attempt ${attempt}/${maxAttempts}...\x1b[0m\n`);
      }
      
      // Run compilation check
      const result = await this.checkCompilation(projectPath, socket);
      lastResult = result;
      
      if (result.success) {
        if (socket) {
          socket.emit('output', '\n\x1b[1;32m✓ Compilation successful! No errors found.\x1b[0m\n');
          socket.emit('output', '\n\x1b[36m> Running development server preparation...\x1b[0m\n');
        }
        
        // Ensure development server can start properly
        await this.prepareDevServer(projectPath, socket);
        
        return {
          success: true,
          attempts: attempt,
          fixes: []
        };
      }
      
      // Try to fix errors
      if (result.errors.length > 0) {
        if (socket) {
          socket.emit('output', `\n\x1b[33m⚠ Found ${result.errors.length} errors. Attempting automatic fixes...\x1b[0m\n`);
        }
        
        const fixes = await this.fixErrors(projectPath, result.errors, socket);
        
        if (fixes.length === 0) {
          // No fixes could be applied
          break;
        }
        
        if (socket) {
          socket.emit('output', `\n\x1b[32m✓ Applied ${fixes.length} fixes. Rechecking...\x1b[0m\n`);
        }
        
        // Give the system a moment before rechecking
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        // No specific errors found but compilation failed
        break;
      }
    }
    
    // Failed after all attempts
    return {
      success: false,
      attempts: attempt,
      errors: lastResult?.errors || [],
      message: 'Compilation failed after automatic fix attempts'
    };
  }
  
  /**
   * Fix structural mismatches between hooks and components
   */
  async fixHookStructuralMismatch(projectPath, componentFile, hookName, missingProperty) {
    try {
      // Find the hook file
      const hooksDir = path.join(projectPath, 'src', 'hooks');
      const hookFiles = await fs.readdir(hooksDir);
      const hookFile = hookFiles.find(f => f.includes(hookName.slice(3))); // Remove 'use' prefix
      
      if (!hookFile) return false;
      
      const hookPath = path.join(hooksDir, hookFile);
      const hookContent = await fs.readFile(hookPath, 'utf-8');
      
      // Check if this is a modal-related property
      if (missingProperty === 'isResetModalOpen' || 
          missingProperty === 'openResetModal' || 
          missingProperty === 'closeResetModal') {
        
        // Add modal state to the hook
        let updatedHookContent = hookContent;
        
        // Add state declaration after other useState calls
        const lastUseStateIndex = hookContent.lastIndexOf('useState');
        const lineEnd = hookContent.indexOf('\n', lastUseStateIndex);
        
        if (lineEnd !== -1) {
          const modalStateCode = `\n  const [isResetModalOpen, setIsResetModalOpen] = useState(false);\n  \n  const openResetModal = () => setIsResetModalOpen(true);\n  const closeResetModal = () => setIsResetModalOpen(false);`;
          
          updatedHookContent = hookContent.slice(0, lineEnd) + modalStateCode + hookContent.slice(lineEnd);
          
          // Update the reset function to remove window.confirm
          updatedHookContent = updatedHookContent.replace(
            /const reset = \(\) => {[\s\S]*?};/,
            `const reset = () => {\n    setCount(0);\n    closeResetModal();\n  };`
          );
          
          // Update the return statement
          const returnMatch = updatedHookContent.match(/return\s*{([^}]+)}/s);
          if (returnMatch) {
            const currentReturns = returnMatch[1].trim();
            const newReturns = currentReturns + `,\n    isResetModalOpen,\n    openResetModal,\n    closeResetModal`;
            updatedHookContent = updatedHookContent.replace(
              /return\s*{[^}]+}/s,
              `return {\n    ${newReturns}\n  }`
            );
          }
          
          await fs.writeFile(hookPath, updatedHookContent, 'utf-8');
          console.log(`Fixed structural mismatch in ${hookName} hook`);
          return true;
        }
      }
      
      return false;
    } catch (err) {
      console.error(`Failed to fix hook structural mismatch:`, err);
      return false;
    }
  }
  
  /**
   * Find the closest matching string from a list of valid values
   */
  findClosestMatch(input, validValues) {
    // Common mappings
    const mappings = {
      'decrease': 'decrement',
      'increase': 'increment',
      'submit': 'onSubmit',
      'click': 'onClick',
      'change': 'onChange'
    };
    
    // Check direct mapping
    if (mappings[input]) {
      return validValues.includes(mappings[input]) ? mappings[input] : null;
    }
    
    // Check if input is a substring of any valid value
    for (const valid of validValues) {
      if (valid.includes(input) || input.includes(valid)) {
        return valid;
      }
    }
    
    // Levenshtein distance for fuzzy matching
    let bestMatch = null;
    let bestDistance = Infinity;
    
    for (const valid of validValues) {
      const distance = this.levenshteinDistance(input.toLowerCase(), valid.toLowerCase());
      if (distance < bestDistance && distance <= 3) { // Max 3 character difference
        bestDistance = distance;
        bestMatch = valid;
      }
    }
    
    return bestMatch;
  }
  
  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }
  
  /**
   * Clean up incomplete build artifacts
   */
  async cleanupBuildArtifacts(projectPath, socket) {
    const nextDir = path.join(projectPath, '.next');
    const nodeModulesCacheDir = path.join(projectPath, 'node_modules', '.cache');
    
    try {
      // Check if .next directory exists
      await fs.access(nextDir);
      
      if (socket) {
        socket.emit('output', '\n\x1b[36m> Cleaning up incomplete build artifacts...\x1b[0m\n');
      }
      
      // Remove the .next directory
      await fs.rm(nextDir, { recursive: true, force: true });
      
      if (socket) {
        socket.emit('output', '\x1b[32m✓ Build artifacts cleaned\x1b[0m\n');
      }
    } catch (err) {
      // Directory doesn't exist, which is fine
    }
    
    try {
      // Also clean node_modules cache to prevent corrupted module builds
      await fs.access(nodeModulesCacheDir);
      await fs.rm(nodeModulesCacheDir, { recursive: true, force: true });
      
      if (socket) {
        socket.emit('output', '\x1b[32m✓ Module cache cleaned\x1b[0m\n');
      }
    } catch (err) {
      // Cache directory doesn't exist, which is fine
    }
  }
  
  /**
   * Prepare for development server
   */
  async prepareDevServer(projectPath, socket) {
    // Run a quick dev build to generate necessary files
    return new Promise((resolve) => {
      const prepProcess = spawn('npm', ['run', 'dev'], {
        cwd: projectPath,
        env: {
          ...process.env,
          NODE_ENV: 'development'
        },
        shell: true
      });
      
      let outputBuffer = '';
      
      prepProcess.stdout.on('data', (data) => {
        outputBuffer += data.toString();
        
        // Check if dev server is ready
        if (outputBuffer.includes('Ready in') || 
            outputBuffer.includes('compiled client and server successfully') ||
            outputBuffer.includes('✓ Compiled')) {
          // Kill the process once it's ready
          prepProcess.kill();
          resolve(true);
        }
      });
      
      prepProcess.stderr.on('data', (data) => {
        const output = data.toString();
        if (!output.includes('Deprecation Warning')) {
          console.error('Dev prep error:', output);
        }
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        prepProcess.kill();
        resolve(true);
      }, 30000);
      
      prepProcess.on('close', () => {
        resolve(true);
      });
    });
  }
}

module.exports = CompilationChecker;