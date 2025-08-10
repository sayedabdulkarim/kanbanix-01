const { spawn } = require('child_process');
const { findAvailablePort } = require('../utils/port-finder');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const projectTracker = require('./project-tracker');

class ProjectManager {
  constructor() {
    // Store running projects with their processes and ports
    this.runningProjects = new Map();
    // Store reference to io instance for broadcasting
    this.io = null;
  }
  
  /**
   * Set the io instance for broadcasting
   * @param {Server} io - Socket.io server instance
   */
  setIo(io) {
    this.io = io;
  }

  /**
   * Start a Next.js project
   * @param {string} projectPath - Path to the project
   * @param {string} projectName - Name of the project (optional)
   * @param {Socket} socket - Socket connection for terminal output
   * @returns {Promise<{port: number, url: string, projectName: string}>}
   */
  async startProject(projectPath, projectName, socket) {
    // If projectName is actually a socket (backward compatibility)
    if (typeof projectName === 'object' && projectName !== null && !socket) {
      socket = projectName;
      projectName = null;
    }
    
    // If no projectName provided, derive from path
    if (!projectName) {
      projectName = path.basename(projectPath);
    }
    
    // Check if project is already running
    if (this.runningProjects.has(projectName)) {
      const existing = this.runningProjects.get(projectName);
      return { port: existing.port, url: existing.url };
    }

    try {
      // Clean up .next directory to prevent build artifact conflicts
      const nextDir = path.join(projectPath, '.next');
      const nodeModulesCacheDir = path.join(projectPath, 'node_modules', '.cache');
      
      try {
        await fs.rm(nextDir, { recursive: true, force: true });
        if (socket) {
          socket.emit('output', `\n\x1b[36m> Cleaned build artifacts\x1b[0m\n`);
        }
      } catch (cleanupError) {
        // Directory might not exist, that's ok
        console.log('No .next directory to clean');
      }
      
      // In production, clean up conflicting lockfiles
      if (process.env.NODE_ENV === 'production') {
        try {
          // Remove yarn.lock if it exists (we use npm)
          const yarnLock = path.join(projectPath, 'yarn.lock');
          await fs.rm(yarnLock, { force: true });
          console.log('Removed yarn.lock to prevent conflicts');
        } catch (e) {
          // File might not exist, that's ok
        }
      }
      
      // Also clean node_modules cache
      try {
        await fs.rm(nodeModulesCacheDir, { recursive: true, force: true });
        if (socket) {
          socket.emit('output', `\x1b[36m> Cleaned module cache\x1b[0m\n`);
        }
      } catch (cleanupError) {
        // Cache might not exist, that's ok
        console.log('No node_modules cache to clean');
      }

      // Check if node_modules exists, if not install dependencies
      const nodeModulesPath = path.join(projectPath, 'node_modules');
      const packageJsonPath = path.join(projectPath, 'package.json');
      
      try {
        await fs.access(nodeModulesPath);
        await fs.access(packageJsonPath);
        
        // Check if node_modules is outdated by comparing package.json and node_modules timestamps
        const packageJsonStat = await fs.stat(packageJsonPath);
        const nodeModulesStat = await fs.stat(nodeModulesPath);
        
        if (packageJsonStat.mtime > nodeModulesStat.mtime) {
          throw new Error('Dependencies need to be updated');
        }
      } catch (error) {
        // Install dependencies
        if (socket) {
          socket.emit('output', `\n\x1b[1;33m> Installing dependencies...\x1b[0m\n`);
        }
        
        const installProcess = spawn('npm', ['install', '--legacy-peer-deps'], {
          cwd: projectPath,
          env: {
            ...process.env,
            NODE_ENV: 'development',
            npm_config_loglevel: 'error'
          },
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        // Pipe install output to socket
        if (socket) {
          installProcess.stdout.on('data', (data) => {
            socket.emit('output', data.toString());
          });
          
          installProcess.stderr.on('data', (data) => {
            socket.emit('output', `\x1b[31m${data.toString()}\x1b[0m`);
          });
        }
        
        // Wait for installation to complete
        await new Promise((resolve, reject) => {
          installProcess.on('close', (code) => {
            if (code === 0) {
              if (socket) {
                socket.emit('output', `\x1b[32m> Dependencies installed successfully!\x1b[0m\n`);
              }
              resolve();
            } else {
              reject(new Error(`npm install failed with code ${code}`));
            }
          });
        });
      }

      // Find an available port starting from 3002 (to avoid conflicts with main app)
      const port = await findAvailablePort(3002);
      
      if (socket) {
        socket.emit('output', `\n\x1b[1;34m> Starting development server on port ${port}...\x1b[0m\n`);
        // Emit status event for project starting
        socket.emit('project:status', {
          projectName,
          stage: 'server_starting',
          message: 'Starting development server...'
        });
      }

      // Start the Next.js development server
      // In production, we need to be more careful with paths and environment
      const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const childProcess = spawn(npmCommand, ['run', 'dev', '--', '--port', port.toString()], {
        cwd: projectPath,
        env: {
          ...process.env,
          PORT: port.toString(),
          NODE_ENV: 'development', // Always run generated projects in development mode
          // Disable inspector to avoid port conflicts
          NODE_OPTIONS: '--inspect=false',
          // Ensure Next.js uses the correct port
          NEXT_TELEMETRY_DISABLED: '1', // Disable telemetry to reduce startup time
          npm_config_loglevel: 'error', // Reduce npm noise
          // Force npm to use the project's lockfile
          npm_config_package_lock_only: 'false'
        },
        shell: process.platform === 'win32', // Only use shell on Windows
        // Ensure proper signal handling
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Handle stdout
      childProcess.stdout.on('data', (data) => {
        const output = data.toString();
        if (socket) {
          // Format Next.js output
          let formattedOutput = output;
          if (output.includes('Ready in') || output.includes('started server')) {
            formattedOutput = `\x1b[1;32m${output}\x1b[0m`;
          } else if (output.includes('Compiling') || output.includes('Building')) {
            formattedOutput = `\x1b[1;36m${output}\x1b[0m`;
          } else if (output.includes('Warning')) {
            formattedOutput = `\x1b[1;33m${output}\x1b[0m`;
          }
          socket.emit('output', formattedOutput);
        }
        console.log(`[${projectName}]:`, output);
      });

      // Handle stderr
      childProcess.stderr.on('data', (data) => {
        const output = data.toString();
        if (socket) {
          socket.emit('output', `\x1b[1;31m${output}\x1b[0m`);
        }
        console.error(`[${projectName} ERROR]:`, output);
      });

      // Handle process errors
      childProcess.on('error', (error) => {
        console.error(`[${projectName}] Process error:`, error);
        if (socket) {
          socket.emit('output', `\n\x1b[1;31m> Process error: ${error.message}\x1b[0m\n`);
        }
      });

      // Handle process exit
      childProcess.on('close', (code, signal) => {
        console.log(`[${projectName}] Process exited with code ${code}, signal ${signal}`);
        
        // Only remove from tracking if not a SIGTERM (container restart)
        if (signal !== 'SIGTERM') {
          this.runningProjects.delete(projectName);
          projectTracker.removeProject(projectName);
        } else {
          console.log(`[${projectName}] Received SIGTERM - keeping project in tracker for production restart`);
          // Remove from in-memory map but keep in tracker
          this.runningProjects.delete(projectName);
        }
        
        // Determine exit reason
        let exitReason = 'Development server stopped';
        if (signal) {
          exitReason = `Process terminated by signal ${signal}`;
        } else if (code !== 0) {
          exitReason = `Process exited with error code ${code}`;
        }
        
        if (socket) {
          socket.emit('output', `\n\x1b[1;33m> ${exitReason} (exit code: ${code})\x1b[0m\n`);
          // Emit status event for server stopped
          socket.emit('project:status', {
            projectName,
            stage: 'server_stopped',
            message: exitReason,
            exitCode: code,
            signal: signal
          });
          
          // Broadcast to all connected clients
          const socketIo = socket.nsp && socket.nsp.server;
          const broadcastIo = socketIo || this.io;
          if (broadcastIo) {
            broadcastIo.emit('project:stopped', {
              projectName,
              exitCode: code,
              signal: signal
            });
          }
        }
      });

      // Store the project info
      // In production, create a proxy URL; in development, use localhost
      const isProduction = process.env.NODE_ENV === 'production';
      const url = isProduction 
        ? `${process.env.CLIENT_URL || ''}/project-preview/${projectName}`
        : `http://localhost:${port}`;
        
      const projectInfo = {
        process: childProcess,
        port,
        url,
        projectPath,
        startTime: new Date()
      };
      
      this.runningProjects.set(projectName, projectInfo);
      
      // Also add to persistent tracker
      projectTracker.addProject(projectName, {
        port,
        url,
        projectPath,
        startTime: new Date()
      });

      // Wait a bit for the server to start, but check if process is still alive
      let serverStarted = false;
      let attempts = 0;
      const maxAttempts = 20; // More attempts for production
      
      while (!serverStarted && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait longer in production
        attempts++;
        
        // Check if process is still running
        if (childProcess.killed) {
          throw new Error(`Process was killed`);
        }
        
        // Check if process exited (but only throw error for non-zero exit codes)
        if (childProcess.exitCode !== null && childProcess.exitCode !== 0) {
          throw new Error(`Process exited with error code ${childProcess.exitCode}`);
        }
        
        // Check if we can connect to the server
        try {
          const testResponse = await axios.get(`http://localhost:${port}`, { 
            timeout: 1000,
            validateStatus: () => true 
          });
          if (testResponse.status < 500) {
            serverStarted = true;
          }
        } catch (e) {
          // Server not ready yet
          console.log(`Waiting for server to start... attempt ${attempts}/${maxAttempts}`);
        }
      }
      
      if (!serverStarted) {
        throw new Error('Server failed to start within timeout period');
      }

      if (socket) {
        socket.emit('output', `\n\x1b[1;32m✓ Development server started successfully!\x1b[0m\n`);
        socket.emit('output', `\x1b[1;36m> Access your project at: ${url}\x1b[0m\n\n`);
        // Emit status event for server ready
        socket.emit('project:status', {
          projectName,
          stage: 'server_ready',
          message: 'Development server ready!',
          url,
          port
        });
        
        // Broadcast to all connected clients
        // Try to get io from socket first, then use global io
        const socketIo = socket.nsp && socket.nsp.server;
        const broadcastIo = socketIo || this.io;
        if (broadcastIo) {
          broadcastIo.emit('project:running', {
            projectName,
            url,
            port
          });
        }
      }

      return { port, url, projectName };
    } catch (error) {
      console.error('Error starting project:', error);
      if (socket) {
        socket.emit('output', `\n\x1b[1;31m✗ Failed to start development server: ${error.message}\x1b[0m\n`);
        // Emit status event for server error
        socket.emit('project:status', {
          projectName,
          stage: 'server_error',
          message: 'Failed to start development server',
          error: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Stop a running project
   * @param {string} projectName - Name of the project to stop
   */
  stopProject(projectName) {
    console.log(`[stopProject] Attempting to stop: ${projectName}`);
    
    // First check in-memory map
    let project = this.runningProjects.get(projectName);
    
    // If not in memory, check tracker (for production restarts)
    if (!project) {
      const trackedProject = projectTracker.getProject(projectName);
      if (trackedProject) {
        console.log(`[stopProject] Found ${projectName} in tracker but not in memory`);
        // For tracked projects without process, we can still clean them up
        projectTracker.removeProject(projectName);
        
        // Try to kill any process on that port (works on Unix-like systems)
        if (process.platform !== 'win32') {
          const { exec } = require('child_process');
          exec(`lsof -ti:${trackedProject.port} | xargs kill -9 2>/dev/null`, (error) => {
            if (!error) {
              console.log(`Killed process on port ${trackedProject.port}`);
            }
          });
        }
        
        return true;
      }
    }
    
    if (project) {
      console.log(`[stopProject] Stopping project with process: ${projectName}`);
      
      // Kill the process if it exists
      if (project.process) {
        project.process.kill('SIGTERM');
        
        // Force kill after timeout if process doesn't exit gracefully
        const forceKillTimeout = setTimeout(() => {
          if (project.process && !project.process.killed) {
            console.log(`Force killing project: ${projectName}`);
            project.process.kill('SIGKILL');
          }
        }, 5000);
        
        // Clean up when process actually exits
        project.process.once('exit', () => {
          clearTimeout(forceKillTimeout);
          console.log(`Project ${projectName} process exited`);
        });
      }
      
      // Remove from map immediately to prevent port conflicts
      this.runningProjects.delete(projectName);
      projectTracker.removeProject(projectName);
      return true;
    }
    
    console.log(`[stopProject] Project ${projectName} not found`);
    return false;
  }

  /**
   * Get information about a running project
   * @param {string} projectName - Name of the project
   */
  getProjectInfo(projectName) {
    // First check in-memory map
    const inMemory = this.runningProjects.get(projectName);
    if (inMemory) return inMemory;
    
    // Fall back to tracker (for production restarts)
    return projectTracker.getProject(projectName);
  }

  /**
   * Get all running projects
   */
  getAllRunningProjects() {
    const projects = [];
    
    // First add projects from in-memory map
    for (const [name, info] of this.runningProjects) {
      projects.push({
        name,
        port: info.port,
        url: info.url,
        projectPath: info.projectPath,
        startTime: info.startTime
      });
    }
    
    // Then add any tracked projects not in memory (production restarts)
    const trackedProjects = projectTracker.getAllProjects();
    for (const tracked of trackedProjects) {
      if (!this.runningProjects.has(tracked.name)) {
        projects.push(tracked);
      }
    }
    
    return projects;
  }

  /**
   * Check if a project is running
   * @param {string} projectName - Name of the project
   */
  isProjectRunning(projectName) {
    return this.runningProjects.has(projectName) || projectTracker.hasProject(projectName);
  }

  /**
   * Stop all running projects (cleanup)
   */
  stopAllProjects() {
    console.log('Stopping all running projects...');
    for (const [name, project] of this.runningProjects) {
      console.log(`Stopping ${name}...`);
      project.process.kill('SIGTERM');
    }
    this.runningProjects.clear();
  }
}

// Create a singleton instance
const projectManager = new ProjectManager();

// Handle process termination
process.on('SIGINT', () => {
  console.log('\nShutting down, stopping all projects...');
  projectManager.stopAllProjects();
  process.exit(0);
});

process.on('SIGTERM', () => {
  projectManager.stopAllProjects();
  process.exit(0);
});

module.exports = projectManager;