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

    const { affectedTaskIds, sourceTaskId } = await request.json();
    
    if (!affectedTaskIds || !Array.isArray(affectedTaskIds) || !sourceTaskId) {
      return NextResponse.json({ 
        error: 'Affected task IDs array and source task ID are required' 
      }, { status: 400 });
    }

    // Update all affected tasks
    const updatePromises = affectedTaskIds.map(async (taskId) => {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { affectedByTasks: true }
      });

      if (!task) return null;

      // Parse existing affected tasks
      const existingAffected = task.affectedByTasks 
        ? task.affectedByTasks.split(',').filter(Boolean)
        : [];
      
      // Add source task if not already present
      if (!existingAffected.includes(sourceTaskId)) {
        existingAffected.push(sourceTaskId);
      }

      // Update task
      return prisma.task.update({
        where: { id: taskId },
        data: {
          affectedByTasks: existingAffected.join(',')
        }
      });
    });

    const results = await Promise.all(updatePromises);
    const updatedCount = results.filter(r => r !== null).length;

    // Also log this as an activity for the source task
    await prisma.activity.create({
      data: {
        taskId: sourceTaskId,
        userId: session.user.id,
        type: 'follow_up',
        description: `Follow-up changes affected ${updatedCount} other task(s)`,
        metadata: JSON.stringify({
          affectedTaskIds,
          timestamp: new Date()
        })
      }
    });

    return NextResponse.json({
      success: true,
      updatedCount
    });

  } catch (error: any) {
    console.error('Error marking affected tasks:', error);
    return NextResponse.json({
      error: 'Failed to mark affected tasks',
      details: error.message
    }, { status: 500 });
  }
}