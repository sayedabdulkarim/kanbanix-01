import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { authOptions } from '../../../../auth/[...nextauth]/route';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// PUT /api/tasks/[taskId]/comments/[commentId] - Update comment
export async function PUT(
  request: NextRequest,
  { params }: { params: { taskId: string; commentId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { content } = await request.json();

    if (!content?.trim()) {
      return NextResponse.json(
        { error: 'Comment content is required' },
        { status: 400 }
      );
    }

    // Get comment with task and project details
    const comment = await prisma.comment.findFirst({
      where: {
        id: params.commentId,
        taskId: params.taskId,
        task: {
          project: {
            userId: session.user.id,
          },
        },
      },
      include: {
        author: true,
        task: {
          include: {
            project: true,
          },
        },
      },
    });

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    // Check if user owns the comment or the project
    if (comment.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized to edit this comment' }, { status: 403 });
    }

    // Update on GitHub if comment was synced
    if (comment.githubCommentId && 
        comment.task.githubIssueNumber && 
        comment.task.project.githubOwner && 
        comment.task.project.githubRepo && 
        session.accessToken) {
      
      try {
        const octokit = new Octokit({ auth: session.accessToken });
        
        await octokit.issues.updateComment({
          owner: comment.task.project.githubOwner,
          repo: comment.task.project.githubRepo,
          comment_id: parseInt(comment.githubCommentId),
          body: content,
        });
      } catch (githubError: any) {
        console.error('Error updating GitHub comment:', githubError);
        return NextResponse.json({
          error: 'Failed to update comment on GitHub',
          details: githubError.message,
        }, { status: 500 });
      }
    }

    // Update comment in database
    const updatedComment = await prisma.comment.update({
      where: { id: params.commentId },
      data: {
        content: content.trim(),
        edited: true,
        editedAt: new Date(),
      },
      include: {
        author: true,
      },
    });

    // Create activity log
    await prisma.activity.create({
      data: {
        type: 'updated',
        description: `Comment edited${comment.githubCommentId ? ' and updated on GitHub' : ''}`,
        taskId: comment.taskId,
        userId: session.user.id,
      },
    });

    return NextResponse.json({
      id: updatedComment.id,
      content: updatedComment.content,
      author: {
        name: updatedComment.author.name || 'Unknown',
        image: updatedComment.author.image || '',
      },
      source: comment.githubCommentId ? 'kanban-synced' : 'kanban',
      githubCommentId: comment.githubCommentId,
      createdAt: updatedComment.createdAt,
      updatedAt: updatedComment.updatedAt,
      edited: updatedComment.edited,
      editedAt: updatedComment.editedAt,
    });
  } catch (error: any) {
    console.error('Error updating comment:', error);
    return NextResponse.json(
      { error: 'Failed to update comment', details: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/tasks/[taskId]/comments/[commentId] - Delete comment
export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string; commentId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get comment with task and project details
    const comment = await prisma.comment.findFirst({
      where: {
        id: params.commentId,
        taskId: params.taskId,
        task: {
          project: {
            userId: session.user.id,
          },
        },
      },
      include: {
        task: {
          include: {
            project: true,
          },
        },
      },
    });

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    // Check if user owns the comment or the project
    if (comment.authorId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized to delete this comment' }, { status: 403 });
    }

    // Delete on GitHub if comment was synced
    if (comment.githubCommentId && 
        comment.task.githubIssueNumber && 
        comment.task.project.githubOwner && 
        comment.task.project.githubRepo && 
        session.accessToken) {
      
      try {
        const octokit = new Octokit({ auth: session.accessToken });
        
        await octokit.issues.deleteComment({
          owner: comment.task.project.githubOwner,
          repo: comment.task.project.githubRepo,
          comment_id: parseInt(comment.githubCommentId),
        });
      } catch (githubError: any) {
        console.error('Error deleting GitHub comment:', githubError);
        // Continue with local deletion even if GitHub fails
      }
    }

    // Delete comment from database
    await prisma.comment.delete({
      where: { id: params.commentId },
    });

    // Create activity log
    await prisma.activity.create({
      data: {
        type: 'deleted',
        description: `Comment deleted${comment.githubCommentId ? ' and removed from GitHub' : ''}`,
        taskId: comment.taskId,
        userId: session.user.id,
      },
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Comment deleted successfully' 
    });
  } catch (error: any) {
    console.error('Error deleting comment:', error);
    return NextResponse.json(
      { error: 'Failed to delete comment', details: error.message },
      { status: 500 }
    );
  }
}