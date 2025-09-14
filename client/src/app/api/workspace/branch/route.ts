import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import gitService from '@/lib/services/gitService';

const prisma = new PrismaClient();

const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), '..', 'workspace-projects'),
};

export async function POST(request: NextRequest) {
  try {
    // Get session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get request data
    const { projectId, taskId, taskTitle } = await request.json();
    if (!projectId || !taskId || !taskTitle) {
      return NextResponse.json({ 
        error: 'Project ID, Task ID, and Task Title required' 
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
    
    // Create task branch
    const branchName = await gitService.createTaskBranch(
      workspacePath,
      taskId,
      taskTitle
    );
    
    // Get updated branch info
    const branchInfo = await gitService.getBranchInfo(workspacePath);
    
    // Update task with branch name
    await prisma.task.update({
      where: { id: taskId },
      data: {
        metadata: {
          ...(await prisma.task.findUnique({ where: { id: taskId } }))?.metadata as any,
          gitBranch: branchName
        }
      }
    });
    
    return NextResponse.json({
      success: true,
      branch: branchName,
      branchInfo: {
        current: branchInfo.current,
        all: branchInfo.all,
        hasUncommittedChanges: branchInfo.hasUncommittedChanges
      }
    });

  } catch (error: any) {
    console.error('Branch creation error:', error);
    return NextResponse.json({
      error: 'Failed to create branch',
      details: error.message
    }, { status: 500 });
  }
}