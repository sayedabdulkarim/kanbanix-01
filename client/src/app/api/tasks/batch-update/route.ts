import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { authOptions } from '../../auth/[...nextauth]/route';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

interface TaskUpdate {
  id: string;
  columnId?: string;
  order?: number;
}

// POST /api/tasks/batch-update - Update multiple tasks (for drag & drop)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { updates }: { updates: TaskUpdate[] } = await request.json();

    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { error: 'Updates array is required' }, 
        { status: 400 }
      );
    }

    // Verify all tasks belong to user's projects
    const taskIds = updates.map(u => u.id);
    const tasks = await prisma.task.findMany({
      where: {
        id: { in: taskIds },
        project: {
          userId: session.user.id,
        },
      },
    });

    if (tasks.length !== taskIds.length) {
      return NextResponse.json({ error: 'Some tasks not found' }, { status: 404 });
    }

    // Perform batch update in transaction
    const result = await prisma.$transaction(async (tx) => {
      const updatedTasks = [];
      
      for (const update of updates) {
        const updateData: any = {};
        
        if (update.columnId !== undefined) {
          updateData.columnId = update.columnId;
        }
        if (update.order !== undefined) {
          updateData.order = update.order;
        }

        const updatedTask = await tx.task.update({
          where: { id: update.id },
          data: updateData,
          include: {
            assignee: true,
            labels: true,
          },
        });

        updatedTasks.push({
          id: updatedTask.id,
          title: updatedTask.title,
          description: updatedTask.description,
          status: updatedTask.status,
          priority: updatedTask.priority,
          order: updatedTask.order,
          columnId: updatedTask.columnId,
          projectId: updatedTask.projectId,
          dueDate: updatedTask.dueDate,
          assignee: updatedTask.assignee,
          labels: updatedTask.labels,
          createdAt: updatedTask.createdAt,
          updatedAt: updatedTask.updatedAt,
        });
      }

      return updatedTasks;
    });

    // Create activity logs for column moves
    for (const update of updates) {
      if (update.columnId !== undefined) {
        const originalTask = tasks.find(t => t.id === update.id);
        if (originalTask && originalTask.columnId !== update.columnId) {
          await prisma.activity.create({
            data: {
              type: 'moved',
              description: `Task moved to different column`,
              taskId: update.id,
              userId: session.user.id,
            },
          });
        }
      }
    }

    return NextResponse.json({ 
      message: 'Tasks updated successfully', 
      tasks: result 
    });
  } catch (error: any) {
    console.error('Error batch updating tasks:', error);
    return NextResponse.json(
      { error: 'Failed to update tasks', details: error.message },
      { status: 500 }
    );
  }
}