import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import gitService from '@/lib/services/gitService';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), '..', 'workspace-projects'),
};

// Track ongoing merge processes to prevent duplicates
const ongoingMerges = new Map<string, boolean>();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    // Get project and session state
    const project = await prisma.project.findUnique({
      where: { id: projectId }
    });

    if (!project || !project.githubOwner || !project.githubRepo) {
      return NextResponse.json({ error: 'Project not found or not connected to GitHub' }, { status: 404 });
    }

    const sessionState = await prisma.sessionState.findFirst({
      where: {
        projectId,
        userId: session.user.id,
        isActive: true
      }
    });

    // Also check for PR info in tasks (persistent across sessions)
    let prNumber = sessionState?.prNumber;
    let taskWithPR = null;
    
    console.log(`[PR Status Check] Initial PR number from session: ${prNumber}`);
    
    if (!prNumber) {
      taskWithPR = await prisma.task.findFirst({
        where: {
          projectId,
          githubPrNumber: { not: null },
          status: 'inReview'
        },
        orderBy: {
          updatedAt: 'desc'
        }
      });
      
      console.log(`[PR Status Check] Task with PR found:`, taskWithPR ? `Task ${taskWithPR.id} with PR #${taskWithPR.githubPrNumber}` : 'None');
      
      if (taskWithPR?.githubPrNumber) {
        prNumber = taskWithPR.githubPrNumber;
      }
    }
    
    // Check if PR was already processed (tasks moved to done)
    if (!prNumber && !sessionState?.prNumber) {
      // Also check if there are tasks in done with the same PR that was just merged
      const mergedTask = await prisma.task.findFirst({
        where: {
          projectId,
          githubPrNumber: { not: null },
          status: 'done',
          githubState: 'merged'
        },
        orderBy: {
          updatedAt: 'desc'
        }
      });
      
      if (mergedTask) {
        // PR was already processed, don't re-process
        return NextResponse.json({ 
          prExists: false,
          message: 'PR already processed and merged',
          alreadyProcessed: true
        });
      }
    }

    if (!prNumber) {
      // Log more details for debugging
      const allTasksInReview = await prisma.task.count({
        where: {
          projectId,
          status: 'inReview'
        }
      });
      
      const tasksWithPRInReview = await prisma.task.count({
        where: {
          projectId,
          status: 'inReview',
          githubPrNumber: { not: null }
        }
      });
      
      console.log(`[PR Status Check] No PR found. Tasks in review: ${allTasksInReview}, Tasks with PR: ${tasksWithPRInReview}`);
      
      return NextResponse.json({ 
        prExists: false,
        message: 'No PR associated with current session or tasks',
        debug: {
          sessionHasPR: !!sessionState?.prNumber,
          tasksInReview: allTasksInReview,
          tasksWithPR: tasksWithPRInReview
        }
      });
    }

    // Check PR status using GitHub API
    const octokit = new Octokit({
      auth: session.accessToken
    });

    try {
      const { data: pr } = await octokit.pulls.get({
        owner: project.githubOwner,
        repo: project.githubRepo,
        pull_number: prNumber
      });

      // Check if PR is merged
      if (pr.merged) {
        // Check if we're already processing this merge
        const mergeKey = `${projectId}-${prNumber}`;
        if (ongoingMerges.get(mergeKey)) {
          console.log(`PR #${prNumber} merge already being processed, skipping duplicate`);
          return NextResponse.json({
            prExists: true,
            prMerged: true,
            prNumber: prNumber,
            message: 'PR merge is being processed',
            processing: true
          });
        }
        
        // Check if we've already processed this merge by looking at task status
        const tasksInDone = await prisma.task.findMany({
          where: {
            projectId,
            githubPrNumber: prNumber,
            status: 'done',
            githubState: 'merged'
          }
        });
        
        if (tasksInDone.length > 0 || sessionState?.prMerged) {
          console.log(`PR #${prNumber} already processed as merged (${tasksInDone.length} tasks in done)`);
          return NextResponse.json({
            prExists: true,
            prMerged: true,
            prNumber: prNumber,
            message: 'PR already processed as merged',
            alreadyProcessed: true
          });
        }
        
        // Mark that we're processing this merge
        ongoingMerges.set(mergeKey, true);
        
        console.log(`PR #${prNumber} has been merged. Resetting session...`);
        
        // Define workspace path for use throughout the reset process
        const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);
        
        try {

        // 1. Move all tasks in review to done
        const allColumns = await prisma.column.findMany({
          where: { projectId }
        });
        
        // Find columns with case-insensitive matching
        const inReviewColumn = allColumns.find(col => 
          col.status === 'inReview' || 
          col.name.toLowerCase().includes('review')
        );
        
        const doneColumn = allColumns.find(col => 
          col.status === 'done' || 
          col.name.toLowerCase().includes('done') ||
          col.name.toLowerCase().includes('completed')
        );

        if (inReviewColumn && doneColumn) {
          const result = await prisma.task.updateMany({
            where: {
              projectId,
              columnId: inReviewColumn.id,
              status: 'inReview'
            },
            data: {
              status: 'done',
              columnId: doneColumn.id,
              completedAt: new Date(),
              githubState: 'merged'
            }
          });
          console.log(`Moved ${result.count} tasks from In Review (${inReviewColumn.id}) to Done (${doneColumn.id})`);
        } else {
          console.log('Warning: Could not find columns for task movement');
          console.log('In Review column:', inReviewColumn ? `found (${inReviewColumn.id})` : 'not found');
          console.log('Done column:', doneColumn ? `found (${doneColumn.id})` : 'not found');
          
          // Try alternative approach - update by status directly
          const updatedTasks = await prisma.task.updateMany({
            where: {
              projectId,
              status: 'inReview'
            },
            data: {
              status: 'done',
              completedAt: new Date(),
              githubState: 'merged'
            }
          });
          console.log(`Updated ${updatedTasks.count} tasks from inReview to done status (without column change)`);
        }

        // 2. Keep dev server running - we'll reuse it in the new session
        console.log('Keeping dev server running for continuity...');
        
        // 3. First check if there are any active sessions to deactivate and get dev server info
        const activeSessions = await prisma.sessionState.findMany({
          where: {
            projectId,
            userId: session.user.id,
            isActive: true
          }
        });
        
        // Preserve dev server info from the active session
        let devServerInfo = {
          port: null as number | null,
          url: null as string | null,
          startedAt: null as Date | null
        };
        
        if (activeSessions.length > 0 && activeSessions[0].devServerPort) {
          devServerInfo = {
            port: activeSessions[0].devServerPort,
            url: activeSessions[0].devServerUrl,
            startedAt: activeSessions[0].devServerStartedAt
          };
          console.log(`Preserving dev server info - port: ${devServerInfo.port}`);
        }
        
        if (activeSessions.length > 0) {
          // Use a transaction to ensure atomic updates
          await prisma.$transaction(async (tx) => {
            // Delete all active sessions to avoid unique constraint issues
            await tx.sessionState.deleteMany({
              where: {
                projectId,
                userId: session.user.id,
                isActive: true
              }
            });
            
            console.log(`Deleted ${activeSessions.length} active session(s)`);
          });
        } else {
          console.log('No active sessions to deactivate');
        }
        
        // Add a small delay to ensure database consistency
        await new Promise(resolve => setTimeout(resolve, 100));

        // 5. Create new session with fresh branch
        try {
          // Switch back to main and reset to match remote
          await execAsync('git checkout main', { cwd: workspacePath });
          await execAsync('git fetch origin', { cwd: workspacePath });
          await execAsync('git reset --hard origin/main', { cwd: workspacePath });
          
          // Create new session branch
          const newSessionBranch = gitService.createSessionBranchName(projectId);
          await execAsync(`git checkout -b ${newSessionBranch}`, { cwd: workspacePath });
          
          // Create new session state (now guaranteed no active session exists)
          try {
            const newSession = await prisma.sessionState.create({
              data: {
                projectId,
                userId: session.user.id,
                sessionBranch: newSessionBranch,
                baseBranch: 'main',
                workspacePath,
                isActive: true,
                hasUncommittedChanges: false,
                totalCommitsInSession: 0,
                prCreated: false,
                prUrl: null,
                prNumber: null,
                // Preserve dev server info from previous session
                devServerPort: devServerInfo.port,
                devServerUrl: devServerInfo.url,
                devServerStartedAt: devServerInfo.startedAt
              }
            });
            
            console.log(`Created new session ${newSession.id} with branch: ${newSessionBranch}`);
          } catch (createError: any) {
            // If creation fails due to unique constraint, try to clean up and retry
            if (createError.code === 'P2002') {
              console.log('Unique constraint error, cleaning up and retrying...');
              
              // Ensure all sessions are inactive
              await prisma.sessionState.updateMany({
                where: {
                  projectId,
                  userId: session.user.id,
                  isActive: true
                },
                data: { isActive: false }
              });
              
              // Wait a bit more
              await new Promise(resolve => setTimeout(resolve, 200));
              
              // Try one more time
              const newSession = await prisma.sessionState.create({
                data: {
                  projectId,
                  userId: session.user.id,
                  sessionBranch: newSessionBranch,
                  baseBranch: 'main',
                  workspacePath,
                  isActive: true,
                  hasUncommittedChanges: false,
                  totalCommitsInSession: 0,
                  prCreated: false,
                  prUrl: null,
                  prNumber: null,
                  // Preserve dev server info from previous session
                  devServerPort: devServerInfo.port,
                  devServerUrl: devServerInfo.url,
                  devServerStartedAt: devServerInfo.startedAt
                }
              });
              
              console.log(`Created new session ${newSession.id} with branch: ${newSessionBranch} (on retry)`);
            } else {
              throw createError;
            }
          }
        } catch (gitError) {
          console.error('Error creating new session branch:', gitError);
          // Continue anyway - user can manually fix if needed
        }
        
        // If we got here, the merge was processed successfully
        // Clear the ongoing merge flag
        ongoingMerges.delete(mergeKey);
        
        return NextResponse.json({
          prExists: true,
          prMerged: true,
          prNumber: prNumber,
          message: 'PR was merged. Session has been reset with new branch.',
          newSession: true
        });
        
        } catch (mergeError: any) {
          console.error('Error processing PR merge:', mergeError);
          
          // Clear the ongoing merge flag
          const mergeKey = `${projectId}-${prNumber}`;
          ongoingMerges.delete(mergeKey);
          
          // Still return success but indicate there was an issue
          // This prevents the UI from breaking
          return NextResponse.json({
            prExists: true,
            prMerged: true,
            prNumber: prNumber,
            message: 'PR was merged but there was an issue resetting the session. Please refresh the page.',
            warning: true,
            error: mergeError.message
          });
        }
      }

      // PR exists but not merged
      return NextResponse.json({
        prExists: true,
        prMerged: false,
        prState: pr.state,
        prNumber: pr.number,
        prUrl: pr.html_url,
        message: `PR #${pr.number} is ${pr.state}`
      });

    } catch (githubError: any) {
      if (githubError.status === 404) {
        // PR doesn't exist or was deleted
        console.log('PR not found, resetting session state');
        
        await prisma.sessionState.update({
          where: { id: sessionState.id },
          data: {
            prCreated: false,
            prUrl: null,
            prNumber: null,
            prTitle: null,
            prCreatedAt: null
          }
        });

        return NextResponse.json({
          prExists: false,
          message: 'PR not found or was deleted. Session state reset.'
        });
      }
      
      throw githubError;
    }

  } catch (error: any) {
    console.error('Check PR status error:', error);
    return NextResponse.json({
      error: 'Failed to check PR status',
      details: error.message
    }, { status: 500 });
  }
}