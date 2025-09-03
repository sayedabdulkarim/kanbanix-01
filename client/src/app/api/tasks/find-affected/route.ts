import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { TaskDiff } from '@/types/project';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId, modifiedFiles, excludeTaskId } = await request.json();
    
    if (!projectId || !modifiedFiles || !Array.isArray(modifiedFiles)) {
      return NextResponse.json({ 
        error: 'Project ID and modified files array are required' 
      }, { status: 400 });
    }

    // Get all tasks in the project that are in review or done status
    const tasks = await prisma.task.findMany({
      where: {
        projectId,
        id: { not: excludeTaskId },
        status: { in: ['inReview', 'done'] },
        diffs: { not: null }
      },
      select: {
        id: true,
        title: true,
        diffs: true
      }
    });

    // Find tasks that have diffs for the same files
    const affectedTasks: { id: string; title: string; conflictingFiles: string[] }[] = [];
    
    for (const task of tasks) {
      if (!task.diffs) continue;
      
      try {
        const taskDiffs: TaskDiff[] = JSON.parse(task.diffs);
        const conflictingFiles: string[] = [];
        
        // Check if any of the task's diffs involve the modified files
        for (const diff of taskDiffs) {
          for (const fileDiff of diff.files) {
            if (modifiedFiles.includes(fileDiff.filePath)) {
              conflictingFiles.push(fileDiff.filePath);
            }
          }
        }
        
        if (conflictingFiles.length > 0) {
          affectedTasks.push({
            id: task.id,
            title: task.title || 'Untitled Task',
            conflictingFiles: [...new Set(conflictingFiles)] // Remove duplicates
          });
        }
      } catch (e) {
        console.error(`Error parsing diffs for task ${task.id}:`, e);
      }
    }

    return NextResponse.json({
      success: true,
      affectedTasks,
      affectedTaskIds: affectedTasks.map(t => t.id)
    });

  } catch (error: any) {
    console.error('Error finding affected tasks:', error);
    return NextResponse.json({
      error: 'Failed to find affected tasks',
      details: error.message
    }, { status: 500 });
  }
}