import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    // Verify user owns the project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: session.user.id
      }
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found or unauthorized' }, { status: 404 });
    }

    console.log(`Ending session for project ${projectId}...`);

    // 1. Stop dev server if running (only for generated projects, not main app)
    try {
      const devServerResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/workspace/dev-server?projectId=${projectId}`, {
        method: 'DELETE',
        headers: {
          'Cookie': request.headers.get('cookie') || ''
        }
      });
      
      if (devServerResponse.ok) {
        console.log('Generated project dev server stopped successfully');
      }
    } catch (error) {
      console.error('Error stopping dev server:', error);
    }

    // 2. Delete the cloned repository folder to ensure fresh start next time
    const workspacePath = path.join(process.cwd(), 'projects', projectId);
    
    // Also clean up any client-side build artifacts
    const clientProjectPath = path.join(process.cwd(), 'client', 'projects', projectId);
    
    // Clean main workspace
    try {
      await fs.access(workspacePath);
      console.log(`Deleting workspace folder: ${workspacePath}`);
      
      // Remove the entire project folder
      await fs.rm(workspacePath, { 
        recursive: true, 
        force: true,
        maxRetries: 3,
        retryDelay: 100
      });
      
      console.log('Workspace folder deleted successfully');
    } catch (error) {
      console.error('Error deleting workspace folder:', error);
      // Try using system command as fallback
      try {
        if (process.platform === 'win32') {
          await execAsync(`rmdir /s /q "${workspacePath}"`);
        } else {
          await execAsync(`rm -rf "${workspacePath}"`);
        }
        console.log('Workspace folder deleted using system command');
      } catch (cmdError) {
        console.error('Failed to delete workspace folder even with system command:', cmdError);
      }
    }
    
    // Clean client project path (including .next cache)
    try {
      await fs.access(clientProjectPath);
      console.log(`Deleting client project folder: ${clientProjectPath}`);
      
      // Force remove including .next cache
      if (process.platform === 'win32') {
        await execAsync(`rmdir /s /q "${clientProjectPath}"`);
      } else {
        // Use more aggressive removal for .next folders
        await execAsync(`rm -rf "${clientProjectPath}"`);
      }
      
      console.log('Client project folder deleted successfully');
    } catch (error) {
      console.log('No client project folder to clean or already deleted');
    }

    // 3. Delete active SessionState (instead of marking inactive to avoid unique constraint issues)
    const sessionState = await prisma.sessionState.findFirst({
      where: {
        projectId,
        userId: session.user.id,
        isActive: true
      }
    });

    if (sessionState) {
      // Delete the session state entirely to avoid unique constraint violations
      // The session will be recreated fresh when a new session starts
      await prisma.sessionState.delete({
        where: { id: sessionState.id }
      });
      console.log('Session state deleted successfully');
    }

    // 4. Reset any tasks that were in progress back to TODO
    const tasksInProgress = await prisma.task.findMany({
      where: {
        projectId,
        status: 'inProgress'
      }
    });

    if (tasksInProgress.length > 0) {
      // Find the TODO column
      const todoColumn = await prisma.column.findFirst({
        where: {
          projectId,
          OR: [
            { status: 'todo' },
            { name: { contains: 'To Do' } }  // SQLite doesn't support mode: 'insensitive'
          ]
        }
      });

      if (todoColumn) {
        await prisma.task.updateMany({
          where: {
            projectId,
            status: 'inProgress'
          },
          data: {
            status: 'todo',
            columnId: todoColumn.id,
            startedAt: null
          }
        });
        console.log(`Reset ${tasksInProgress.length} tasks from in progress to TODO`);
      }
    }

    // 5. Clear any active agent executions
    await prisma.agentExecution.updateMany({
      where: {
        task: {
          projectId
        },
        status: 'running'
      },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errors: JSON.stringify([{ type: 'session_ended', message: 'Session ended by user' }])
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Session ended successfully',
      workspaceDeleted: true,
      tasksReset: tasksInProgress.length,
      sessionState: sessionState ? 'deleted' : 'no active session'
    });

  } catch (error: any) {
    console.error('End session error:', error);
    return NextResponse.json({
      error: 'Failed to end session',
      details: error.message
    }, { status: 500 });
  }
}