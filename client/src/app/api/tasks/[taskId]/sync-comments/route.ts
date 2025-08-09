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

// POST /api/tasks/[taskId]/sync-comments - Sync GitHub comments to database
export async function POST(
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
        comments: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Check if task has GitHub integration
    if (!task.githubIssueNumber || 
        !task.project.githubOwner || 
        !task.project.githubRepo) {
      return NextResponse.json({
        error: 'Task is not linked to a GitHub issue'
      }, { status: 400 });
    }

    const octokit = new Octokit({ auth: session.accessToken });

    try {
      // Fetch GitHub comments
      const { data: githubComments } = await octokit.issues.listComments({
        owner: task.project.githubOwner,
        repo: task.project.githubRepo,
        issue_number: task.githubIssueNumber,
      });

      // Get existing GitHub comment IDs from database
      const existingGithubCommentIds = new Set(
        task.comments
          .filter(c => c.githubCommentId)
          .map(c => c.githubCommentId!)
      );

      let syncedCount = 0;
      let updatedCount = 0;
      const syncResults = [];

      for (const githubComment of githubComments) {
        const githubCommentIdStr = githubComment.id.toString();
        
        // Check if comment already exists in database
        const existingComment = task.comments.find(
          c => c.githubCommentId === githubCommentIdStr
        );

        if (existingComment) {
          // Update existing comment if content changed
          if (existingComment.content !== githubComment.body) {
            await prisma.comment.update({
              where: { id: existingComment.id },
              data: {
                content: githubComment.body || '',
                edited: githubComment.created_at !== githubComment.updated_at,
                editedAt: githubComment.created_at !== githubComment.updated_at 
                  ? new Date(githubComment.updated_at) 
                  : null,
                updatedAt: new Date(githubComment.updated_at),
              },
            });
            updatedCount++;
            
            syncResults.push({
              githubCommentId: githubComment.id,
              action: 'updated',
              author: githubComment.user?.login || 'Unknown',
              content: githubComment.body?.substring(0, 100) + '...',
            });
          }
        } else {
          // Find or create GitHub user in our system
          let authorId = session.user.id; // Default to current user
          
          if (githubComment.user) {
            const githubUser = await prisma.user.findUnique({
              where: { githubId: githubComment.user.id.toString() },
            });
            
            if (githubUser) {
              authorId = githubUser.id;
            } else {
              // Create user for GitHub commenter
              try {
                const newUser = await prisma.user.create({
                  data: {
                    githubId: githubComment.user.id.toString(),
                    name: githubComment.user.login,
                    email: null, // We don't have email from comments
                    image: githubComment.user.avatar_url,
                  },
                });
                authorId = newUser.id;
              } catch (userError) {
                // If user creation fails, use current user as fallback
                console.warn('Failed to create user for GitHub commenter:', userError);
              }
            }
          }

          // Create new comment in database
          await prisma.comment.create({
            data: {
              content: githubComment.body || '',
              taskId: task.id,
              authorId,
              githubCommentId: githubCommentIdStr,
              edited: githubComment.created_at !== githubComment.updated_at,
              editedAt: githubComment.created_at !== githubComment.updated_at 
                ? new Date(githubComment.updated_at) 
                : null,
              createdAt: new Date(githubComment.created_at),
              updatedAt: new Date(githubComment.updated_at),
            },
          });
          syncedCount++;
          
          syncResults.push({
            githubCommentId: githubComment.id,
            action: 'created',
            author: githubComment.user?.login || 'Unknown',
            content: githubComment.body?.substring(0, 100) + '...',
          });
        }
      }

      // Create activity log for sync
      if (syncedCount > 0 || updatedCount > 0) {
        await prisma.activity.create({
          data: {
            type: 'synced',
            description: `Synced ${syncedCount} new and ${updatedCount} updated comments from GitHub`,
            taskId: task.id,
            userId: session.user.id,
          },
        });
      }

      return NextResponse.json({
        success: true,
        taskId: task.id,
        taskTitle: task.title,
        githubIssue: {
          number: task.githubIssueNumber,
          url: `${task.project.githubRepoUrl}/issues/${task.githubIssueNumber}`,
        },
        sync: {
          totalGithubComments: githubComments.length,
          newCommentsSynced: syncedCount,
          commentsUpdated: updatedCount,
          results: syncResults,
        },
      });
    } catch (githubError: any) {
      console.error('GitHub API error:', githubError);
      return NextResponse.json({
        error: 'Failed to fetch comments from GitHub',
        details: githubError.message,
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error syncing comments:', error);
    return NextResponse.json(
      { error: 'Failed to sync comments', details: error.message },
      { status: 500 }
    );
  }
}

// GET /api/tasks/[taskId]/sync-comments - Get sync status for comments
export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const task = await prisma.task.findFirst({
      where: {
        id: params.taskId,
        project: {
          userId: session.user.id,
        },
      },
      include: {
        project: true,
        comments: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const hasGithubIntegration = !!(
      task.githubIssueNumber && 
      task.project.githubOwner && 
      task.project.githubRepo
    );

    if (!hasGithubIntegration) {
      return NextResponse.json({
        hasGithubIntegration: false,
        message: 'Task is not linked to a GitHub issue',
      });
    }

    const totalComments = task.comments.length;
    const githubSyncedComments = task.comments.filter(c => c.githubCommentId).length;
    const kanbanOnlyComments = totalComments - githubSyncedComments;

    return NextResponse.json({
      hasGithubIntegration: true,
      taskId: task.id,
      taskTitle: task.title,
      githubIssue: {
        number: task.githubIssueNumber,
        url: `${task.project.githubRepoUrl}/issues/${task.githubIssueNumber}`,
      },
      comments: {
        total: totalComments,
        githubSynced: githubSyncedComments,
        kanbanOnly: kanbanOnlyComments,
      },
      lastSync: task.updatedAt, // Could add a dedicated lastCommentSync field
    });
  } catch (error: any) {
    console.error('Error getting comment sync status:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status', details: error.message },
      { status: 500 }
    );
  }
}