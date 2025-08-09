import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { authOptions } from '../../../auth/[...nextauth]/route';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// POST /api/tasks/[taskId]/sync-github - Sync task with GitHub issue
export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action } = await request.json(); // 'open', 'close', 'reopen'

    // Get task with project details
    const task = await prisma.task.findFirst({
      where: {
        id: params.taskId,
        project: {
          userId: session.user.id,
        },
      },
      include: {
        project: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Check if task has GitHub integration
    if (!task.githubIssueNumber || !task.project.githubOwner || !task.project.githubRepo) {
      return NextResponse.json({ 
        error: 'Task is not linked to a GitHub issue' 
      }, { status: 400 });
    }

    const octokit = new Octokit({
      auth: session.accessToken,
    });

    let githubState = 'open';
    let taskStatus = 'todo';

    // Map actions to GitHub states and task statuses
    switch (action) {
      case 'close':
        githubState = 'closed';
        taskStatus = 'done';
        break;
      case 'reopen':
        githubState = 'open';
        taskStatus = 'todo';
        break;
      case 'open':
      default:
        githubState = 'open';
        taskStatus = 'todo';
        break;
    }

    // Update GitHub issue state
    try {
      await octokit.issues.update({
        owner: task.project.githubOwner,
        repo: task.project.githubRepo,
        issue_number: task.githubIssueNumber,
        state: githubState as 'open' | 'closed',
      });
    } catch (githubError: any) {
      console.error('GitHub API error:', githubError);
      return NextResponse.json({
        error: 'Failed to update GitHub issue',
        details: githubError.message,
      }, { status: 500 });
    }

    // Update task in database
    const updatedTask = await prisma.task.update({
      where: { id: params.taskId },
      data: {
        status: taskStatus,
        githubState: githubState,
      },
    });

    // Create activity log
    await prisma.activity.create({
      data: {
        type: 'synced',
        description: `Task synced with GitHub: ${action} issue #${task.githubIssueNumber}`,
        taskId: task.id,
        userId: session.user.id,
      },
    });

    return NextResponse.json({
      success: true,
      task: {
        id: updatedTask.id,
        status: updatedTask.status,
        githubState: updatedTask.githubState,
      },
      githubAction: action,
    });
  } catch (error: any) {
    console.error('Error syncing task with GitHub:', error);
    return NextResponse.json(
      { error: 'Failed to sync with GitHub', details: error.message },
      { status: 500 }
    );
  }
}

// GET /api/tasks/[taskId]/sync-github - Get GitHub sync status
export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get task with project details
    const task = await prisma.task.findFirst({
      where: {
        id: params.taskId,
        project: {
          userId: session.user.id,
        },
      },
      include: {
        project: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Check if task has GitHub integration
    if (!task.githubIssueNumber || !task.project.githubOwner || !task.project.githubRepo) {
      return NextResponse.json({ 
        hasGitHubIntegration: false,
        message: 'Task is not linked to a GitHub issue'
      });
    }

    const octokit = new Octokit({
      auth: session.accessToken,
    });

    try {
      // Fetch current issue state from GitHub
      const { data: issue } = await octokit.issues.get({
        owner: task.project.githubOwner,
        repo: task.project.githubRepo,
        issue_number: task.githubIssueNumber,
      });

      // Check if states are in sync
      const isInSync = (
        (issue.state === 'open' && ['todo', 'in_progress', 'in_review'].includes(task.status)) ||
        (issue.state === 'closed' && task.status === 'done')
      );

      return NextResponse.json({
        hasGitHubIntegration: true,
        isInSync,
        github: {
          state: issue.state,
          title: issue.title,
          url: issue.html_url,
          updatedAt: issue.updated_at,
        },
        task: {
          status: task.status,
          githubState: task.githubState,
          updatedAt: task.updatedAt,
        },
      });
    } catch (githubError: any) {
      console.error('GitHub API error:', githubError);
      return NextResponse.json({
        hasGitHubIntegration: true,
        error: 'Failed to fetch GitHub issue status',
        details: githubError.message,
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error getting GitHub sync status:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status', details: error.message },
      { status: 500 }
    );
  }
}