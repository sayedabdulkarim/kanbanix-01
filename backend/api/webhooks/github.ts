import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { prisma } from '../../lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-hub-signature-256');
    const event = request.headers.get('x-github-event');
    const deliveryId = request.headers.get('x-github-delivery');

    if (!signature || !event) {
      return NextResponse.json(
        { error: 'Missing required headers' },
        { status: 400 }
      );
    }

    // Parse the payload
    const payload = JSON.parse(body);
    
    // Get the webhook configuration from database
    const webhook = await prisma.webhook.findFirst({
      where: {
        projectId: {
          in: await prisma.project.findMany({
            where: {
              githubRepoId: payload.repository?.id?.toString(),
            },
            select: { id: true },
          }).then(projects => projects.map(p => p.id)),
        },
      },
    });

    if (!webhook) {
      console.log('No webhook configuration found for repository');
      return NextResponse.json({ message: 'Webhook not configured' });
    }

    // Verify webhook signature
    const hash = createHmac('sha256', webhook.secret)
      .update(body)
      .digest('hex');
    const expectedSignature = `sha256=${hash}`;

    if (signature !== expectedSignature) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Handle different webhook events
    switch (event) {
      case 'issues':
        await handleIssueEvent(payload);
        break;
      case 'pull_request':
        await handlePullRequestEvent(payload);
        break;
      case 'issue_comment':
        await handleCommentEvent(payload);
        break;
      case 'push':
        await handlePushEvent(payload);
        break;
      default:
        console.log(`Unhandled event type: ${event}`);
    }

    return NextResponse.json({ 
      message: 'Webhook processed successfully',
      event,
      deliveryId,
    });
  } catch (error: any) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook', details: error.message },
      { status: 500 }
    );
  }
}

async function handleIssueEvent(payload: any) {
  const { action, issue, repository } = payload;
  
  // Find the project
  const project = await prisma.project.findUnique({
    where: { githubRepoId: repository.id.toString() },
    include: { columns: true },
  });

  if (!project) return;

  switch (action) {
    case 'opened':
      // Create a new task for the issue
      const backlogColumn = project.columns.find(col => col.name === 'Backlog');
      if (backlogColumn) {
        await prisma.task.create({
          data: {
            title: issue.title,
            description: issue.body || '',
            status: 'todo',
            githubIssueNumber: issue.number,
            githubIssueId: issue.id.toString(),
            githubState: issue.state,
            projectId: project.id,
            columnId: backlogColumn.id,
            order: await prisma.task.count({
              where: { columnId: backlogColumn.id },
            }),
          },
        });

        // Log activity
        await prisma.activity.create({
          data: {
            type: 'created',
            description: `Issue #${issue.number} created: ${issue.title}`,
            metadata: JSON.stringify({ issueNumber: issue.number }),
            userId: project.userId,
          },
        });
      }
      break;

    case 'closed':
      // Move task to Done column
      const doneColumn = project.columns.find(col => col.name === 'Done');
      if (doneColumn) {
        await prisma.task.updateMany({
          where: {
            githubIssueNumber: issue.number,
            projectId: project.id,
          },
          data: {
            status: 'done',
            githubState: 'closed',
            columnId: doneColumn.id,
            completedAt: new Date(),
          },
        });
      }
      break;

    case 'reopened':
      // Move task back to To Do column
      const todoColumn = project.columns.find(col => col.name === 'To Do');
      if (todoColumn) {
        await prisma.task.updateMany({
          where: {
            githubIssueNumber: issue.number,
            projectId: project.id,
          },
          data: {
            status: 'todo',
            githubState: 'open',
            columnId: todoColumn.id,
            completedAt: null,
          },
        });
      }
      break;

    case 'edited':
      // Update task title and description
      await prisma.task.updateMany({
        where: {
          githubIssueNumber: issue.number,
          projectId: project.id,
        },
        data: {
          title: issue.title,
          description: issue.body || '',
        },
      });
      break;
  }
}

