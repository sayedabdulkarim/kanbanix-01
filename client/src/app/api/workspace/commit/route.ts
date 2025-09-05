import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import gitService from '@/lib/services/gitService';
import diffTrackingService from '@/lib/services/diffTrackingService.server';
import { TaskDiff } from '@/types/project';

const prisma = new PrismaClient();

const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), 'projects'),
};

export async function POST(request: NextRequest) {
  try {
    // Get session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get request data
    const { projectId, taskId, message, files } = await request.json();
    if (!projectId || !message) {
      return NextResponse.json({ 
        error: 'Project ID and commit message required' 
      }, { status: 400 });
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

    // Get workspace path
    const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);
    
    // Get uncommitted changes
    const uncommittedChanges = await gitService.getUncommittedChanges(workspacePath);
    
    if (uncommittedChanges.length === 0) {
      return NextResponse.json({ 
        error: 'No changes to commit' 
      }, { status: 400 });
    }
    
    // Capture diffs before committing (if taskId provided)
    let taskDiffs: TaskDiff[] = [];
    if (taskId) {
      // Get the task to fetch title
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { title: true, diffs: true }
      });
      
      if (task) {
        // Capture current diffs
        const newDiff = await diffTrackingService.captureTaskDiffs(
          workspacePath,
          taskId,
          task.title || 'Untitled Task',
          'initial'
        );
        
        if (newDiff) {
          // Get existing diffs if any
          const existingDiffs = task.diffs ? JSON.parse(task.diffs) : [];
          taskDiffs = [...existingDiffs, newDiff];
        }
      }
    }
    
    // Commit changes
    const commitInfo = await gitService.commitChanges(
      workspacePath,
      message,
      files
    );
    
    // Log commit in task activity if taskId provided
    if (taskId) {
      await prisma.activity.create({
        data: {
          taskId,
          userId: session.user.id,
          type: 'commit',
          description: `Committed ${uncommittedChanges.length} file(s) with message: "${message}"`,
          metadata: JSON.stringify({
            projectId,
            action: 'commit',
            commitHash: commitInfo.hash,
            message: commitInfo.message,
            filesChanged: uncommittedChanges.length
          })
        }
      });
      
      // Update task with branch info, commit SHA, and diffs
      const branchInfo = await gitService.getBranchInfo(workspacePath);
      const updateData: any = {
        commitSha: commitInfo.hash,
      };
      
      if (branchInfo.current && branchInfo.current !== 'main' && branchInfo.current !== 'master') {
        updateData.githubBranch = branchInfo.current;
      }
      
      // Store the captured diffs
      if (taskDiffs.length > 0) {
        updateData.diffs = JSON.stringify(taskDiffs);
      }
      
      await prisma.task.update({
        where: { id: taskId },
        data: updateData
      });
    }
    
    return NextResponse.json({
      success: true,
      commit: commitInfo,
      filesCommitted: uncommittedChanges.length
    });

  } catch (error: any) {
    console.error('Commit error:', error);
    return NextResponse.json({
      error: 'Failed to commit changes',
      details: error.message
    }, { status: 500 });
  }
}

// GET endpoint to retrieve uncommitted changes
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
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
    
    // Get uncommitted changes and diff
    const changes = await gitService.getUncommittedChanges(workspacePath);
    const diff = await gitService.getDiff(workspacePath);
    const branchInfo = await gitService.getBranchInfo(workspacePath);
    
    return NextResponse.json({
      success: true,
      changes,
      diff,
      branch: branchInfo.current,
      hasChanges: changes.length > 0
    });

  } catch (error: any) {
    console.error('Error getting changes:', error);
    return NextResponse.json({
      error: 'Failed to get changes',
      details: error.message
    }, { status: 500 });
  }
}