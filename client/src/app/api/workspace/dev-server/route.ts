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

// Find an available port
async function findAvailablePort(startPort: number = 3001): Promise<number> {
  return new Promise((resolve) => {
    const checkPort = (port: number) => {
      const server = net.createServer();
      
      server.once('error', () => {
        // Port is busy, try next
        checkPort(port + 1);
      });
      
      server.once('listening', () => {
        server.close();
        resolve(port);
      });
      
      server.listen(port, '127.0.0.1');
    };
    
    checkPort(startPort);
  });
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

    // Check if server already running
    if (devServers.has(projectId)) {
      const server = devServers.get(projectId)!;
      return NextResponse.json({
        success: true,
        status: server.status,
        port: server.port,
        url: server.url,
        startedAt: server.startedAt
      });
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

    // Don't specify port upfront - let the dev server choose
    // Most Next.js/React apps will auto-detect an available port
    let port = 3000; // Default expected port
    let url = `http://localhost:${port}`;

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

    console.log(`Starting dev server: ${command} ${args.join(' ')} in ${workspacePath}`);

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

    // Start dev server process
    const devProcess = spawn(command, args, {
      cwd: workspacePath,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        BROWSER: 'none' // Prevent auto-opening browser
        // Don't set PORT - let the dev server auto-detect available port
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