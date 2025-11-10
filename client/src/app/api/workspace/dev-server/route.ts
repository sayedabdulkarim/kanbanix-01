import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import net from 'net';
import fs from 'fs/promises';

const prisma = new PrismaClient();

// Store running dev servers in memory
const devServers = new Map<string, {
  process: ChildProcess;
  port: number;
  url: string;
  projectId: string;
  taskId?: string;
  startedAt: Date;
  status: 'starting' | 'running' | 'error';
}>();

// Get the main app's port dynamically
function getMainAppPort(): number {
  // Try to get from environment variable
  if (process.env.PORT) {
    return parseInt(process.env.PORT);
  }
  
  // Try to detect from request headers if available
  // For now, default to 3000 for Next.js apps (most common)
  return 3000;
}

// Helper function to clear cache directories
async function clearCacheDirectories(workspacePath: string) {
  const nextBuildDir = path.join(workspacePath, '.next');
  const distDir = path.join(workspacePath, 'dist');
  const buildDir = path.join(workspacePath, 'build');

  try {
    await fs.rm(nextBuildDir, { recursive: true, force: true });
    console.log('✅ Cleared .next cache directory');
  } catch (err) {
    // Directory doesn't exist, which is fine
  }

  try {
    await fs.rm(distDir, { recursive: true, force: true });
    console.log('✅ Cleared dist cache directory');
  } catch (err) {
    // Directory doesn't exist, which is fine
  }

  try {
    await fs.rm(buildDir, { recursive: true, force: true });
    console.log('✅ Cleared build cache directory');
  } catch (err) {
    // Directory doesn't exist, which is fine
  }
}

// Find an available port, with safety limits
async function findAvailablePort(startPort: number = 4000): Promise<number> {
  const maxPort = 9999; // Maximum port to try
  const mainAppPort = getMainAppPort();
  
  // Common development ports to avoid, including the main app port
  const commonPorts = [
    mainAppPort, // Main Kanbanix app port
    3000, 3001, 3002, 3003, // Common Next.js/React
    4000, 4200, // Angular
    5000, 5001, 5173, 5174, // Vite
    8000, 8080, 8081, 8082, // Common backend/Java
    9000, 9001 // Play framework
  ];
  
  return new Promise((resolve, reject) => {
    const checkPort = async (port: number) => {
      // Safety check to prevent infinite loop
      if (port > maxPort) {
        // Try a random port in high range
        port = Math.floor(Math.random() * (9999 - 9500) + 9500);
      }
      
      // Skip common development ports to reduce conflicts
      if (commonPorts.includes(port)) {
        console.log(`Skipping reserved/common port ${port}`);
        checkPort(port + 1);
        return;
      }
      
      const server = net.createServer();
      
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // Port is busy, try next
          console.log(`Port ${port} is in use, trying ${port + 1}`);
          checkPort(port + 1);
        } else {
          reject(err);
        }
      });
      
      server.once('listening', () => {
        server.close(() => {
          console.log(`Found available port: ${port}`);
          resolve(port);
        });
      });
      
      server.listen(port, '127.0.0.1');
    };
    
    // Start checking from the specified port
    checkPort(startPort);
  });
}

// Helper function to cleanup stale dev server
async function cleanupStaleDevServer(projectId: string) {
  if (devServers.has(projectId)) {
    const server = devServers.get(projectId)!;
    
    // Check if the process is actually still running
    try {
      // Send signal 0 to check if process exists (doesn't actually kill it)
      process.kill(server.process.pid!, 0);
      
      // Process exists, check if port is still in use
      const isPortInUse = await new Promise((resolve) => {
        const tester = net.createServer()
          .once('error', () => resolve(true))
          .once('listening', () => {
            tester.close();
            resolve(false);
          })
          .listen(server.port);
      });
      
      if (!isPortInUse) {
        // Port is free, process is probably dead
        console.log(`Removing stale dev server entry for project ${projectId}`);
        devServers.delete(projectId);
        return false;
      }
      
      return true; // Server is still running
    } catch (e) {
      // Process doesn't exist
      console.log(`Dev server process for project ${projectId} no longer exists, cleaning up`);
      devServers.delete(projectId);
      return false;
    }
  }
  return false;
}

