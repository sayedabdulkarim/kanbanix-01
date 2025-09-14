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
        // Wait for the dev server process to fully terminate
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error('Error stopping dev server:', error);
    }

    // 2. Capture diffs for InReview tasks that don't have them yet
    // This is critical to preserve work before any workspace operations
    console.log('Checking for InReview tasks without saved diffs...');
    const inReviewTasksWithoutDiffs = await prisma.task.findMany({
      where: {
        projectId,
        status: 'inReview',
        diffs: null
      }
    });

    if (inReviewTasksWithoutDiffs.length > 0) {
      console.log(`Found ${inReviewTasksWithoutDiffs.length} InReview tasks without diffs - capturing now...`);
      const workspacePath = path.join(process.cwd(), '..', 'workspace-projects', projectId);
      
      try {
        // Import services needed for diff capture
        const { default: diffTrackingService } = await import('@/lib/services/diffTrackingService.server');
        const { default: gitService } = await import('@/lib/services/gitService');
        
        // Check if there are uncommitted changes to capture
        const uncommittedChanges = await gitService.getUncommittedChanges(workspacePath);
        
        if (uncommittedChanges.length > 0) {
          for (const task of inReviewTasksWithoutDiffs) {
            try {
              console.log(`Capturing diffs for InReview task: ${task.title}`);
              const taskDiff = await diffTrackingService.captureTaskDiffs(
                workspacePath,
                task.id,
                task.title || 'Untitled Task',
                'initial'
              );
              
              if (taskDiff && taskDiff.files.length > 0) {
                // Store the captured diffs
                await prisma.task.update({
                  where: { id: task.id },
                  data: {
                    diffs: JSON.stringify([taskDiff])
                  }
                });
                console.log(`✅ Captured and stored ${taskDiff.files.length} files for task ${task.id}`);
              }
            } catch (error) {
              console.error(`Failed to capture diffs for task ${task.id}:`, error);
              // Continue with other tasks even if one fails
            }
          }
        }
      } catch (error) {
        console.error('Error capturing diffs for InReview tasks:', error);
        // Continue with session end even if diff capture fails
      }
    }

    // 3. Check if we should preserve the workspace (for tasks with saved diffs)
    const tasksWithDiffs = await prisma.task.findMany({
      where: {
        projectId,
        OR: [
          {
            status: 'inReview',
            diffs: { not: null }
          },
          {
            status: 'done',
            diffs: { not: null }
          }
        ]
      }
    });

    const shouldPreserveWorkspace = tasksWithDiffs.length > 0;
    let workspaceDeleted = false;

    if (shouldPreserveWorkspace) {
      console.log(`Preserving workspace - found ${tasksWithDiffs.length} tasks with saved diffs`);
      
      // Only clean build artifacts and node_modules, not the entire workspace
      const workspacePath = path.join(process.cwd(), '..', 'workspace-projects', projectId);
      
      // Delete node_modules to save significant space
      const nodeModulesPath = path.join(workspacePath, 'node_modules');
      try {
        await fs.access(nodeModulesPath);
        console.log('Deleting node_modules to save storage space...');
        if (process.platform === 'win32') {
          await execAsync(`rmdir /s /q "${nodeModulesPath}"`);
        } else {
          await execAsync(`rm -rf "${nodeModulesPath}"`);
        }
        console.log('node_modules deleted successfully (will auto-reinstall when needed)');
      } catch (e) {
        console.log('No node_modules to delete or already removed');
      }
      
      // Clean other build artifacts
      const buildFolders = ['.next', 'dist', 'build', '.angular', '.nuxt', '.svelte-kit'];
      
      for (const folder of buildFolders) {
        const buildPath = path.join(workspacePath, folder);
        try {
          await fs.access(buildPath);
          console.log(`Cleaning ${folder} folder...`);
          if (process.platform === 'win32') {
            await execAsync(`rmdir /s /q "${buildPath}"`);
          } else {
            await execAsync(`rm -rf "${buildPath}"`);
          }
          console.log(`${folder} folder cleaned`);
        } catch (e) {
          // Build folder doesn't exist or already deleted
        }
      }
    } else {
      // No tasks with saved diffs - safe to delete the entire workspace
      const workspacePath = path.join(process.cwd(), '..', 'workspace-projects', projectId);
      
      // Clean main workspace
      try {
        await fs.access(workspacePath);
        console.log(`Deleting workspace folder: ${workspacePath}`);
        
        // First try to delete common build/cache folders that might have locked files
        const buildFolders = ['.next', 'dist', 'build', '.angular', '.nuxt', '.svelte-kit', 'node_modules/.cache'];
        for (const folder of buildFolders) {
          const buildPath = path.join(workspacePath, folder);
          try {
            await fs.access(buildPath);
            console.log(`Deleting ${folder} folder...`);
            // Use system command for build folders as they can have locked files
            if (process.platform === 'win32') {
              await execAsync(`rmdir /s /q "${buildPath}"`);
            } else {
              await execAsync(`rm -rf "${buildPath}"`);
            }
            console.log(`${folder} folder deleted`);
          } catch (e) {
            // Build folder doesn't exist or already deleted
          }
        }
        
        // Now remove the entire project folder
        await fs.rm(workspacePath, { 
          recursive: true, 
          force: true,
          maxRetries: 5,
          retryDelay: 500
        });
        
        console.log('Workspace folder deleted successfully');
        workspaceDeleted = true;
      } catch (error) {
        console.error('Error deleting workspace folder:', error);
        // Try using system command as fallback
        try {
          if (process.platform === 'win32') {
            await execAsync(`rmdir /s /q "${workspacePath}"`);
          } else {
            // Use more aggressive removal for Unix systems
            await execAsync(`rm -rf "${workspacePath}" 2>/dev/null || true`);
          }
          console.log('Workspace folder deleted using system command');
          workspaceDeleted = true;
        } catch (cmdError) {
          console.error('Failed to delete workspace folder even with system command:', cmdError);
        }
      }
      
      // Clean client project path (including .next cache)
      const clientProjectPath = path.join(process.cwd(), 'client', 'projects', projectId);
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

    // 5. Clear GitHub PR information from tasks in Done status
    // This prevents the "Updating Board" modal from appearing when re-entering the project
    const clearedPRInfo = await prisma.task.updateMany({
      where: {
        projectId,
        status: 'done',
        OR: [
          { githubPrNumber: { not: null } },
          { githubState: { not: null } },
          { githubPrId: { not: null } }
        ]
      },
      data: {
        githubPrNumber: null,
        githubPrId: null,
        githubState: null
      }
    });
    
    if (clearedPRInfo.count > 0) {
      console.log(`Cleared GitHub PR information from ${clearedPRInfo.count} done tasks`);
    }

    // 6. Clear any active agent executions
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
      workspaceDeleted: workspaceDeleted,
      workspacePreserved: shouldPreserveWorkspace,
      tasksWithSavedDiffs: tasksWithDiffs.length,
      tasksReset: tasksInProgress.length,
      prInfoCleared: clearedPRInfo.count,
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