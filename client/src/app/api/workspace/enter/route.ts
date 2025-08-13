import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

// Workspace configuration
const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || '/tmp/workspace',
  maxSize: 500 * 1024 * 1024, // 500MB max
  timeout: 30 * 60 * 1000,    // 30 min max session
};

export async function POST(request: NextRequest) {
  try {
    // Get session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get project ID from request
    const { projectId } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

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
    try {
      await fs.access(workspacePath);
      console.log(`Workspace already exists at ${workspacePath}, checking if it's a valid git repo`);
      
      // Check if it's a valid git repository
      try {
        await execAsync('git status', { cwd: workspacePath });
        
        // If it's a valid repo, pull latest changes
        console.log('Valid git repo found, pulling latest changes');
        await execAsync('git fetch origin', { cwd: workspacePath });
        await execAsync('git reset --hard origin/main', { cwd: workspacePath });
        await execAsync('git clean -fd', { cwd: workspacePath });

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
      } catch (gitError) {
        // Not a valid git repo or corrupted, remove and re-clone
        console.log('Invalid or corrupted git repo, removing and re-cloning');
        await fs.rm(workspacePath, { recursive: true, force: true });
      }
    } catch (error) {
      // Workspace doesn't exist, proceed to clone
      console.log(`Creating new workspace at ${workspacePath}`);
    }

    // Ensure base workspace directory exists
    await fs.mkdir(WORKSPACE_CONFIG.basePath, { recursive: true });

    // Clone repository
    const repoUrl = `https://github.com/${project.githubOwner}/${project.githubRepo}.git`;
    
    console.log(`Cloning repository: ${repoUrl}`);
    
    // Clone with authentication token
    const cloneCommand = `git clone https://${session.accessToken}@github.com/${project.githubOwner}/${project.githubRepo}.git ${workspacePath}`;
    
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
      
      // If clone failed because directory exists, try to remove it and retry once
      if (cloneError.message.includes('File exists') || cloneError.message.includes('already exists')) {
        console.log('Directory exists, cleaning up and retrying...');
        try {
          await fs.rm(workspacePath, { recursive: true, force: true });
          
          // Retry clone
          const { stdout: retryStdout, stderr: retryStderr } = await execAsync(cloneCommand, {
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
            }
          });
          
          console.log('Retry clone successful:', retryStdout);
          if (retryStderr && !retryStderr.includes('Cloning into')) {
            console.warn('Retry clone warnings:', retryStderr);
          }
        } catch (retryError: any) {
          console.error('Retry clone failed:', retryError);
          
          // Final cleanup attempt
          try {
            await fs.rm(workspacePath, { recursive: true, force: true });
          } catch (finalCleanupError) {
            console.error('Final cleanup error:', finalCleanupError);
          }
          
          return NextResponse.json({
            error: 'Failed to clone repository after retry',
            details: retryError.message
          }, { status: 500 });
        }
      } else {
        // Clean up failed workspace
        try {
          await fs.rm(workspacePath, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error('Cleanup error:', cleanupError);
        }
        
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

    // Store workspace info in session/cache (you might want to use Redis or similar)
    // For now, we'll return the path and let the client manage it

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
      }
    });

  } catch (error: any) {
    console.error('Workspace enter error:', error);
    return NextResponse.json({
      error: 'Failed to create workspace',
      details: error.message
    }, { status: 500 });
  }
}