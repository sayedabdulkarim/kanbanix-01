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
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId, taskId, executionId } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    // Check if server already running and cleanup if stale
    if (devServers.has(projectId)) {
      const isStillRunning = await cleanupStaleDevServer(projectId);
      
      if (isStillRunning) {
        const server = devServers.get(projectId)!;
        
        // Kill the existing server to force restart with new code
        console.log(`Killing existing dev server on port ${server.port} to restart with new code`);
        try {
          server.process.kill('SIGTERM');
          // Give it a moment to cleanup
          await new Promise(resolve => setTimeout(resolve, 1000));
          // Force kill if still running
          try {
            process.kill(server.process.pid!, 0);
            server.process.kill('SIGKILL');
          } catch {
            // Process already dead
          }
        } catch (e) {
          console.error('Error killing dev server:', e);
        }
        
        // Remove from map
        devServers.delete(projectId);
        
        // Continue to start new server below
      }
    }

    // Get workspace path
    const workspacePath = path.join(process.cwd(), 'projects', projectId);
    
    // Check if package.json exists
    try {
      await fs.access(path.join(workspacePath, 'package.json'));
    } catch {
      return NextResponse.json({ 
        error: 'No package.json found. Is the project initialized?' 
      }, { status: 400 });
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

    // Find an available port dynamically starting from default (4000)
    // This will skip the main app port and other common development ports
    const port = await findAvailablePort();
    const url = `http://localhost:${port}`;
    
    console.log(`Found available port: ${port} for project ${projectId}`);

    // Detect package manager
    let command = 'npm';
    let args = ['run', 'dev'];
    
    try {
      await fs.access(path.join(workspacePath, 'yarn.lock'));
      command = 'yarn';
      args = ['dev'];
    } catch {
      try {
        await fs.access(path.join(workspacePath, 'pnpm-lock.yaml'));
        command = 'pnpm';
        args = ['run', 'dev'];
      } catch {
        // Default to npm
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
    const devProcess = spawn(command, args, {
      cwd: workspacePath,
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
    const serverInfo = {
      process: devProcess,
      port,
      url,
      projectId,
      taskId,
      startedAt: new Date(),
      status: 'starting' as const
    };
    devServers.set(projectId, serverInfo);

    // Handle stderr early
    devProcess.stderr?.on('data', async (data) => {
      const error = data.toString();
      console.error(`[Dev Server Error ${projectId}]:`, error);
      
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

    // Wait for actual port detection
    const { port: actualPort, url: actualUrl } = await portDetectedPromise;
    
    // Get the updated server info
    const updatedServer = devServers.get(projectId);

    return NextResponse.json({
      success: true,
      status: updatedServer?.status || 'starting',
      port: actualPort,
      url: actualUrl,
      command: `${command} ${args.join(' ')}`,
      startedAt: serverInfo.startedAt
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

    // Kill the process
    server.process.kill('SIGTERM');
    devServers.delete(projectId);

    console.log(`Stopped dev server for project ${projectId}`);

    return NextResponse.json({
      success: true,
      message: 'Dev server stopped'
    });

  } catch (error: any) {
    return NextResponse.json({
      error: 'Failed to stop dev server',
      details: error.message
    }, { status: 500 });
  }
}