// POST: Start dev server
export async function POST(request: NextRequest) {
  try {
    // Check for internal API key for server-to-server calls
    const internalApiKey = request.headers.get('x-internal-api-key');
    // In production, use INTERNAL_API_KEY env var; in dev, allow both
    const isInternalCall = process.env.NODE_ENV === 'development' 
      ? (internalApiKey === process.env.INTERNAL_API_KEY || internalApiKey === 'dev-internal-call')
      : (internalApiKey === process.env.INTERNAL_API_KEY);
    
    // Get session for authentication and session tracking
    let userSession = null;
    if (!isInternalCall) {
      userSession = await getServerSession(authOptions);
      if (!userSession?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { projectId, taskId, executionId, skipValidation } = body;
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    // Check if there's an active session with dev server already started
    const sessionState = await prisma.sessionState.findFirst({
      where: {
        projectId,
        isActive: true
      }
    });

    if (sessionState?.devServerStarted) {
      // Dev server was already started in this session
      console.log(`Dev server already started for session ${sessionState.id} on port ${sessionState.devServerPort}`);
      
      // Check if it's actually still running
      const server = devServers.get(projectId);
      if (server) {
        return NextResponse.json({
          success: true,
          status: 'running',
          port: sessionState.devServerPort!,
          url: sessionState.devServerUrl!,
          command: 'Already running from session',
          startedAt: server.startedAt,
          message: 'Using existing dev server from current session - changes will hot-reload automatically'
        });
      } else {
        // Server info is in session but server is not in memory
        // Check if the port is actually still in use
        const portInUse = await new Promise<boolean>((resolve) => {
          const tester = net.createServer()
            .once('error', (err: any) => {
              if (err.code === 'EADDRINUSE') {
                resolve(true); // Port is in use
              } else {
                resolve(false);
              }
            })
            .once('listening', () => {
              tester.close();
              resolve(false); // Port is free
            })
            .listen(sessionState.devServerPort, '127.0.0.1');
        });
        
        if (portInUse) {
          console.log(`Port ${sessionState.devServerPort} is still in use - dev server is running but lost from memory`);
          // Re-add to memory map to track it
          devServers.set(projectId, {
            process: null as any, // We don't have the process reference anymore
            port: sessionState.devServerPort!,
            url: sessionState.devServerUrl!,
            projectId,
            startedAt: new Date(),
            status: 'running'
          });
          
          return NextResponse.json({
            success: true,
            status: 'running',
            port: sessionState.devServerPort!,
            url: sessionState.devServerUrl!,
            command: 'Already running (recovered)',
            startedAt: new Date(),
            message: 'Using existing dev server from current session - changes will hot-reload automatically'
          });
        } else {
          // Port is free, server actually died - clear session state and start fresh
          console.log('Session indicates dev server should be running but port is free - clearing state');
          await prisma.sessionState.update({
            where: { id: sessionState.id },
            data: {
              devServerStarted: false,
              devServerPort: null,
              devServerUrl: null
            }
          });
        }
      }
    }

    // Check if server already running and cleanup if stale
    if (devServers.has(projectId)) {
      const isStillRunning = await cleanupStaleDevServer(projectId);
      
      if (isStillRunning) {
        const server = devServers.get(projectId)!;
        
        // Server is already running - just return the existing info
        // Dev servers (Next.js, Vite, etc.) automatically hot-reload changes
        console.log(`Dev server already running on port ${server.port} - will hot-reload new changes`);
        
        return NextResponse.json({
          success: true,
          status: 'running',
          port: server.port,
          url: server.url,
          command: 'Already running',
          startedAt: server.startedAt,
          message: 'Using existing dev server - changes will hot-reload automatically'
        });
      }
    }

    // Get workspace path
    const workspacePath = path.join(process.cwd(), '..', 'workspace-projects', projectId);

    // Check if package.json exists
    try {
      await fs.access(path.join(workspacePath, 'package.json'));
    } catch {
      return NextResponse.json({
        error: 'No package.json found. Is the project initialized?'
      }, { status: 400 });
    }

    // ALWAYS clear cache directories before starting dev server
    // This ensures fresh compilation and prevents stale code from being served
    console.log('Clearing cache directories for fresh start...');
    await clearCacheDirectories(workspacePath);

    // Check for and remove potentially corrupted favicon.ico files
    // These often cause "unable to decode image" build errors in Next.js
    // It's safer to remove them and let developers add their own
    console.log('Checking for potentially problematic favicon files...');
    const faviconPatterns = [
      path.join(workspacePath, 'src', 'app', 'favicon.ico'),
      path.join(workspacePath, 'public', 'favicon.ico'),
      path.join(workspacePath, 'app', 'favicon.ico')
    ];

    for (const faviconPath of faviconPatterns) {
      try {
        await fs.access(faviconPath);
        // File exists - remove it preemptively to avoid build errors
        console.log(`🗑️ Removing favicon to prevent build errors: ${path.relative(workspacePath, faviconPath)}`);
        await fs.unlink(faviconPath);
      } catch {
        // File doesn't exist, which is fine
      }
    }

    // Check if node_modules exists, if not install dependencies first
    try {
      await fs.access(path.join(workspacePath, 'node_modules'));
      console.log('Dependencies already installed');
    } catch {
      console.log('node_modules not found, installing dependencies...');
      
      // Detect package manager
      let installer = 'npm';
      try {
        await fs.access(path.join(workspacePath, 'yarn.lock'));
        installer = 'yarn';
      } catch {
        try {
          await fs.access(path.join(workspacePath, 'pnpm-lock.yaml'));
          installer = 'pnpm';
        } catch {
          // Default to npm
        }
      }
      
      console.log(`Installing dependencies with ${installer}...`);
      
      // Install dependencies
      const installProcess = spawn(installer, ['install'], {
        cwd: workspacePath,
        shell: true
      });
      
      await new Promise((resolve, reject) => {
        installProcess.on('close', (code) => {
          if (code === 0) {
            console.log('Dependencies installed successfully');
            resolve(true);
          } else {
            reject(new Error(`Dependency installation failed with code ${code}`));
          }
        });
        
        installProcess.on('error', reject);
        
        // Timeout after 2 minutes
        setTimeout(() => {
          installProcess.kill();
          reject(new Error('Dependency installation timed out'));
        }, 120000);
      });
    }

    // Run build validation before starting dev server (unless skipped)
    if (!skipValidation) {
      console.log('Running build validation before starting dev server...');

      // Detect project type from package.json
      const packageJsonPath = path.join(workspacePath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      let projectType = 'unknown';
      let buildCommand = null;
      
      // Determine project type and build command
      if (deps['next']) {
        projectType = 'nextjs';
        // For Next.js, use 'next build' which will catch all errors
        buildCommand = 'npm run build';
      } else if (deps['vite']) {
        projectType = 'vite';
        buildCommand = 'npm run build';
      } else if (deps['react-scripts']) {
        projectType = 'create-react-app';
        buildCommand = 'npm run build';
      }
      
      console.log(`Detected project type: ${projectType}`);
      
      if (buildCommand && packageJson.scripts?.build) {
        console.log(`Running validation with fresh build: ${buildCommand}`);
        
        // Collect build errors
        const buildErrors: string[] = [];
        let hasErrors = false;
        
        const buildResult = await new Promise<{ success: boolean; errors: string[] }>((resolve) => {
          const buildProcess = spawn(buildCommand, [], {
            cwd: workspacePath,
            shell: true,
            env: { 
              ...process.env, 
              NODE_ENV: 'production',  // Explicitly set to production for build validation
              FORCE_COLOR: '0'  // Removed CI: 'true' to match manual build behavior
            }
          });
          
          let stdout = '';
          let stderr = '';
          
          buildProcess.stdout?.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            console.log('[Build Validation]:', output);
            
            // Check for error indicators in stdout
            if (output.includes('Error:') || 
                output.includes('Failed to compile') ||
                output.includes('ERROR') ||
                output.includes('✖') ||
                output.includes('⨯')) {
              hasErrors = true;
              // Extract error message
              const lines = output.split('\n');
              for (const line of lines) {
                if (line.includes('Error:') || line.includes('⨯')) {
                  buildErrors.push(line.trim());
                }
              }
            }
          });
          
          buildProcess.stderr?.on('data', (data) => {
            const error = data.toString();
            stderr += error;
            console.error('[Build Validation Error]:', error);
            
            // Collect errors from stderr (excluding warnings)
            if (!error.toLowerCase().includes('warning') && 
                !error.toLowerCase().includes('deprecat')) {
              hasErrors = true;
              buildErrors.push(error.trim());
            }
          });
          
          buildProcess.on('close', (code) => {
            console.log(`Build validation exited with code ${code}`);
            
            // Parse errors from combined output if we haven't caught them yet
            if (code !== 0 && buildErrors.length === 0) {
              const combinedOutput = stdout + stderr;
              const lines = combinedOutput.split('\n');
              
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.includes('Error:') || 
                    line.includes('error TS') ||
                    line.includes('Cannot find module') ||
                    line.includes('Module not found') ||
                    line.includes('SyntaxError')) {
                  // Collect this line and next few for context
                  let errorMsg = line;
                  for (let j = 1; j <= 3 && i + j < lines.length; j++) {
                    if (lines[i + j].trim()) {
                      errorMsg += '\n' + lines[i + j];
                    }
                  }
                  buildErrors.push(errorMsg.trim());
                }
              }
            }
            
            resolve({
              success: code === 0 && !hasErrors,
              errors: buildErrors.slice(0, 10) // Limit to 10 errors
            });
          });
          
          // Timeout after 60 seconds
          setTimeout(() => {
            buildProcess.kill();
            resolve({ 
              success: false, 
              errors: ['Build validation timed out after 60 seconds'] 
            });
          }, 60000);
        });
        
        if (!buildResult.success) {
          console.log('Build validation failed, returning errors for fix task creation');
          
          return NextResponse.json({
            success: false,
            status: 'error',
            error: 'Build validation failed - project has errors that need to be fixed',
            buildErrors: buildResult.errors.length > 0 ? 
              buildResult.errors : 
              ['Build failed - check the code for syntax and type errors'],
            projectType,
            suggestion: 'Create a fix task to resolve these errors, or click "Skip Validation" to start anyway'
          }, { status: 500 });
        }
        
        console.log('Build validation passed!');
      } else {
        console.log('No build script found or validation not needed for this project type');
      }
    }
    
    // Find an available port dynamically starting from default (4000)
    // This will skip the main app port and other common development ports
    const port = await findAvailablePort();
    const url = `http://localhost:${port}`;
    
    console.log(`Found available port: ${port} for project ${projectId}`);

    // Detect package manager and use proper prefix to run from correct directory
    let command = 'npm';
    let args = ['run', 'dev', '--prefix', workspacePath];
    
    try {
      await fs.access(path.join(workspacePath, 'yarn.lock'));
      command = 'yarn';
      args = ['--cwd', workspacePath, 'dev'];
    } catch {
      try {
        await fs.access(path.join(workspacePath, 'pnpm-lock.yaml'));
        command = 'pnpm';
        args = ['run', 'dev', '--prefix', workspacePath];
      } catch {
        // Default to npm with --prefix flag
      }
    }

    console.log(`Starting dev server: ${command} ${args.join(' ')} on port ${port} in ${workspacePath}`);

    // Log to execution if provided
    if (executionId) {
      await prisma.agentLog.create({
        data: {
          executionId,
          level: 'info',
          message: `Starting dev server...`,
          metadata: JSON.stringify({ command: `${command} ${args.join(' ')}` })
        }
      });
    }

    // Start dev server process with the specific port
    // Run from client directory since we're using --prefix/--cwd flags
    const devProcess = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: port.toString(), // Force the dev server to use our assigned port
        BROWSER: 'none', // Prevent auto-opening browser
        // Also set common port env vars for different frameworks
        VITE_PORT: port.toString(),
        NUXT_PORT: port.toString(),
        VUE_PORT: port.toString()
      },
      shell: true
    });

    // Store server info
    // Collect errors for potential fixing
    const collectedErrors: string[] = [];
    let hasFailure = false;
    
    const serverInfo = {
      process: devProcess,
      port,
      url,
      projectId,
      taskId,
      startedAt: new Date(),
      status: 'starting' as const,
      errors: collectedErrors
    };
    devServers.set(projectId, serverInfo);

    // Handle stderr early
    devProcess.stderr?.on('data', async (data) => {
      const error = data.toString();
      console.error(`[Dev Server Error ${projectId}]:`, error);
      
      // Collect errors for potential task creation
      if (!error.toLowerCase().includes('warning') && 
          !error.toLowerCase().includes('deprecat')) {
        collectedErrors.push(error);
        
        // Check for build failure indicators
        if (error.includes('ERROR') || 
            error.includes('Failed') || 
            error.includes('Error:') ||
            error.includes('Cannot find module') ||
            error.includes('Module not found')) {
          hasFailure = true;
          const server = devServers.get(projectId);
          if (server) {
            server.status = 'error';
          }
        }
      }
      
      // Log errors if execution provided
      if (executionId && !error.includes('warning')) {
        await prisma.agentLog.create({
          data: {
            executionId,
            level: 'error',
            message: `Dev server error: ${error.substring(0, 500)}`,
            metadata: null
          }
        }).catch(console.error);
      }
    });

    // Create a promise to wait for port detection
    const portDetectedPromise = new Promise<{ port: number; url: string }>((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const server = devServers.get(projectId);
          resolve({ port: server?.port || port, url: server?.url || url });
        }
      }, 10000); // 10 second timeout

      // Handle process output
      devProcess.stdout?.on('data', async (data) => {
        const output = data.toString();
        console.log(`[Dev Server ${projectId}]:`, output);
        
        // Parse actual port from server output
        const portMatch = output.match(/(?:Local|localhost|127\.0\.0\.1)[:\s]+(?:http:\/\/)?(?:localhost|127\.0\.0\.1):(\d+)/i);
        if (portMatch && !resolved) {
          const actualPort = parseInt(portMatch[1]);
          const server = devServers.get(projectId);
          if (server) {
            console.log(`Detected actual port ${actualPort} (was expecting ${server.port})`);
            server.port = actualPort;
            server.url = `http://localhost:${actualPort}`;
            
            // Resolve the promise with actual port
            clearTimeout(timeout);
            resolved = true;
            resolve({ port: actualPort, url: server.url });
          }
        }
        
        // Check if server is ready
        if (output.includes('ready') || 
            output.includes('started') || 
            output.includes('compiled') ||
            output.includes('Local:')) {
          const server = devServers.get(projectId);
          if (server) {
            server.status = 'running';
            
            // Log server ready with actual URL
            if (executionId) {
              await prisma.agentLog.create({
                data: {
                  executionId,
                  level: 'info',
                  message: `Dev server ready at ${server.url}`,
                  metadata: JSON.stringify({ url: server.url, port: server.port })
                }
              }).catch(console.error);
            }
          }
        }
      });
    });

    devProcess.on('error', (error) => {
      console.error(`Failed to start dev server for ${projectId}:`, error);
      const server = devServers.get(projectId);
      if (server) {
        server.status = 'error';
      }
    });

    devProcess.on('exit', (code) => {
      console.log(`Dev server for ${projectId} exited with code ${code}`);
      devServers.delete(projectId);
    });

    // Wait for actual port detection with timeout
    const { port: actualPort, url: actualUrl } = await portDetectedPromise;
    
    // Get the updated server info
    const updatedServer = devServers.get(projectId);
    
    // Check if server failed with errors
    if (updatedServer?.status === 'error' && collectedErrors.length > 0) {
      // Clean up the failed server
      devServers.delete(projectId);
      devProcess.kill();
      
      return NextResponse.json({
        success: false,
        status: 'error',
        error: 'Dev server failed to start due to build errors',
        buildErrors: collectedErrors,
        command: `${command} ${args.join(' ')}`,
        suggestion: 'Create a fix task to resolve these errors'
      }, { status: 500 });
    }

    // Update session state with dev server info
    if (sessionState) {
      await prisma.sessionState.update({
        where: { id: sessionState.id },
        data: {
          devServerStarted: true,
          devServerPort: actualPort,
          devServerUrl: actualUrl
        }
      });
      console.log(`Updated session ${sessionState.id} with dev server info - port: ${actualPort}`);
    }

    return NextResponse.json({
      success: true,
      status: updatedServer?.status || 'starting',
      port: actualPort,
      url: actualUrl,
      command: `${command} ${args.join(' ')}`,
      startedAt: serverInfo.startedAt,
      errors: collectedErrors.length > 0 ? collectedErrors : undefined
    });

  } catch (error: any) {
    console.error('Start dev server error:', error);
    return NextResponse.json({
      error: 'Failed to start dev server',
      details: error.message
    }, { status: 500 });
  }
}

