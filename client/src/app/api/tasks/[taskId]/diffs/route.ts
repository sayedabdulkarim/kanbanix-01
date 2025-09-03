import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const taskId = params.taskId;

    // Get task with diffs
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

    return NextResponse.json({
      success: true,
      taskId: task.id,
      diffs: task.diffs || '[]', // Return empty array if no diffs
      commitSha: task.commitSha,
      affectedByTasks: task.affectedByTasks
    });

  } catch (error: any) {
    console.error('Error retrieving task diffs:', error);
    return NextResponse.json({
      error: 'Failed to retrieve task diffs',
      details: error.message
    }, { status: 500 });
  }
}