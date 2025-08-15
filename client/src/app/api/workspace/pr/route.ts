import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import path from 'path';
import gitService from '@/lib/services/gitService';

const prisma = new PrismaClient();

const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), 'projects'),
};

export async function POST(request: NextRequest) {
  try {
    // Get session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get request data
    const { projectId, taskId, title, description } = await request.json();
    if (!projectId) {
      return NextResponse.json({ 
        error: 'Project ID required' 
      }, { status: 400 });
    }

    // Get project and task details
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!project.githubOwner || !project.githubRepo) {
      return NextResponse.json({ 
        error: 'Project not connected to GitHub' 
      }, { status: 400 });
    }

    let task = null;
    if (taskId) {
      task = await prisma.task.findUnique({
        where: { id: taskId },
      });
    }

    // Get workspace path
    const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);
    
    // Get current branch info
    const branchInfo = await gitService.getBranchInfo(workspacePath);
    
    if (!branchInfo.current || branchInfo.current === 'main' || branchInfo.current === 'master') {
      return NextResponse.json({ 
        error: 'You must be on a feature branch to create a PR' 
      }, { status: 400 });
    }

    // Step 1: Push the branch to GitHub
    console.log(`Pushing branch ${branchInfo.current} to GitHub...`);
    try {
      await gitService.pushBranch(workspacePath, branchInfo.current, session.accessToken);
    } catch (pushError: any) {
      console.error('Push error:', pushError);
      return NextResponse.json({ 
        error: 'Failed to push branch to GitHub',
        details: pushError.message 
      }, { status: 500 });
    }

    // Step 2: Create PR using GitHub API
    const octokit = new Octokit({
      auth: session.accessToken,
    });

    // Generate PR title and description
    const prTitle = title || (task ? `feat: ${task.title}` : `feat: ${branchInfo.current}`);
    const prDescription = description || (task ? 
      `## Summary\n${task.description || 'Task implementation'}\n\n## Task Details\n- Task ID: ${task.id}\n- Created by: AI Agent\n- Branch: ${branchInfo.current}\n\n## Changes\nThis PR includes AI-generated code for the task implementation.` 
      : `## Summary\nChanges from branch ${branchInfo.current}\n\n## Description\n${description || 'Please add a description'}`);

    try {
      const { data: pr } = await octokit.pulls.create({
        owner: project.githubOwner,
        repo: project.githubRepo,
        title: prTitle,
        body: prDescription,
        head: branchInfo.current,
        base: 'main',
        draft: false,
      });

      console.log(`PR created: ${pr.html_url}`);

      // Step 3: Update task with PR info if task exists
      if (task) {
        await prisma.task.update({
          where: { id: taskId },
          data: {
            githubPrNumber: pr.number,
            githubPrId: pr.node_id,
            githubState: pr.state,
          }
        });

        // Log activity
        await prisma.activity.create({
          data: {
            taskId,
            userId: session.user.id,
            type: 'pr_created',
            description: `Created PR #${pr.number}: ${pr.title}`,
            metadata: JSON.stringify({
              projectId,
              action: 'pr_created',
              prNumber: pr.number,
              prUrl: pr.html_url,
              branch: branchInfo.current,
            })
          }
        });
      }

      return NextResponse.json({
        success: true,
        pullRequest: {
          number: pr.number,
          url: pr.html_url,
          state: pr.state,
          title: pr.title,
          branch: branchInfo.current,
        }
      });

    } catch (prError: any) {
      console.error('PR creation error:', prError);
      
      // Check if PR already exists
      if (prError.status === 422 && prError.message.includes('pull request already exists')) {
        // Try to find existing PR
        try {
          const { data: prs } = await octokit.pulls.list({
            owner: project.githubOwner,
            repo: project.githubRepo,
            head: `${project.githubOwner}:${branchInfo.current}`,
            state: 'open',
          });

          if (prs.length > 0) {
            return NextResponse.json({
              success: true,
              pullRequest: {
                number: prs[0].number,
                url: prs[0].html_url,
                state: prs[0].state,
                title: prs[0].title,
                branch: branchInfo.current,
                existing: true,
              }
            });
          }
        } catch (listError) {
          console.error('Error listing PRs:', listError);
        }
      }

      return NextResponse.json({ 
        error: 'Failed to create pull request',
        details: prError.message 
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error('PR creation error:', error);
    return NextResponse.json({
      error: 'Failed to create pull request',
      details: error.message
    }, { status: 500 });
  }
}