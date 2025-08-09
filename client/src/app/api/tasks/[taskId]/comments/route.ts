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

// GET /api/tasks/[taskId]/comments - Fetch unified comments from DB and GitHub
export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
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
        comments: {
          include: {
            author: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    let githubComments: any[] = [];

    // Fetch GitHub comments if task has GitHub integration
    if (task.githubIssueNumber && 
        task.project.githubOwner && 
        task.project.githubRepo && 
        session.accessToken) {
      
      try {
        const octokit = new Octokit({ auth: session.accessToken });
        
        const { data: comments } = await octokit.issues.listComments({
          owner: task.project.githubOwner,
          repo: task.project.githubRepo,
          issue_number: task.githubIssueNumber,
        });

        githubComments = comments.map(comment => ({
          id: `github-${comment.id}`,
          content: comment.body || '',
          author: {
            name: comment.user?.login || 'Unknown',
            image: comment.user?.avatar_url || '',
            githubId: comment.user?.id,
          },
          source: 'github',
          githubCommentId: comment.id,
          githubUrl: comment.html_url,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
          edited: comment.created_at !== comment.updated_at,
        }));
      } catch (githubError: any) {
        console.error('Error fetching GitHub comments:', githubError);
        // Don't fail the entire request if GitHub is unavailable
      }
    }

    // Format database comments
    const dbComments = task.comments.map(comment => ({
      id: comment.id,
      content: comment.content,
      author: {
        name: comment.author.name || 'Unknown',
        image: comment.author.image || '',
      },
      source: comment.githubCommentId ? 'github-synced' : 'kanban',
      githubCommentId: comment.githubCommentId,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      edited: comment.edited,
      editedAt: comment.editedAt,
    }));

    // Merge and sort comments by creation time
    const allComments = [...dbComments, ...githubComments]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return NextResponse.json({
      taskId: task.id,
      taskTitle: task.title,
      githubIntegration: {
        hasGithubIssue: !!task.githubIssueNumber,
        issueNumber: task.githubIssueNumber,
        issueUrl: task.githubIssueNumber ? 
          `${task.project.githubRepoUrl}/issues/${task.githubIssueNumber}` : null,
      },
      comments: allComments,
      totalComments: allComments.length,
    });
  } catch (error: any) {
    console.error('Error fetching comments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch comments', details: error.message },
      { status: 500 }
    );
  }
}

// POST /api/tasks/[taskId]/comments - Create new comment and optionally post to GitHub
export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { content, postToGithub = true } = await request.json();

    if (!content?.trim()) {
      return NextResponse.json(
        { error: 'Comment content is required' },
        { status: 400 }
      );
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

    let githubCommentId: number | null = null;
    let githubUrl: string | null = null;

    // Post to GitHub if requested and integration exists
    if (postToGithub && 
        task.githubIssueNumber && 
        task.project.githubOwner && 
        task.project.githubRepo && 
        session.accessToken) {
      
      try {
        const octokit = new Octokit({ auth: session.accessToken });
        
        const { data: githubComment } = await octokit.issues.createComment({
          owner: task.project.githubOwner,
          repo: task.project.githubRepo,
          issue_number: task.githubIssueNumber,
          body: content,
        });

        githubCommentId = githubComment.id;
        githubUrl = githubComment.html_url;
      } catch (githubError: any) {
        console.error('Error posting to GitHub:', githubError);
        // Continue with saving to database even if GitHub fails
      }
    }

    // Save comment to database
    const comment = await prisma.comment.create({
      data: {
        content: content.trim(),
        taskId: task.id,
        authorId: session.user.id,
        githubCommentId: githubCommentId ? githubCommentId.toString() : null,
      },
      include: {
        author: true,
      },
    });

    // Create activity log
    await prisma.activity.create({
      data: {
        type: 'commented',
        description: `Comment added${githubCommentId ? ' and posted to GitHub' : ''}`,
        taskId: task.id,
        userId: session.user.id,
      },
    });

    return NextResponse.json({
      id: comment.id,
      content: comment.content,
      author: {
        name: comment.author.name || 'Unknown',
        image: comment.author.image || '',
      },
      source: githubCommentId ? 'kanban-synced' : 'kanban',
      githubCommentId,
      githubUrl,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      edited: false,
      editedAt: null,
    });
  } catch (error: any) {
    console.error('Error creating comment:', error);
    return NextResponse.json(
      { error: 'Failed to create comment', details: error.message },
      { status: 500 }
    );
  }
}