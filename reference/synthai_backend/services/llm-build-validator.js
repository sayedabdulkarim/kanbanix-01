const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { ClaudeServiceProduction } = require('./claude-service-production');
const QuickFixChecker = require('./quick-fix-checker');
const CSSConfigValidator = require('./css-config-validator');
const FontFixer = require('./font-fixer');
const ConfigFileFixer = require('./config-file-fixer');
const ContextPatternFixer = require('./context-pattern-fixer');
const apiKeyStorage = require('./api-key-storage');

class LLMBuildValidator {
  constructor() {
    this.claudeServiceMCP = new ClaudeServiceProduction(); // MCP-enabled service for error fixing
    this.maxAttempts = 3;
    this.quickFixChecker = new QuickFixChecker();
    this.cssValidator = new CSSConfigValidator();
    this.fontFixer = new FontFixer();
    this.configFixer = new ConfigFileFixer();
    this.contextFixer = new ContextPatternFixer();
  }

  // Get Anthropic client with user's API key
  getAnthropicClient(socketId) {
    const apiKey = apiKeyStorage.getApiKeyWithFallback(socketId);
    if (!apiKey) {
      throw new Error("No API key available. Please provide your Anthropic API key.");
    }
    return new Anthropic({ apiKey });
  }

  /**
   * Main validation loop - build, check errors, fix with LLM, repeat
   */
  async validateAndFix(projectPath, prd, socket, socketId) {
    let attempt = 0;
    
    // Extract project name from path for MCP context
    const projectName = path.basename(projectPath);
    console.log(`🔧 [Build Validator] Starting validation for project: ${projectName}`);
    
    // First, clean up any stale .next directory
    await this.cleanupIncompleteBuilds(projectPath, socket);
    
    // Fix config file issues (next.config.ts -> .js)
    if (socket) {
      socket.emit('output', '\n\x1b[36m> Checking configuration files...\x1b[0m\n');
    }
    
    const configFixes = await this.configFixer.fixConfigFiles(projectPath, socket);
    if (configFixes.length > 0) {
      if (socket) {
        socket.emit('output', `\x1b[32m✓ Fixed config files: ${configFixes.join(', ')}\x1b[0m\n`);
      }
    }
    
    // Fix TypeScript config
    await this.configFixer.fixTypeScriptConfig(projectPath, socket);
    
    // Fix font issues
    if (socket) {
      socket.emit('output', '\n\x1b[36m> Checking for font issues...\x1b[0m\n');
    }
    
    const fontFixed = await this.fontFixer.fixFontIssues(projectPath, socket);
    if (fontFixed) {
      if (socket) {
        socket.emit('output', '\x1b[32m✓ Fixed font configuration\x1b[0m\n');
      }
    }
    
    // Validate CSS/PostCSS configuration
    if (socket) {
      socket.emit('output', '\n\x1b[36m> Validating CSS configuration...\x1b[0m\n');
    }
    
    const cssFixed = await this.cssValidator.validateAndFix(projectPath, socket);
    if (cssFixed.length > 0) {
      if (socket) {
        socket.emit('output', `\x1b[32m✓ Fixed CSS configuration issues: ${cssFixed.join(', ')}\x1b[0m\n`);
      }
    }
    
    while (attempt < this.maxAttempts) {
      attempt++;
      
      if (socket) {
        socket.emit('output', `\n\x1b[1;34m> Build validation attempt ${attempt}/${this.maxAttempts}...\x1b[0m\n`);
      }
      
      // Run build and capture output
      const buildResult = await this.runBuild(projectPath, socket);
      
      // If build passes, also check dev server for runtime errors
      if (buildResult.success) {
        const devCheckResult = await this.checkDevServer(projectPath, socket);
        if (!devCheckResult.success) {
          buildResult.success = false;
          buildResult.output += "\n\nDev Server Errors:\n" + devCheckResult.output;
        }
      }
      
      if (buildResult.success) {
        if (socket) {
          socket.emit('output', '\n\x1b[1;32m✓ Build successful! No errors found.\x1b[0m\n');
        }
        return {
          success: true,
          attempts: attempt
        };
      }
      
      // First try quick fixes for common errors
      if (socket) {
        socket.emit('output', '\n\x1b[36m> Checking for quick fixes...\x1b[0m\n');
      }
      
      const quickFixes = await this.quickFixChecker.applyQuickFixes(buildResult.output, projectPath, socket);
      
      if (quickFixes.length > 0) {
        if (socket) {
          socket.emit('output', `\x1b[32m✓ Applied ${quickFixes.length} quick fixes\x1b[0m\n`);
        }
        
        // Try building again after quick fixes
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      // If no quick fixes or still failing, use LLM
      if (socket) {
        socket.emit('output', '\n\x1b[33m⚠ Build failed. Analyzing errors with AI...\x1b[0m\n');
      }
      
      try {
        const fixes = await this.getFixesFromLLM(buildResult.output, prd, projectPath, projectName);
        
        if (fixes && fixes.files && fixes.files.length > 0) {
          if (socket) {
            socket.emit('output', `\n\x1b[36m> Applying ${fixes.files.length} fixes...\x1b[0m\n`);
          }
          
          // Apply fixes
          for (const file of fixes.files) {
            // CRITICAL: Skip globals.css - it should never be modified
            if (file.path.includes('globals.css')) {
              if (socket) {
                socket.emit('output', `  ⚠ Skipping globals.css (preserving boilerplate configuration)\n`);
              }
              continue;
            }
            
            const filePath = path.join(projectPath, file.path);
            
            // Create directory if needed
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            
            // Write fixed content
            await fs.writeFile(filePath, file.content, 'utf-8');
            
            if (socket) {
              socket.emit('output', `  ✓ Fixed: ${file.path}\n`);
            }
          }
          
          // Add a small delay before next attempt
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          if (socket) {
            socket.emit('output', '\n\x1b[31m✗ No fixes could be generated.\x1b[0m\n');
          }
          break;
        }
      } catch (error) {
        console.error('LLM fix generation failed:', error);
        if (socket) {
          socket.emit('output', `\n\x1b[31m✗ Error generating fixes: ${error.message}\x1b[0m\n`);
          
          // Check for API errors
          if (error.response?.status === 403) {
            socket.emit('output', '\x1b[33m⚠ API key may be invalid or rate limited\x1b[0m\n');
            socket.emit('output', '\x1b[33m⚠ Attempting to continue without AI fixes...\x1b[0m\n');
          }
        }
        
        // Continue to next attempt instead of breaking completely
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Failed after all attempts - clean up and prepare for dev mode
    if (socket) {
      socket.emit('output', '\n\x1b[33m⚠ Build validation reached maximum attempts. Preparing development environment...\x1b[0m\n');
    }
    
    // Clean up incomplete build artifacts
    await this.cleanupIncompleteBuilds(projectPath, socket);
    
    // Run dev server to generate necessary files
    await this.prepareDevEnvironment(projectPath, socket);
    
    return {
      success: false,
      attempts: attempt,
      message: 'Build validation failed but development environment prepared'
    };
  }

  /**
   * Run Next.js build and capture all output
   */
  async runBuild(projectPath, socket) {
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
        
        if (socket) {
          socket.emit('output', chunk);
        }
        
        // Check for error indicators
        if (chunk.includes('Failed to compile') || 
            chunk.includes('Module parse failed') ||
            chunk.includes('Type error:') ||
            chunk.includes('Error:')) {
          hasErrors = true;
        }
      });

      buildProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        hasErrors = true;
        
        if (socket) {
          socket.emit('output', `\x1b[31m${chunk}\x1b[0m`);
        }
      });

