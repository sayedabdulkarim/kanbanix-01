import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { authOptions } from '../auth/[...nextauth]/route';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// POST /api/tasks - Create new task
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      title, 
      description, 
      projectId, 
      columnId, 
      priority = 'medium',
      dueDate,
      assigneeId 
    } = await request.json();

    // Validate required fields
    if (!title || !projectId || !columnId) {
      return NextResponse.json(
        { error: 'Title, projectId, and columnId are required' }, 
        { status: 400 }
      );
    }

    // Verify user owns the project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: session.user.id,
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get the next order number for this column
    const lastTask = await prisma.task.findFirst({
      where: {
        projectId,
        columnId,
      },
      orderBy: {
        order: 'desc',
      },
    });

    const nextOrder = lastTask ? lastTask.order + 1 : 0;

    // Create the task
    const task = await prisma.task.create({
      data: {
        title,
        description: description || '',
        status: 'todo',
        priority,
        order: nextOrder,
        projectId,
        columnId,
        assigneeId,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
      include: {
        assignee: true,
        labels: true,
      },
    });

    // Create activity log
    await prisma.activity.create({
      data: {
        type: 'created',
        description: `Task "${title}" was created`,
        taskId: task.id,
        userId: session.user.id,
      },
    });

    return NextResponse.json({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      order: task.order,
      columnId: task.columnId,
      projectId: task.projectId,
      dueDate: task.dueDate,
      assignee: task.assignee,
      labels: task.labels,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  } catch (error: any) {
    console.error('Error creating task:', error);
    return NextResponse.json(
      { error: 'Failed to create task', details: error.message },
      { status: 500 }
    );
  }
}