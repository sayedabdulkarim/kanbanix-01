import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

interface BuildError {
  type: 'typescript' | 'eslint' | 'module' | 'syntax' | 'other';
  file?: string;
  line?: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning';
}

// Parse build output for errors
function parseBuildErrors(output: string): BuildError[] {
  const errors: BuildError[] = [];
  const lines = output.split('\n');
  
  for (const line of lines) {
    // TypeScript errors: file.ts(line,col): error TS2304: Cannot find name 'foo'
    const tsMatch = line.match(/(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+TS\d+:\s*(.+)/);
    if (tsMatch) {
      errors.push({
        type: 'typescript',
        file: tsMatch[1],
        line: parseInt(tsMatch[2]),
        column: parseInt(tsMatch[3]),
        severity: tsMatch[4] as 'error' | 'warning',
        message: tsMatch[5]
      });
      continue;
    }
    
    // ESLint errors
    const eslintMatch = line.match(/(.+?):(\d+):(\d+)\s+(Error|Warning):\s+(.+)/);
    if (eslintMatch) {
      errors.push({
        type: 'eslint',
        file: eslintMatch[1],
        line: parseInt(eslintMatch[2]),
        column: parseInt(eslintMatch[3]),
        severity: eslintMatch[4].toLowerCase() as 'error' | 'warning',
        message: eslintMatch[5]
      });
      continue;
    }
    
    // Module not found errors
    if (line.includes('Module not found') || line.includes('Cannot find module')) {
      const moduleMatch = line.match(/Cannot find module ['"](.+?)['"]/);
      errors.push({
        type: 'module',
        severity: 'error',
        message: line,
        file: moduleMatch ? moduleMatch[1] : undefined
      });
      continue;
    }
    
    // Generic errors
    if (line.includes('Error:') || line.includes('ERROR')) {
      errors.push({
        type: 'other',
        severity: 'error',
        message: line
      });
    }
  }
  
  return errors;
}

// Attempt to fix common errors
async function attemptAutoFix(
  error: BuildError, 
  workspacePath: string,
  executionId?: string
): Promise<boolean> {
  try {
    // Fix missing dependencies
    if (error.type === 'module' && error.message.includes('Cannot find module')) {
      const moduleMatch = error.message.match(/Cannot find module ['"](.+?)['"]/);
      if (moduleMatch) {
        const moduleName = moduleMatch[1];
        
        // Skip relative imports and node built-ins
        if (moduleName.startsWith('.') || moduleName.startsWith('/')) {
          return false;
        }
        
        console.log(`Auto-installing missing module: ${moduleName}`);
        
        // Log the fix attempt
        if (executionId) {
          await prisma.agentLog.create({
            data: {
              executionId,
              level: 'info',
              message: `Auto-fixing: Installing missing dependency '${moduleName}'`,
              metadata: null
            }
          });
        }
        
        // Detect package manager
        let installCmd = 'npm install';
        try {
          await fs.access(path.join(workspacePath, 'yarn.lock'));
          installCmd = 'yarn add';
        } catch {
          try {
            await fs.access(path.join(workspacePath, 'pnpm-lock.yaml'));
            installCmd = 'pnpm add';
          } catch {
            // Use npm
          }
        }
        
        // Install the missing module
        await execAsync(`${installCmd} ${moduleName}`, { cwd: workspacePath });
        
        console.log(`Successfully installed ${moduleName}`);
        return true;
      }
    }
    
    // Fix TypeScript type definition errors
    if (error.type === 'typescript' && error.message.includes('Could not find a declaration file')) {
      const typeMatch = error.message.match(/module '(.+?)'/);
      if (typeMatch) {
        const moduleName = typeMatch[1];
        const typesPackage = `@types/${moduleName.replace('/', '__')}`;
        
        console.log(`Auto-installing types: ${typesPackage}`);
        
        if (executionId) {
          await prisma.agentLog.create({
            data: {
              executionId,
              level: 'info',
              message: `Auto-fixing: Installing type definitions '${typesPackage}'`,
              metadata: null
            }
          });
        }
        
        try {
          await execAsync(`npm install --save-dev ${typesPackage}`, { cwd: workspacePath });
          return true;
        } catch {
          console.log(`Could not install ${typesPackage}, might not exist`);
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error('Auto-fix failed:', error);
    return false;
  }
}

// POST: Run build validation
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId, executionId, autoFix = true } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    const workspacePath = path.join(process.cwd(), 'projects', projectId);
    
    // Check if package.json exists
    try {
      await fs.access(path.join(workspacePath, 'package.json'));
    } catch {
      return NextResponse.json({ 
        error: 'No package.json found in project' 
      }, { status: 400 });
    }

    // Log build start
    if (executionId) {
      await prisma.agentLog.create({
        data: {
          executionId,
          level: 'info',
          message: 'Running build validation...',
          metadata: null
        }
      });
    }

    // Detect build command
    let buildCommand = 'npm run build';
    try {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(workspacePath, 'package.json'), 'utf-8')
      );
      
      if (!packageJson.scripts?.build) {
        // No build script, try to compile TypeScript at least
        buildCommand = 'npx tsc --noEmit';
      } else {
        // Check package manager
        try {
          await fs.access(path.join(workspacePath, 'yarn.lock'));
          buildCommand = 'yarn build';
        } catch {
          try {
            await fs.access(path.join(workspacePath, 'pnpm-lock.yaml'));
            buildCommand = 'pnpm run build';
          } catch {
            // Use npm
          }
        }
      }
    } catch {
      // Fallback to npm
    }

    console.log(`Running build command: ${buildCommand} in ${workspacePath}`);

    // Run build
    try {
      const { stdout, stderr } = await execAsync(buildCommand, {
        cwd: workspacePath,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          CI: 'true' // Treat as CI to get cleaner output
        }
      });

      // Build succeeded
      if (executionId) {
        await prisma.agentLog.create({
          data: {
            executionId,
            level: 'info',
            message: 'Build validation successful',
            metadata: JSON.stringify({ command: buildCommand })
          }
        });
      }

      return NextResponse.json({
        success: true,
        status: 'success',
        command: buildCommand,
        output: stdout + stderr
      });

    } catch (buildError: any) {
      // Build failed - parse errors
      const errorOutput = buildError.stdout + buildError.stderr;
      const errors = parseBuildErrors(errorOutput);
      
      console.log(`Build failed with ${errors.length} errors`);
      
      // Log errors
      if (executionId && errors.length > 0) {
        await prisma.agentLog.create({
          data: {
            executionId,
            level: 'error',
            message: `Build failed with ${errors.length} error(s)`,
            metadata: JSON.stringify({ errors: errors.slice(0, 10) }) // Limit to first 10
          }
        });
      }

      // Attempt auto-fixes if enabled
      let fixedCount = 0;
      if (autoFix && errors.length > 0) {
        console.log('Attempting auto-fixes...');
        
        for (const error of errors.slice(0, 5)) { // Limit auto-fix attempts
          const fixed = await attemptAutoFix(error, workspacePath, executionId);
          if (fixed) fixedCount++;
        }
        
        if (fixedCount > 0) {
          // Log fixes and retry build
          if (executionId) {
            await prisma.agentLog.create({
              data: {
                executionId,
                level: 'info',
                message: `Applied ${fixedCount} auto-fix(es), retrying build...`,
                metadata: null
              }
            });
          }
          
          // Retry build after fixes
          try {
            const { stdout, stderr } = await execAsync(buildCommand, {
              cwd: workspacePath,
              env: { ...process.env, NODE_ENV: 'production', CI: 'true' }
            });
            
            // Build succeeded after fixes
            if (executionId) {
              await prisma.agentLog.create({
                data: {
                  executionId,
                  level: 'info',
                  message: 'Build successful after auto-fixes',
                  metadata: null
                }
              });
            }
            
            return NextResponse.json({
              success: true,
              status: 'success_after_fixes',
              fixedCount,
              command: buildCommand,
              output: stdout + stderr
            });
            
          } catch (retryError: any) {
            // Still failed after fixes
            const retryErrors = parseBuildErrors(retryError.stdout + retryError.stderr);
            
            return NextResponse.json({
              success: false,
              status: 'failed_after_fixes',
              errors: retryErrors,
              fixedCount,
              command: buildCommand,
              output: retryError.stdout + retryError.stderr
            });
          }
        }
      }

      return NextResponse.json({
        success: false,
        status: 'failed',
        errors,
        command: buildCommand,
        output: errorOutput
      });
    }

  } catch (error: any) {
    console.error('Build validation error:', error);
    return NextResponse.json({
      error: 'Failed to run build validation',
      details: error.message
    }, { status: 500 });
  }
}