      buildProcess.on('close', (code) => {
        resolve({
          success: code === 0 && !hasErrors,
          output: output,
          exitCode: code
        });
      });
    });
  }

  /**
   * Send build errors to LLM and get fixes using MCP-enabled service
   */
  async getFixesFromLLM(buildOutput, prd, projectPath, projectName) {
    try {
      console.log('🔄 [Build Validator] Using MCP-enabled Claude service for error fixing');
      console.log(`📁 [Build Validator] Project name: ${projectName}`);
      
      // Use MCP-enabled Claude service to fix errors with file access
      const fixes = await this.claudeServiceMCP.fixBuildErrorsWithMCP(buildOutput, prd, projectName);
      
      return fixes;
    } catch (error) {
      console.error('MCP-enabled error fixing failed:', error);
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
    const maxErrors = 10; // Limit to prevent token overflow
    
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
        errorLines.push(`\n... and ${errorCount - maxErrors} more errors`);
        break;
      }
    }
    
    return errorLines.join('\n');
  }

  /**
   * Parse JSON with error handling
   */
  parseJSON(content) {
    try {
      // Try direct parsing first
      return JSON.parse(content);
    } catch (error) {
      // Try removing markdown formatting
      const cleaned = content.replace(/```(json)?/g, "").trim();
      
      // Find JSON object in the content
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }
      
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error('Failed to parse LLM response:', content);
        throw new Error(`JSON parse error: ${parseError.message}`);
      }
    }
  }
  
  /**
   * Clean up incomplete build artifacts
   */
  async cleanupIncompleteBuilds(projectPath, socket) {
    const dirsToClean = ['.next', 'node_modules/.cache'];
    
    for (const dir of dirsToClean) {
      const dirPath = path.join(projectPath, dir);
      
      try {
        await fs.access(dirPath);
        
        if (socket) {
          socket.emit('output', `\n\x1b[36m> Cleaning up ${dir}...\x1b[0m\n`);
        }
        
        await fs.rm(dirPath, { recursive: true, force: true });
        
        if (socket) {
          socket.emit('output', `\x1b[32m✓ Cleaned ${dir}\x1b[0m\n`);
        }
      } catch (err) {
        // Directory doesn't exist, which is fine
      }
    }
    
    // Also ensure package-lock.json doesn't conflict with yarn.lock
    try {
      const hasYarnLock = await fs.access(path.join(projectPath, 'yarn.lock')).then(() => true).catch(() => false);
      const hasPackageLock = await fs.access(path.join(projectPath, 'package-lock.json')).then(() => true).catch(() => false);
      
      if (hasYarnLock && hasPackageLock) {
        await fs.unlink(path.join(projectPath, 'package-lock.json'));
        if (socket) {
          socket.emit('output', '\x1b[32m✓ Removed conflicting package-lock.json\x1b[0m\n');
        }
      }
    } catch (err) {
      // Ignore errors
    }
  }
  
  /**
   * Prepare development environment after failed build
   */
  async prepareDevEnvironment(projectPath, socket) {
    if (socket) {
      socket.emit('output', '\n\x1b[36m> Preparing development environment...\x1b[0m\n');
    }
    
    return new Promise((resolve) => {
      // Run dev command briefly to generate necessary files
      const devProcess = spawn('npm', ['run', 'dev'], {
        cwd: projectPath,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          NEXT_TELEMETRY_DISABLED: '1'
        },
        shell: true
      });
      
      let ready = false;
      
      devProcess.stdout.on('data', (data) => {
        const output = data.toString();
        
        if (socket && !ready) {
          socket.emit('output', output);
        }
        
        // Check if dev server is ready
        if (output.includes('Ready in') || 
            output.includes('compiled successfully') ||
            output.includes('✓ Compiled')) {
          ready = true;
          
          if (socket) {
            socket.emit('output', '\n\x1b[32m✓ Development environment ready\x1b[0m\n');
            socket.emit('output', '\x1b[33m⚠ Note: Some build errors may still exist. Check the browser console for details.\x1b[0m\n');
          }
          
          // Kill the process after a short delay
          setTimeout(() => {
            devProcess.kill();
            resolve(true);
          }, 2000);
        }
      });
      
      devProcess.stderr.on('data', (data) => {
        // Ignore stderr for dev preparation
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (!ready) {
          devProcess.kill();
          resolve(false);
        }
      }, 30000);
      
      devProcess.on('close', () => {
        resolve(ready);
      });
    });
  }
  
  /**
   * Check dev server for runtime errors
   */
  async checkDevServer(projectPath, socket) {
    if (socket) {
      socket.emit('output', '\n\x1b[36m> Checking for runtime errors...\x1b[0m\n');
    }
    
    return new Promise((resolve) => {
      const devProcess = spawn('npm', ['run', 'dev'], {
        cwd: projectPath,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          NEXT_TELEMETRY_DISABLED: '1'
        },
        shell: true
      });
      
      let output = '';
      let hasErrors = false;
      const errorPatterns = [
        /Cannot apply unknown utility class/,
        /PostCSS plugin/,
        /Tailwind CSS/,
        /Error:/,
        /Module not found/,
        /Failed to compile/
      ];
      
      const timeout = setTimeout(() => {
        devProcess.kill();
        resolve({
          success: !hasErrors,
          output: output
        });
      }, 15000); // 15 second timeout
      
      devProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        
        // Check for errors
        for (const pattern of errorPatterns) {
          if (pattern.test(chunk)) {
            hasErrors = true;
            break;
          }
        }
        
        // Special check for ENOENT errors
        if (chunk.includes('ENOENT') && chunk.includes('.next')) {
          hasErrors = true;
          output += '\nDetected missing .next directory files. Need clean rebuild.\n';
        }
        
        // If ready without errors, we're good
        if (chunk.includes('Ready in') && !hasErrors) {
          clearTimeout(timeout);
          devProcess.kill();
          resolve({
            success: true,
            output: output
          });
        }
      });
      
      devProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        
        // Check for CSS/PostCSS errors specifically
        if (chunk.includes('Cannot apply unknown utility class') ||
            chunk.includes('PostCSS') ||
            chunk.includes('tailwind')) {
          hasErrors = true;
        }
      });
      
      devProcess.on('close', () => {
        clearTimeout(timeout);
        resolve({
          success: !hasErrors,
          output: output
        });
      });
    });
  }
}

module.exports = LLMBuildValidator;