import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';

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

    // Get project ID from request
    const { projectId } = await request.json();
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

    // Reset any in-progress tasks back to TODO
    const inProgressTasks = await prisma.task.findMany({
      where: {
        projectId: projectId,
        status: 'inProgress'
      }
    });

    if (inProgressTasks.length > 0) {
      console.log(`Resetting ${inProgressTasks.length} tasks to TODO status`);
      
      await prisma.task.updateMany({
        where: {
          projectId: projectId,
          status: 'inProgress'
        },
        data: {
          status: 'todo',
          startedAt: null
        }
      });

      // Cancel any running agent executions
      const runningExecutions = await prisma.agentExecution.findMany({
        where: {
          taskId: {
            in: inProgressTasks.map(t => t.id)
          },
          status: 'running'
        }
      });

      if (runningExecutions.length > 0) {
        await prisma.agentExecution.updateMany({
          where: {
            id: {
              in: runningExecutions.map(e => e.id)
            }
          },
          data: {
            status: 'cancelled',
            completedAt: new Date(),
            currentStep: 'Cancelled due to workspace cleanup'
          }
        });
      }
    }

    // Clean up workspace directory
    const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);
    
    try {
      await fs.access(workspacePath);
      console.log(`Cleaning up workspace at ${workspacePath}`);
      
      // Remove the workspace directory
      await fs.rm(workspacePath, { recursive: true, force: true });
      
      console.log(`Workspace cleaned up successfully`);
    } catch (error) {
      // Workspace doesn't exist, that's fine
      console.log(`Workspace at ${workspacePath} doesn't exist or already cleaned`);
    }

    return NextResponse.json({
      success: true,
      message: 'Workspace cleaned up successfully',
      tasksReset: inProgressTasks.length,
      executionsCancelled: inProgressTasks.length > 0 ? 
        `${inProgressTasks.length} task(s) reset to TODO` : undefined
    });

  } catch (error: any) {
    console.error('Workspace leave error:', error);
    return NextResponse.json({
      error: 'Failed to clean up workspace',
      details: error.message
    }, { status: 500 });
  }
}

// Also handle cleanup on DELETE request
export async function DELETE(request: NextRequest) {
  return POST(request);
}