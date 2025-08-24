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
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), 'projects'),
};

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

    if (!sessionState || !sessionState.prNumber) {
      return NextResponse.json({ 
        prExists: false,
        message: 'No PR associated with current session' 
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
        pull_number: sessionState.prNumber
      });

      // Check if PR is merged
      if (pr.merged) {
        // Check if we've already processed this merge
        if (sessionState.prMerged) {
          console.log(`PR #${sessionState.prNumber} already processed as merged`);
          return NextResponse.json({
            prExists: true,
            prMerged: true,
            prNumber: sessionState.prNumber,
            message: 'PR already processed as merged',
            alreadyProcessed: true
          });
        }
        
        console.log(`PR #${sessionState.prNumber} has been merged. Resetting session...`);
        
        // Define workspace path for use throughout the reset process
        const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);

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
              completedAt: new Date()
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
              completedAt: new Date()
            }
          });
          console.log(`Updated ${updatedTasks.count} tasks from inReview to done status (without column change)`);
        }

        // 2. Kill any running dev servers before resetting session
        console.log('Killing any running dev servers before session reset...');
        
        // First, try to stop dev server through our API (cleanest approach)
        try {
          const baseUrl = request.url.split('/api/')[0];
          const deleteUrl = `${baseUrl}/api/workspace/dev-server?projectId=${projectId}`;
          
          await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
              'Cookie': request.headers.get('cookie') || ''
            }
          });
          console.log('Stopped dev server via API');
        } catch (apiError) {
          console.error('Error stopping dev server via API:', apiError);
        }
        
        // Then do system-level cleanup as backup
        try {
          // Kill all node processes running on common ports (4001-4010)
          for (let port = 4001; port <= 4010; port++) {
            try {
              await execAsync(`lsof -ti:${port} | xargs kill -9`, { cwd: workspacePath });
              console.log(`Killed process on port ${port}`);
            } catch (e) {
              // Port might not be in use, that's fine
            }
          }
          
          // Also try to kill any npm/node processes in the workspace
          try {
            await execAsync(`pkill -f "npm.*${projectId}"`, { cwd: workspacePath });
          } catch (e) {
            // Process might not exist
          }
          
          try {
            await execAsync(`pkill -f "node.*${projectId}"`, { cwd: workspacePath });
          } catch (e) {
            // Process might not exist
          }
        } catch (killError) {
          console.error('Error killing dev servers:', killError);
          // Continue anyway - processes might already be dead
        }

        // 3. Mark current session as inactive FIRST (before creating new one)
        await prisma.sessionState.update({
          where: { id: sessionState.id },
          data: {
            isActive: false,
            prMerged: true,
            prMergedAt: new Date()
          }
        });
        console.log('Current session marked as inactive');

        // 4. Mark ALL active sessions for this project/user as inactive (cleanup)
        const deactivatedCount = await prisma.sessionState.updateMany({
          where: {
            projectId,
            userId: session.user.id,
            isActive: true
          },
          data: { isActive: false }
        });
        
        if (deactivatedCount.count > 0) {
          console.log(`Deactivated ${deactivatedCount.count} remaining active sessions`);
        }

        // 5. Create new session with fresh branch
        try {
          // Switch back to main and pull latest
          await execAsync('git checkout main', { cwd: workspacePath });
          await execAsync('git pull origin main', { cwd: workspacePath });
          
          // Create new session branch
          const newSessionBranch = gitService.createSessionBranchName(projectId);
          await execAsync(`git checkout -b ${newSessionBranch}`, { cwd: workspacePath });
          
          // Create new session state (now guaranteed no active session exists)
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
              prNumber: null
            }
          });
          
          console.log(`Created new session ${newSession.id} with branch: ${newSessionBranch}`);
        } catch (gitError) {
          console.error('Error creating new session branch:', gitError);
          // Continue anyway - user can manually fix if needed
        }

        return NextResponse.json({
          prExists: true,
          prMerged: true,
          prNumber: sessionState.prNumber,
          message: 'PR was merged. Session has been reset with new branch.',
          newSession: true
        });
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