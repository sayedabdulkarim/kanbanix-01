import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId, diffs } = await request.json();
    
    if (!taskId || !diffs) {
      return NextResponse.json({ 
        error: 'Task ID and diffs are required' 
      }, { status: 400 });
    }

    // Verify task exists and user has access
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: {
          select: { userId: true }
        }
      }
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Update task with diffs
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        diffs: diffs // Store as JSON string
      }
    });

    return NextResponse.json({
      success: true,
      taskId: updatedTask.id
    });

  } catch (error: any) {
    console.error('Error updating task diffs:', error);
    return NextResponse.json({
      error: 'Failed to update task diffs',
      details: error.message
    }, { status: 500 });
  }
}