async function handlePullRequestEvent(payload: any) {
  const { action, pull_request, repository } = payload;
  
  const project = await prisma.project.findUnique({
    where: { githubRepoId: repository.id.toString() },
    include: { columns: true },
  });

  if (!project) return;

  switch (action) {
    case 'opened':
      // Create or update task for PR
      const inReviewColumn = project.columns.find(col => col.name === 'In Review');
      if (inReviewColumn) {
        // Check if task already exists for related issue
        const existingTask = await prisma.task.findFirst({
          where: {
            OR: [
              { githubPrNumber: pull_request.number },
              { githubBranch: pull_request.head.ref },
            ],
            projectId: project.id,
          },
        });

        if (existingTask) {
          // Update existing task
          await prisma.task.update({
            where: { id: existingTask.id },
            data: {
              githubPrNumber: pull_request.number,
              githubPrId: pull_request.id.toString(),
              status: 'inReview',
              columnId: inReviewColumn.id,
            },
          });
        } else {
          // Create new task for PR
          await prisma.task.create({
            data: {
              title: pull_request.title,
              description: pull_request.body || '',
              status: 'inReview',
              githubPrNumber: pull_request.number,
              githubPrId: pull_request.id.toString(),
              githubBranch: pull_request.head.ref,
              projectId: project.id,
              columnId: inReviewColumn.id,
              order: await prisma.task.count({
                where: { columnId: inReviewColumn.id },
              }),
            },
          });
        }
      }
      break;

    case 'closed':
      if (pull_request.merged) {
        // Move to Done column if merged
        const doneColumn = project.columns.find(col => col.name === 'Done');
        if (doneColumn) {
          await prisma.task.updateMany({
            where: {
              githubPrNumber: pull_request.number,
              projectId: project.id,
            },
            data: {
              status: 'done',
              columnId: doneColumn.id,
              completedAt: new Date(),
            },
          });
        }
      } else {
        // Move back to In Progress if closed without merging
        const inProgressColumn = project.columns.find(col => col.name === 'In Progress');
        if (inProgressColumn) {
          await prisma.task.updateMany({
            where: {
              githubPrNumber: pull_request.number,
              projectId: project.id,
            },
            data: {
              status: 'inProgress',
              columnId: inProgressColumn.id,
            },
          });
        }
      }
      break;
  }
}

async function handleCommentEvent(payload: any) {
  const { action, issue, comment, repository } = payload;
  
  const project = await prisma.project.findUnique({
    where: { githubRepoId: repository.id.toString() },
  });

  if (!project) return;

  // Find the related task
  const task = await prisma.task.findFirst({
    where: {
      githubIssueNumber: issue.number,
      projectId: project.id,
    },
  });

  if (!task) return;

  switch (action) {
    case 'created':
      // Add comment to task
      await prisma.comment.create({
        data: {
          content: comment.body,
          githubCommentId: comment.id.toString(),
          taskId: task.id,
          authorId: project.userId, // This should be mapped to actual user
        },
      });

      // Log activity
      await prisma.activity.create({
        data: {
          type: 'commented',
          description: `Comment added to issue #${issue.number}`,
          taskId: task.id,
          userId: project.userId,
        },
      });
      break;

    case 'edited':
      // Update comment
      await prisma.comment.updateMany({
        where: {
          githubCommentId: comment.id.toString(),
        },
        data: {
          content: comment.body,
          edited: true,
          editedAt: new Date(),
        },
      });
      break;

    case 'deleted':
      // Delete comment
      await prisma.comment.deleteMany({
        where: {
          githubCommentId: comment.id.toString(),
        },
      });
      break;
  }
}

async function handlePushEvent(payload: any) {
  const { ref, commits, repository } = payload;
  
  const project = await prisma.project.findUnique({
    where: { githubRepoId: repository.id.toString() },
  });

  if (!project) return;

  // Extract branch name from ref
  const branch = ref.replace('refs/heads/', '');

  // Find tasks associated with this branch
  const tasks = await prisma.task.findMany({
    where: {
      githubBranch: branch,
      projectId: project.id,
    },
  });

  // Log activity for each commit
  for (const commit of commits) {
    await prisma.activity.create({
      data: {
        type: 'push',
        description: `Commit to ${branch}: ${commit.message}`,
        metadata: JSON.stringify({
          branch,
          sha: commit.id,
          author: commit.author.name,
        }),
        userId: project.userId,
      },
    });
  }

  // If there are tasks on this branch, update them
  if (tasks.length > 0) {
    const inProgressColumn = await prisma.column.findFirst({
      where: {
        projectId: project.id,
        name: 'In Progress',
      },
    });

    if (inProgressColumn) {
      await prisma.task.updateMany({
        where: {
          id: { in: tasks.map(t => t.id) },
          status: 'todo',
        },
        data: {
          status: 'inProgress',
          columnId: inProgressColumn.id,
        },
      });
    }
  }
}