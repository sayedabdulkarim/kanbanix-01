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
            chunk.includes('Error:')) {
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