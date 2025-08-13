import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || '/tmp/workspace',
};

export async function POST(request: NextRequest) {
  try {
    // Get session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get project ID from request
    const { projectId, discardChanges = false } = await request.json();
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
    try {
      await fs.access(workspacePath);
    } catch (error) {
      return NextResponse.json({
        error: 'Workspace not found',
        message: 'Please enter the project first to create a workspace'
      }, { status: 404 });
    }

    // Check for uncommitted changes
    const { stdout: statusOutput } = await execAsync('git status --porcelain', {
      cwd: workspacePath
    });
    
    const hasUncommittedChanges = statusOutput.trim().length > 0;
    
    if (hasUncommittedChanges && !discardChanges) {
      return NextResponse.json({
        error: 'Uncommitted changes detected',
        message: 'You have uncommitted changes. Set discardChanges to true to discard them.',
        hasUncommittedChanges: true,
        changes: statusOutput.trim().split('\n')
      }, { status: 409 });
    }

    // Refresh workspace
    let commands = [];
    
    if (discardChanges) {
      // Reset any local changes
      commands.push('git reset --hard HEAD');
      commands.push('git clean -fd');
    }
    
    // Fetch latest changes
    commands.push('git fetch origin');
    
    // Get current branch
    const { stdout: currentBranch } = await execAsync('git branch --show-current', {
      cwd: workspacePath
    });
    
    const branch = currentBranch.trim() || 'main';
    
    // Pull latest changes for current branch
    commands.push(`git pull origin ${branch}`);
    
    // Execute all commands
    const results = [];
    for (const command of commands) {
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: workspacePath,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
          }
        });
        results.push({
          command,
          success: true,
          output: stdout || stderr
        });
      } catch (cmdError: any) {
        results.push({
          command,
          success: false,
          error: cmdError.message
        });
      }
    }

    // Get updated status
    const { stdout: newStatus } = await execAsync('git status -sb', {
      cwd: workspacePath
    });
    
    const { stdout: lastCommit } = await execAsync('git log -1 --oneline', {
      cwd: workspacePath
    });

    return NextResponse.json({
      success: true,
      message: 'Workspace refreshed successfully',
      currentBranch: branch,
      lastCommit: lastCommit.trim(),
      status: newStatus.trim(),
      operations: results
    });

  } catch (error: any) {
    console.error('Workspace refresh error:', error);
    return NextResponse.json({
      error: 'Failed to refresh workspace',
      details: error.message
    }, { status: 500 });
  }
}