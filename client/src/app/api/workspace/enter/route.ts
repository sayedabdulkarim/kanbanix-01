import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import gitService from '@/lib/services/gitService';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

// Workspace configuration
const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), 'projects'),
  maxSize: 500 * 1024 * 1024, // 500MB max
  timeout: 30 * 60 * 1000,    // 30 min max session
};

// Simple in-memory lock to prevent concurrent operations on same project
const workspaceLocks = new Map<string, boolean>();

export async function POST(request: NextRequest) {
  let projectId: string | undefined;
  
  try {
    // Get session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get project ID and optional task info from request
    const body = await request.json();
    projectId = body.projectId;
    const { taskId, taskTitle } = body;
    
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    // Check if there's already an operation in progress for this project
    if (workspaceLocks.get(projectId)) {
      console.log(`Workspace operation already in progress for project ${projectId}, waiting...`);
      // Wait a bit and check if it's still locked
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (workspaceLocks.get(projectId)) {
        return NextResponse.json({ 
          error: 'Another workspace operation is in progress for this project',
          retry: true 
        }, { status: 429 });
      }
    }

    // Set lock
    workspaceLocks.set(projectId, true);

    // Get project details
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { user: true }
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Verify user owns the project
    if (project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Ensure GitHub repo details exist
    if (!project.githubOwner || !project.githubRepo) {
      return NextResponse.json({ 
        error: 'Project not connected to GitHub repository' 
      }, { status: 400 });
    }

    // Create workspace path
    const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);

    // Check if workspace already exists
    let workspaceExists = false;
    try {
      await fs.access(workspacePath);
      workspaceExists = true;
    } catch {
      workspaceExists = false;
    }

    if (workspaceExists) {
      console.log(`Workspace already exists at ${workspacePath}, checking if it's a valid git repo`);
      
      // Check if it's a valid git repository
      let isValidRepo = false;
      try {
        await execAsync('git status', { cwd: workspacePath });
        isValidRepo = true;
      } catch (gitError: any) {
        console.log('Git status check failed:', gitError.message);
        isValidRepo = false;
      }

      if (isValidRepo) {
        // If it's a valid repo, pull latest changes
        console.log('Valid git repo found, pulling latest changes');
        try {
          await execAsync('git fetch origin', { cwd: workspacePath });
          await execAsync('git reset --hard origin/main', { cwd: workspacePath });
          await execAsync('git clean -fd', { cwd: workspacePath });

          // Release lock before returning
          workspaceLocks.delete(projectId);

          return NextResponse.json({
            success: true,
            workspacePath,
            message: 'Workspace refreshed with latest changes',
            project: {
              id: project.id,
              name: project.name,
              githubOwner: project.githubOwner,
              githubRepo: project.githubRepo
            }
          });
        } catch (pullError: any) {
          console.log('Failed to pull latest changes, will re-clone:', pullError.message);
          isValidRepo = false;
        }
      }

      if (!isValidRepo) {
        // Not a valid git repo or corrupted, remove and re-clone
        console.log('Invalid or corrupted git repo, removing and re-cloning');
        
        // Force removal of the entire directory
        try {
          // First, try to forcefully remove using system commands
          if (process.platform === 'win32') {
            // Windows
            try {
              await execAsync(`rmdir /s /q "${workspacePath}"`);
            } catch {
              await execAsync(`rd /s /q "${workspacePath}"`);
            }
          } else {
            // Unix/Linux/Mac
            try {
              // Most aggressive removal - ignore errors
              await execAsync(`rm -rf "${workspacePath}" 2>/dev/null || true`);
            } catch (e) {
              console.log('First rm attempt failed, trying alternatives');
            }
            
            // Check if it still exists
            try {
              await fs.access(workspacePath);
              // If we're here, it still exists, try more methods
              
              // Try to remove .git first to unlock files
              try {
                await execAsync(`find "${workspacePath}" -name ".git" -type d -exec rm -rf {} + 2>/dev/null || true`);
              } catch {}
              
              // Try again with the directory
              try {
                await execAsync(`rm -rf "${workspacePath}"`);
              } catch {}
            } catch {
              // Directory doesn't exist anymore, good!
            }
          }
        } catch (rmError) {
          console.error('System command removal failed:', rmError);
        }

        // Double-check with Node.js fs if directory still exists
        try {
          await fs.access(workspacePath);
          // Still exists, try Node.js removal
          console.log('Directory still exists, trying Node.js fs.rm');
          await fs.rm(workspacePath, { 
            recursive: true, 
            force: true, 
            maxRetries: 10,
            retryDelay: 200
          });
        } catch (accessError) {
          // Good, directory doesn't exist or was removed
          console.log('Directory successfully removed or doesn\'t exist');
        }

        // Final check - if it STILL exists, rename it
        try {
          await fs.access(workspacePath);
          // Still there! Rename it as last resort
          const backupPath = `${workspacePath}_corrupted_${Date.now()}`;
          await fs.rename(workspacePath, backupPath);
          console.log(`Renamed stubborn directory to ${backupPath}`);
        } catch {
          // Good, it's finally gone or renamed
        }
      }
    } else {
      console.log(`Creating new workspace at ${workspacePath}`);
    }

    // Ensure base workspace directory exists
    await fs.mkdir(WORKSPACE_CONFIG.basePath, { recursive: true });

    // Make absolutely sure the directory doesn't exist before cloning
    try {
      await fs.access(workspacePath);
      // If we reach here, directory exists - remove it
      console.log('Directory exists before clone, removing it completely...');
      try {
        if (process.platform === 'win32') {
          await execAsync(`rmdir /s /q "${workspacePath}"`);
        } else {
          await execAsync(`rm -rf "${workspacePath}"`);
        }
      } catch {
        await fs.rm(workspacePath, { recursive: true, force: true, maxRetries: 3 });
      }
      // Wait for filesystem
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch {
      // Directory doesn't exist, good to proceed
    }

    // Clone repository
    const repoUrl = `https://github.com/${project.githubOwner}/${project.githubRepo}.git`;
    
    console.log(`Cloning repository: ${repoUrl}`);
    
    // Clone with authentication token
    const cloneCommand = `git clone https://${session.accessToken}@github.com/${project.githubOwner}/${project.githubRepo}.git "${workspacePath}"`;
    
    try {
      const { stdout, stderr } = await execAsync(cloneCommand, {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0', // Disable git prompts
        }
      });
      
      console.log('Clone output:', stdout);
      if (stderr && !stderr.includes('Cloning into')) {
        console.warn('Clone warnings:', stderr);
      }
    } catch (cloneError: any) {
      console.error('Clone error:', cloneError);
      
      // Check if it's a directory exists error or invalid config error
      if (cloneError.message.includes('already exists') || 
          cloneError.message.includes('invalid config file') ||
          cloneError.message.includes('File exists')) {
        
        console.log('Clone failed due to existing/corrupted directory, force removing and retrying...');
        
        // Force remove the directory
        try {
          // Try system command first
          if (process.platform === 'win32') {
            await execAsync(`rmdir /s /q "${workspacePath}"`);
          } else {
            await execAsync(`rm -rf "${workspacePath}"`);
          }
        } catch {
          // Fallback to Node.js fs.rm
          try {
            await fs.rm(workspacePath, { 
              recursive: true, 
              force: true,
              maxRetries: 5,
              retryDelay: 100
            });
          } catch (rmError) {
            console.error('Could not remove workspace directory:', rmError);
          }
        }
        
        // Wait a bit for filesystem to settle
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Try cloning one more time
        try {
          const { stdout: retryStdout, stderr: retryStderr } = await execAsync(cloneCommand, {
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
            }
          });
          
          console.log('Retry clone successful');
          if (retryStderr && !retryStderr.includes('Cloning into')) {
            console.warn('Retry clone warnings:', retryStderr);
          }
        } catch (retryError: any) {
          console.error('Retry clone also failed:', retryError);
          
          // Last attempt: clean and return error
          try {
            await fs.rm(workspacePath, { recursive: true, force: true });
          } catch {}
          
          // Release lock before returning error
          workspaceLocks.delete(projectId);
          
          return NextResponse.json({
            error: 'Failed to clone repository. The workspace may be corrupted.',
            details: 'Please try again or manually delete: ' + workspacePath
          }, { status: 500 });
        }
      } else {
        // Some other clone error (e.g., auth, network, etc.)
        // Release lock before returning error
        workspaceLocks.delete(projectId);
        
        return NextResponse.json({
          error: 'Failed to clone repository',
          details: cloneError.message
        }, { status: 500 });
      }
    }

    // Configure git user for the workspace
    try {
      await execAsync(`git config user.name "Kanbanix AI"`, { cwd: workspacePath });
      await execAsync(`git config user.email "ai@kanbanix.app"`, { cwd: workspacePath });
    } catch (configError) {
      console.warn('Git config warning:', configError);
    }

    // Create task branch if task info provided
    let branchName = 'main';
    if (taskId && taskTitle) {
      try {
        branchName = await gitService.createTaskBranch(workspacePath, taskId, taskTitle);
        console.log(`Created/checked out task branch: ${branchName}`);
      } catch (branchError) {
        console.error('Error creating task branch:', branchError);
        // Continue on main branch if branch creation fails
      }
    }

    // Get current branch info
    const branchInfo = await gitService.getBranchInfo(workspacePath);

    // Store workspace info in session/cache (you might want to use Redis or similar)
    // For now, we'll return the path and let the client manage it

    // Release lock on success
    workspaceLocks.delete(projectId);

    return NextResponse.json({
      success: true,
      workspacePath,
      message: 'Workspace created successfully',
      project: {
        id: project.id,
        name: project.name,
        githubOwner: project.githubOwner,
        githubRepo: project.githubRepo,
        defaultBranch: 'main'
      },
      git: {
        branch: branchInfo.current,
        branches: branchInfo.all,
        hasUncommittedChanges: branchInfo.hasUncommittedChanges
      }
    });

  } catch (error: any) {
    console.error('Workspace enter error:', error);
    
    // Release lock on error
    if (projectId) {
      workspaceLocks.delete(projectId);
    }
    
    return NextResponse.json({
      error: 'Failed to create workspace',
      details: error.message
    }, { status: 500 });
  }
}