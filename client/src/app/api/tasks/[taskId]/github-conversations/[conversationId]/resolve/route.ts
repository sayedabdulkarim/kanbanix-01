import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { authOptions } from '../../../../../auth/[...nextauth]/route';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// POST /api/tasks/[taskId]/github-conversations/[conversationId]/resolve
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; conversationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId, conversationId } = await params;
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
      // GitHub uses GraphQL API for resolving conversations
      // We need to use the GraphQL endpoint
      const graphqlQuery = `
        mutation($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread {
              id
              isResolved
            }
          }
        }
      `;

      // Convert comment ID to thread ID format that GitHub expects
      const threadId = `PRReviewThread_${conversationId}`;

      const result = await octokit.graphql(graphqlQuery, {
        threadId: threadId,
      });

      // Log activity
      await prisma.activity.create({
        data: {
          type: 'resolved',
          description: `Resolved PR conversation thread on GitHub`,
          taskId: task.id,
          userId: session.user.id,
        },
      });

      return NextResponse.json({
        success: true,
        conversationId: conversationId,
        resolved: true,
        result: result,
      });
    } catch (githubError: any) {
      console.error('GitHub GraphQL error:', githubError);
      
      // Fallback: Try to add a comment indicating resolution
      try {
        await octokit.pulls.createReplyForReviewComment({
          owner: task.project.githubOwner,
          repo: task.project.githubRepo,
          pull_number: task.githubPrNumber,
          comment_id: parseInt(conversationId),
          body: '✅ **Resolved** - This conversation has been marked as resolved from Kanbanix.',
        });

        return NextResponse.json({
          success: true,
          conversationId: params.conversationId,
          resolved: true,
          method: 'comment_fallback',
          message: 'Added resolution comment to thread',
        });
      } catch (fallbackError: any) {
        return NextResponse.json({
          error: 'Failed to resolve conversation',
          details: githubError.message,
          fallbackError: fallbackError.message,
        }, { status: 500 });
      }
    }
  } catch (error: any) {
    console.error('Error resolving conversation:', error);
    return NextResponse.json(
      { error: 'Failed to resolve conversation', details: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/tasks/[taskId]/github-conversations/[conversationId]/resolve - Unresolve
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; conversationId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId, conversationId } = await params;
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
      // GitHub GraphQL API for unresolving
      const graphqlQuery = `
        mutation($threadId: ID!) {
          unresolveReviewThread(input: { threadId: $threadId }) {
            thread {
              id
              isResolved
            }
          }
        }
      `;

      const threadId = `PRReviewThread_${conversationId}`;

      const result = await octokit.graphql(graphqlQuery, {
        threadId: threadId,
      });

      // Log activity
      await prisma.activity.create({
        data: {
          type: 'reopened',
          description: `Unresolved PR conversation thread on GitHub`,
          taskId: task.id,
          userId: session.user.id,
        },
      });

      return NextResponse.json({
        success: true,
        conversationId: conversationId,
        resolved: false,
        result: result,
      });
    } catch (githubError: any) {
      console.error('GitHub GraphQL error:', githubError);
      return NextResponse.json({
        error: 'Failed to unresolve conversation',
        details: githubError.message,
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error unresolving conversation:', error);
    return NextResponse.json(
      { error: 'Failed to unresolve conversation', details: error.message },
      { status: 500 }
    );
  }
}