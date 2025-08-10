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

// GET /api/tasks/[taskId]/github-conversations - Get PR review conversations
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId } = await params;
    // Get task with project details
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
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

    // Check if task has PR integration
    if (!task.githubPrNumber || 
        !task.project.githubOwner || 
        !task.project.githubRepo) {
      return NextResponse.json({
        error: 'Task is not linked to a GitHub Pull Request'
      }, { status: 400 });
    }

    const octokit = new Octokit({ auth: session.accessToken });

    try {
      // Get PR reviews
      const { data: reviews } = await octokit.pulls.listReviews({
        owner: task.project.githubOwner,
        repo: task.project.githubRepo,
        pull_number: task.githubPrNumber,
      });

      // Get review comments (conversations)
      const { data: reviewComments } = await octokit.pulls.listReviewComments({
        owner: task.project.githubOwner,
        repo: task.project.githubRepo,
        pull_number: task.githubPrNumber,
      });

      // Group comments by conversation thread
      const conversationThreads = new Map();
      
      for (const comment of reviewComments) {
        const threadId = comment.in_reply_to_id || comment.id;
        
        if (!conversationThreads.has(threadId)) {
          conversationThreads.set(threadId, {
            id: threadId,
            resolved: false, // Will be determined by GitHub API
            file: comment.path,
            line: comment.line || comment.original_line,
            diffHunk: comment.diff_hunk,
            comments: [],
          });
        }
        
        conversationThreads.get(threadId).comments.push({
          id: comment.id,
          body: comment.body,
          author: {
            login: comment.user.login,
            avatar_url: comment.user.avatar_url,
          },
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
          isReply: !!comment.in_reply_to_id,
        });
      }

      // Convert to array and sort
      const conversations = Array.from(conversationThreads.values()).map(thread => ({
        ...thread,
        comments: thread.comments.sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ),
        totalComments: thread.comments.length,
        lastActivity: thread.comments.length > 0 
          ? thread.comments[thread.comments.length - 1].updatedAt 
          : null,
      }));

      return NextResponse.json({
        taskId: task.id,
        taskTitle: task.title,
        pullRequest: {
          number: task.githubPrNumber,
          url: `${task.project.githubRepoUrl}/pull/${task.githubPrNumber}`,
        },
        reviews: reviews.map(review => ({
          id: review.id,
          state: review.state,
          body: review.body,
          author: {
            login: review.user?.login,
            avatar_url: review.user?.avatar_url,
          },
          submittedAt: review.submitted_at,
        })),
        conversations: conversations.sort((a, b) => 
          new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime()
        ),
        summary: {
          totalReviews: reviews.length,
          totalConversations: conversations.length,
          unresolvedConversations: conversations.filter(c => !c.resolved).length,
        },
      });
    } catch (githubError: any) {
      console.error('GitHub API error:', githubError);
      return NextResponse.json({
        error: 'Failed to fetch GitHub conversations',
        details: githubError.message,
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error fetching GitHub conversations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch conversations', details: error.message },
      { status: 500 }
    );
  }
}

// POST /api/tasks/[taskId]/github-conversations - Reply to PR conversation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { commentId, body } = await request.json();

    if (!commentId || !body?.trim()) {
      return NextResponse.json(
        { error: 'Comment ID and body are required' },
        { status: 400 }
      );
    }

    const { taskId } = await params;
    // Get task with project details
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
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

    if (!task.githubPrNumber || 
        !task.project.githubOwner || 
        !task.project.githubRepo) {
      return NextResponse.json({
        error: 'Task is not linked to a GitHub Pull Request'
      }, { status: 400 });
    }

    const octokit = new Octokit({ auth: session.accessToken });

    try {
      // Reply to review comment
      const { data: reply } = await octokit.pulls.createReplyForReviewComment({
        owner: task.project.githubOwner,
        repo: task.project.githubRepo,
        pull_number: task.githubPrNumber,
        comment_id: parseInt(commentId),
        body: body.trim(),
      });

      // Log activity
      await prisma.activity.create({
        data: {
          type: 'commented',
          description: `Replied to PR conversation on GitHub`,
          taskId: task.id,
          userId: session.user.id,
        },
      });

      return NextResponse.json({
        success: true,
        reply: {
          id: reply.id,
          body: reply.body,
          author: {
            login: reply.user.login,
            avatar_url: reply.user.avatar_url,
          },
          createdAt: reply.created_at,
          url: reply.html_url,
        },
      });
    } catch (githubError: any) {
      console.error('GitHub API error:', githubError);
      return NextResponse.json({
        error: 'Failed to reply to conversation',
        details: githubError.message,
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error replying to conversation:', error);
    return NextResponse.json(
      { error: 'Failed to reply', details: error.message },
      { status: 500 }
    );
  }
}