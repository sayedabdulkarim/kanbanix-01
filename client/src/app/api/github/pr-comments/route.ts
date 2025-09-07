import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';

const prisma = new PrismaClient();

// POST /api/github/pr-comments - Fetch PR comments from GitHub
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, prNumber } = body;

    if (!projectId || !prNumber) {
      return NextResponse.json({ 
        error: 'Project ID and PR number are required' 
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

    // Initialize Octokit with user's GitHub token
    console.log(`[GitHub PR Comments] Using token: ${project.user.githubToken ? 'Token exists' : 'No token'}`);
    const octokit = new Octokit({
      auth: project.user.githubToken
    });

    console.log(`[GitHub PR Comments] Fetching comments for PR #${prNumber} in ${project.githubOwner}/${project.githubRepo}`);
    
    // Fetch all types of comments
    let issueComments, reviewComments, reviews;
    
    try {
      [issueComments, reviewComments, reviews] = await Promise.all([
        // General PR comments (issue comments)
        octokit.issues.listComments({
          owner: project.githubOwner,
          repo: project.githubRepo,
          issue_number: prNumber
        }),
        
        // Line-specific review comments
        octokit.pulls.listReviewComments({
          owner: project.githubOwner,
          repo: project.githubRepo,
          pull_number: prNumber
        }),
        
        // PR reviews (approved, changes requested, etc.)
        octokit.pulls.listReviews({
          owner: project.githubOwner,
          repo: project.githubRepo,
          pull_number: prNumber
        })
      ]);
    } catch (apiError: any) {
      console.error(`[GitHub PR Comments] API Error:`, apiError.message);
      console.error(`[GitHub PR Comments] API Status:`, apiError.status);
      throw apiError;
    }
    
    console.log(`[GitHub PR Comments] Found ${issueComments.data.length} issue comments, ${reviewComments.data.length} review comments, ${reviews.data.length} reviews`);

    // Combine and format comments
    const allComments = [
      ...issueComments.data.map(comment => ({
        ...comment,
        type: 'issue_comment'
      })),
      ...reviewComments.data.map(comment => ({
        ...comment,
        type: 'review_comment'
      }))
    ];

    // Sort comments by created date
    allComments.sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    return NextResponse.json({
      success: true,
      comments: allComments,
      reviews: reviews.data
    });

  } catch (error: any) {
    console.error('Error fetching GitHub PR comments:', error);
    
    // Handle GitHub API errors
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

    return NextResponse.json({
      error: 'Failed to fetch PR comments',
      details: error.message
    }, { status: 500 });
  }
}