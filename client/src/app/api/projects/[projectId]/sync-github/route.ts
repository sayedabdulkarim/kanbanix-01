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

// POST /api/projects/[projectId]/sync-github - Sync all project tasks with GitHub
export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get project with tasks
    const project = await prisma.project.findFirst({
      where: {
        id: params.projectId,
        userId: session.user.id,
      },
      include: {
        tasks: {
          where: {
            githubIssueNumber: {
              not: null,
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!project.githubOwner || !project.githubRepo) {
      return NextResponse.json({
        error: 'Project is not linked to a GitHub repository'
      }, { status: 400 });
    }

    const octokit = new Octokit({
      auth: session.accessToken,
    });

    const syncResults = [];
    let syncedCount = 0;
    let errorCount = 0;

    // Sync each task with GitHub
    for (const task of project.tasks) {
      try {
        // Fetch current issue from GitHub
        const { data: issue } = await octokit.issues.get({
          owner: project.githubOwner,
          repo: project.githubRepo,
          issue_number: task.githubIssueNumber!,
        });

        // Determine if update is needed
        let needsUpdate = false;
        let newStatus = task.status;
        
        // Sync GitHub state to task status
        if (issue.state === 'closed' && task.status !== 'done') {
          newStatus = 'done';
          needsUpdate = true;
        } else if (issue.state === 'open' && task.status === 'done') {
          newStatus = 'todo';
          needsUpdate = true;
        }

        if (needsUpdate) {
          // Update task in database
          await prisma.task.update({
            where: { id: task.id },
            data: {
              status: newStatus,
              githubState: issue.state,
            },
          });

          // Create activity log
          await prisma.activity.create({
            data: {
              type: 'synced',
              description: `Task auto-synced with GitHub issue #${task.githubIssueNumber}: ${issue.state}`,
              taskId: task.id,
              userId: session.user.id,
            },
          });

          syncedCount++;
        }

        syncResults.push({
          taskId: task.id,
          taskTitle: task.title,
          githubIssueNumber: task.githubIssueNumber,
          previousStatus: task.status,
          newStatus: newStatus,
          githubState: issue.state,
          synced: needsUpdate,
          githubUrl: issue.html_url,
        });
      } catch (issueError: any) {
        console.error(`Error syncing task ${task.id}:`, issueError);
        errorCount++;
        
        syncResults.push({
          taskId: task.id,
          taskTitle: task.title,
          githubIssueNumber: task.githubIssueNumber,
          error: issueError.message,
          synced: false,
        });
      }
    }

    return NextResponse.json({
      success: true,
      projectId: project.id,
      projectName: project.name,
      totalTasks: project.tasks.length,
      syncedCount,
      errorCount,
      results: syncResults,
    });
  } catch (error: any) {
    console.error('Error syncing project with GitHub:', error);
    return NextResponse.json(
      { error: 'Failed to sync project', details: error.message },
      { status: 500 }
    );
  }
}

// GET /api/projects/[projectId]/sync-github - Get sync status for all tasks
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const project = await prisma.project.findFirst({
      where: {
        id: params.projectId,
        userId: session.user.id,
      },
      include: {
        tasks: {
          where: {
            githubIssueNumber: {
              not: null,
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const githubIntegratedTasks = project.tasks.length;
    const totalTasks = await prisma.task.count({
      where: { projectId: project.id },
    });

    return NextResponse.json({
      projectId: project.id,
      projectName: project.name,
      hasGitHubIntegration: !!(project.githubOwner && project.githubRepo),
      githubRepo: project.githubRepoUrl,
      totalTasks,
      githubIntegratedTasks,
      integrationPercentage: totalTasks > 0 ? Math.round((githubIntegratedTasks / totalTasks) * 100) : 0,
      lastSyncAt: project.updatedAt, // This could be a dedicated field
    });
  } catch (error: any) {
    console.error('Error getting sync status:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status', details: error.message },
      { status: 500 }
    );
  }
}