import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import path from 'path';
import gitService from '@/lib/services/gitService';

const prisma = new PrismaClient();

const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), '..', 'workspace-projects'),
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

    // Get the last commit message to use as PR title if not provided
    let lastCommitMessage = '';
    let lastCommitBody = '';
    try {
      const commitInfo = await gitService.getLastCommit(workspacePath);
      // Split commit message into title (first line) and body (rest)
      const commitLines = commitInfo.message.split('\n');
      lastCommitMessage = commitLines[0].trim();
      // Get the body (everything after the first line)
      if (commitLines.length > 1) {
        lastCommitBody = commitLines.slice(1).join('\n').trim();
      }
    } catch (e) {
      console.log('Could not get last commit message');
    }

    // Generate PR title and description
    // Use provided title, or first line of last commit message, or fallback to task title
    const prTitle = title || lastCommitMessage || (task ? `feat: ${task.title}` : `feat: ${branchInfo.current}`);
    
    // Build PR description including commit body if available
    let prDescription = description;
    if (!prDescription && task) {
      prDescription = `## Summary\n${task.description || 'Task implementation'}`;
      
      // Include commit body if it exists
      if (lastCommitBody) {
        prDescription += `\n\n${lastCommitBody}`;
      }
      
      prDescription += `\n\n## Task Details\n- Task ID: ${task.id}\n- Created by: AI Agent\n- Branch: ${branchInfo.current}\n\n## Changes\nThis PR includes AI-generated code for the task implementation.`;
    } else if (!prDescription) {
      prDescription = `## Summary\nChanges from branch ${branchInfo.current}`;
      
      // Include commit body if it exists
      if (lastCommitBody) {
        prDescription += `\n\n${lastCommitBody}`;
      }
      
      prDescription += `\n\n## Description\n${description || 'Please add a description'}`;
    }

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

      // Update SessionState with PR information
      const sessionState = await prisma.sessionState.findFirst({
        where: {
          projectId,
          userId: session.user.id,
          isActive: true
        }
      });

      if (sessionState) {
        await prisma.sessionState.update({
          where: { id: sessionState.id },
          data: {
            prCreated: true,
            prUrl: pr.html_url,
            prNumber: pr.number,
            prTitle: pr.title,
            prCreatedAt: new Date()
          }
        });
      }

      // Step 3: Update task(s) with PR info
      // If a specific task is provided, update only that task
      // Otherwise, update ALL tasks in review status (they were committed together)
      console.log(`[PR Creation] Updating tasks with PR #${pr.number}`);
      
      if (task) {
        // Single task update (legacy behavior)
        console.log(`[PR Creation] Updating single task ${taskId} with PR #${pr.number}`);
        
        // Find the "In Review" column for this project
        const inReviewColumn = await prisma.column.findFirst({
          where: {
            projectId,
            OR: [
              { name: { contains: 'Review' } },
              { name: { contains: 'review' } },
              { name: 'In Review' },
              { name: 'IN REVIEW' },
              { name: 'in review' },
            ]
          }
        });

        await prisma.task.update({
          where: { id: taskId },
          data: {
            githubPrNumber: pr.number,
            githubPrId: pr.node_id,
            githubState: pr.state,
            status: 'inReview',
            columnId: inReviewColumn?.id || task.columnId, // Move to In Review column if found
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
      } else {
        // No specific task - update ALL tasks in review status
        // This handles the case where multiple tasks were committed together
        const tasksInReview = await prisma.task.findMany({
          where: {
            projectId,
            status: 'inReview'
          }
        });
        
        console.log(`[PR Creation] Found ${tasksInReview.length} tasks in review to associate with PR #${pr.number}`);
        
        if (tasksInReview.length > 0) {
          try {
            // Update all tasks in review with the PR info
            // Use individual updates to avoid unique constraint issues with legacy data
            let updateCount = 0;
            let failedUpdates = 0;
            
            for (const task of tasksInReview) {
              try {
                await prisma.task.update({
                  where: { id: task.id },
                  data: {
                    githubPrNumber: pr.number,
                    githubPrId: pr.node_id,
                    githubState: pr.state
                  }
                });
                updateCount++;
                
                // Log activity for this task
                await prisma.activity.create({
                  data: {
                    taskId: task.id,
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
                }).catch(err => {
                  console.log(`[PR Creation] Failed to log activity for task ${task.id}:`, err.message);
                });
              } catch (updateError: any) {
                console.log(`[PR Creation] Failed to update task ${task.id}:`, updateError.message);
                failedUpdates++;
                // Continue with other tasks even if one fails
              }
            }
            
            console.log(`[PR Creation] Successfully updated ${updateCount}/${tasksInReview.length} tasks with PR #${pr.number}`);
            if (failedUpdates > 0) {
              console.log(`[PR Creation] Warning: ${failedUpdates} task updates failed (possibly due to legacy unique constraints)`);
            }
          } catch (error: any) {
            console.error('[PR Creation] Error updating tasks with PR info:', error);
            // Don't fail the entire PR creation - the PR was already created successfully
            console.log('[PR Creation] Continuing despite task update errors - PR was created successfully');
          }
        } else {
          console.log('[PR Creation] Warning: No tasks in review status to associate with PR');
        }
      }

      // Update session state with PR information
      await prisma.sessionState.update({
        where: { id: sessionState.id },
        data: {
          prNumber: pr.number,
          prUrl: pr.html_url,
          prTitle: pr.title,
          prCreated: true
        }
      });
      console.log(`[PR Creation] Updated session state with PR #${pr.number}`);

      // Always return success if PR was created, even if task updates had issues
      return NextResponse.json({
        success: true,
        pullRequest: {
          number: pr.number,
          url: pr.html_url,
          state: pr.state,
          title: pr.title,
          branch: branchInfo.current,
        },
        message: 'Pull request created successfully'
      });

    } catch (prError: any) {
      console.error('[PR Creation] GitHub API error:', prError);
      
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
    console.error('[PR Creation] Unexpected error:', error);
    return NextResponse.json({
      error: 'Failed to create pull request',
      details: error.message
    }, { status: 500 });
  }
}