import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), 'projects'),
};

export async function GET(request: NextRequest) {
  try {
    // Get session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get project ID from query params
    const searchParams = request.nextUrl.searchParams;
    const projectId = searchParams.get('projectId');
    
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    // Verify project ownership
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);
    
    // Check if workspace exists
    let workspaceExists = false;
    let workspaceInfo = null;
    
    try {
      await fs.access(workspacePath);
      workspaceExists = true;
      
      // Get workspace stats
      const stats = await fs.stat(workspacePath);
      
      // Get current git branch
      let currentBranch = 'main';
      let gitStatus = null;
      let hasUncommittedChanges = false;
      
      try {
        const { stdout: branchOutput } = await execAsync('git branch --show-current', {
          cwd: workspacePath
        });
        currentBranch = branchOutput.trim() || 'main';
        
        // Get git status
        const { stdout: statusOutput } = await execAsync('git status --porcelain', {
          cwd: workspacePath
        });
        hasUncommittedChanges = statusOutput.trim().length > 0;
        
        // Get last commit
        const { stdout: logOutput } = await execAsync('git log -1 --oneline', {
          cwd: workspacePath
        });
        
        gitStatus = {
          branch: currentBranch,
          hasUncommittedChanges,
          lastCommit: logOutput.trim()
        };
      } catch (gitError) {
        console.warn('Git status error:', gitError);
      }
      
      // Calculate workspace size (simplified)
      const { stdout: sizeOutput } = await execAsync(`du -sh ${workspacePath} | cut -f1`, {
        cwd: workspacePath
      });
      
      workspaceInfo = {
        path: workspacePath,
        exists: true,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        size: sizeOutput.trim(),
        git: gitStatus
      };
      
    } catch (error) {
      // Workspace doesn't exist
      workspaceExists = false;
    }

    // Get tasks in progress
    const tasksInProgress = await prisma.task.count({
      where: {
        projectId: projectId,
        status: 'inProgress'
      }
    });

    // Get running agent executions
    const runningExecutions = await prisma.agentExecution.count({
      where: {
        task: {
          projectId: projectId
        },
        status: 'running'
      }
    });

    return NextResponse.json({
      projectId,
      projectName: project.name,
      workspace: workspaceInfo || {
        path: workspacePath,
        exists: false
      },
      tasksInProgress,
      runningExecutions,
      githubRepo: {
        owner: project.githubOwner,
        repo: project.githubRepo,
        url: project.githubRepoUrl
      }
    });

  } catch (error: any) {
    console.error('Workspace status error:', error);
    return NextResponse.json({
      error: 'Failed to get workspace status',
      details: error.message
    }, { status: 500 });
  }
}