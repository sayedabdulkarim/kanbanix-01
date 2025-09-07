import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';

const prisma = new PrismaClient();

// POST /api/github/pr-comments/create - Post a comment to GitHub PR
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, prNumber, body: commentBody, inReplyTo, path, line, side } = body;

    if (!projectId || !prNumber || !commentBody) {
      return NextResponse.json({ 
        error: 'Project ID, PR number, and comment body are required' 
      }, { status: 400 });
    }

    // Get project details
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { user: true }
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Verify user owns the project
    if (project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Initialize Octokit with user's GitHub token
    const octokit = new Octokit({
      auth: project.user.githubToken
    });

    let comment;

    // If this is a line-specific comment
    if (path && line) {
      // Get the latest commit SHA for the PR
      const pr = await octokit.pulls.get({
        owner: project.githubOwner,
        repo: project.githubRepo,
        pull_number: prNumber
      });

      comment = await octokit.pulls.createReviewComment({
        owner: project.githubOwner,
        repo: project.githubRepo,
        pull_number: prNumber,
        body: commentBody,
        commit_id: pr.data.head.sha,
        path,
        line: parseInt(line),
        side: side || 'RIGHT',
        ...(inReplyTo && { in_reply_to: inReplyTo })
      });
    } else {
      // General PR comment
      comment = await octokit.issues.createComment({
        owner: project.githubOwner,
        repo: project.githubRepo,
        issue_number: prNumber,
        body: commentBody
      });
    }

    // Log activity
    await prisma.activity.create({
      data: {
        taskId: body.taskId || null,
        userId: session.user.id,
        type: 'pr_comment',
        description: `Added comment to PR #${prNumber}`,
        metadata: JSON.stringify({
          prNumber,
          commentId: comment.data.id,
          commentUrl: comment.data.html_url
        })
      }
    });

    return NextResponse.json({
      success: true,
      comment: comment.data
    });

  } catch (error: any) {
    console.error('Error posting GitHub PR comment:', error);
    
    if (error.status === 404) {
      return NextResponse.json({
        error: 'Pull request not found',
        details: 'The PR may have been deleted or you may not have access'
      }, { status: 404 });
    }
    
    if (error.status === 401) {
      return NextResponse.json({
        error: 'GitHub authentication failed',
        details: 'Please reconnect your GitHub account'
      }, { status: 401 });
    }

    if (error.status === 422) {
      return NextResponse.json({
        error: 'Invalid comment',
        details: 'The comment could not be posted. Check if the line number is valid.'
      }, { status: 422 });
    }

    return NextResponse.json({
      error: 'Failed to post comment',
      details: error.message
    }, { status: 500 });
  }
}