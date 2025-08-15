import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId, taskId } = await request.json();
    
    // Get task with project details
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { project: true }
    });

    if (!task || !task.githubPrNumber) {
      return NextResponse.json({ 
        error: 'Task not found or no PR associated' 
      }, { status: 404 });
    }

    // Check GitHub PR status
    const octokit = new Octokit({
      auth: session.accessToken,
    });

    const { data: pr } = await octokit.pulls.get({
      owner: task.project.githubOwner!,
      repo: task.project.githubRepo!,
      pull_number: task.githubPrNumber,
    });

    console.log(`PR #${pr.number} status: ${pr.state}, merged: ${pr.merged}`);

    // Update task based on PR status
    let newStatus = task.status;
    let newColumnId = task.columnId;
    
    if (pr.merged) {
      // PR is merged - move to Done
      newStatus = 'done';
      
      const doneColumn = await prisma.column.findFirst({
        where: {
          projectId: task.projectId,
          OR: [
            { name: { contains: 'Done', mode: 'insensitive' } },
            { name: { contains: 'done', mode: 'insensitive' } },
            { name: { contains: 'Completed', mode: 'insensitive' } },
          ]
        }
      });
      
      if (doneColumn) {
        newColumnId = doneColumn.id;
      }
      
    } else if (pr.state === 'open') {
      // PR is open - should be in Review
      newStatus = 'inReview';
      
      const reviewColumn = await prisma.column.findFirst({
        where: {
          projectId: task.projectId,
          OR: [
            { name: { contains: 'Review', mode: 'insensitive' } },
            { name: { contains: 'review', mode: 'insensitive' } },
          ]
        }
      });
      
      if (reviewColumn) {
        newColumnId = reviewColumn.id;
      }
      
    } else if (pr.state === 'closed' && !pr.merged) {
      // PR closed without merge - back to In Progress
      newStatus = 'inProgress';
      
      const progressColumn = await prisma.column.findFirst({
        where: {
          projectId: task.projectId,
          OR: [
            { name: { contains: 'Progress', mode: 'insensitive' } },
            { name: { contains: 'progress', mode: 'insensitive' } },
          ]
        }
      });
      
      if (progressColumn) {
        newColumnId = progressColumn.id;
      }
    }

    // Update task if status changed
    if (newStatus !== task.status || newColumnId !== task.columnId) {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: newStatus,
          columnId: newColumnId,
          githubState: pr.merged ? 'merged' : pr.state,
          completedAt: pr.merged ? new Date(pr.merged_at!) : null,
        }
      });

      // Log activity
      await prisma.activity.create({
        data: {
          taskId: task.id,
          userId: session.user.id,
          type: 'status_sync',
          description: `Task synced with PR #${pr.number} (${pr.merged ? 'merged' : pr.state})`,
          metadata: JSON.stringify({
            prNumber: pr.number,
            prState: pr.state,
            merged: pr.merged,
            previousStatus: task.status,
            newStatus: newStatus,
          })
        }
      });
    }

    return NextResponse.json({
      success: true,
      task: {
        id: taskId,
        status: newStatus,
        columnId: newColumnId,
        githubState: pr.merged ? 'merged' : pr.state,
      },
      pr: {
        number: pr.number,
        state: pr.state,
        merged: pr.merged,
        url: pr.html_url,
      }
    });

  } catch (error: any) {
    console.error('PR sync error:', error);
    return NextResponse.json({
      error: 'Failed to sync PR status',
      details: error.message
    }, { status: 500 });
  }
}