// GET: Check dev server status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    const server = devServers.get(projectId);
    if (!server) {
      return NextResponse.json({
        running: false,
        status: 'stopped'
      });
    }

    return NextResponse.json({
      running: true,
      status: server.status,
      port: server.port,
      url: server.url,
      startedAt: server.startedAt
    });

  } catch (error: any) {
    return NextResponse.json({
      error: 'Failed to get dev server status',
      details: error.message
    }, { status: 500 });
  }
}

// DELETE: Stop dev server
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    const server = devServers.get(projectId);
    if (!server) {
      return NextResponse.json({
        success: true,
        message: 'Server not running'
      });
    }

    // Kill the process and all child processes
    try {
      const pid = server.process.pid;
      if (pid) {
        // On Unix-like systems (macOS/Linux), kill the entire process group
        // This ensures all child processes are killed too
        if (process.platform !== 'win32') {
          // First try to kill the process group (negative PID)
          try {
            process.kill(-pid, 'SIGTERM');
            console.log(`Sent SIGTERM to process group ${pid}`);
          } catch (e) {
            // If process group doesn't exist, just kill the main process
            process.kill(pid, 'SIGTERM');
            console.log(`Sent SIGTERM to process ${pid}`);
          }

          // Wait a bit, then force kill if still alive
          setTimeout(() => {
            try {
              process.kill(-pid, 'SIGKILL');
            } catch (e) {
              // Process already dead, which is fine
            }
          }, 1000);
        } else {
          // Windows: just kill the process
          server.process.kill('SIGTERM');
        }

        // Also kill any process using the port (cleanup)
        const { exec } = require('child_process');
        exec(`lsof -ti:${server.port} | xargs kill -9 2>/dev/null || true`, (error: any) => {
          if (!error) {
            console.log(`Cleaned up port ${server.port}`);
          }
        });
      } else {
        server.process.kill('SIGTERM');
      }
    } catch (e) {
      console.error(`Error killing process:`, e);
    }

    devServers.delete(projectId);

    console.log(`Stopped dev server for project ${projectId}`);

    // Clear cache directories after stopping to ensure fresh start on next run
    const workspacePath = path.join(process.cwd(), '..', 'workspace-projects', projectId);
    console.log('Clearing cache directories after stopping dev server...');
    await clearCacheDirectories(workspacePath);

    // Clear session dev server info
    const sessionState = await prisma.sessionState.findFirst({
      where: {
        projectId,
        isActive: true
      }
    });

    if (sessionState) {
      await prisma.sessionState.update({
        where: { id: sessionState.id },
        data: {
          devServerStarted: false,
          devServerPort: null,
          devServerUrl: null
        }
      });
      console.log(`Cleared dev server info from session ${sessionState.id}`);
    }

    return NextResponse.json({
      success: true,
      message: 'Dev server stopped and cache cleared'
    });

  } catch (error: any) {
    return NextResponse.json({
      error: 'Failed to stop dev server',
      details: error.message
    }, { status: 500 });
  }
}