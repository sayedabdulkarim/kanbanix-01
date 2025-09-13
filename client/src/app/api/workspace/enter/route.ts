import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import gitService from '@/lib/services/gitService';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

// Workspace configuration
const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), 'projects'),
  maxSize: 500 * 1024 * 1024, // 500MB max
  timeout: 30 * 60 * 1000,    // 30 min max session
};

// Simple in-memory lock to prevent concurrent operations on same project
const workspaceLocks = new Map<string, boolean>();

export async function POST(request: NextRequest) {
  console.log('=== WORKSPACE ENTER ROUTE CALLED ===');
  let projectId: string | undefined;
  
  try {
    // Get session
    const session = await getServerSession(authOptions);
    console.log('Auth session found:', !!session);
    if (!session?.user?.id || !session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get project ID and optional task info from request
    const body = await request.json();
    projectId = body.projectId;
    const { taskId, taskTitle } = body;
    
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    // Check if there's already an operation in progress for this project
    if (workspaceLocks.get(projectId)) {
      console.log(`Workspace operation already in progress for project ${projectId}, waiting...`);
      // Wait a bit and check if it's still locked
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (workspaceLocks.get(projectId)) {
        return NextResponse.json({ 
          error: 'Another workspace operation is in progress for this project',
          retry: true 
        }, { status: 429 });
      }
    }

    // Set lock
    workspaceLocks.set(projectId, true);

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

    // Ensure GitHub repo details exist
    if (!project.githubOwner || !project.githubRepo) {
      return NextResponse.json({ 
        error: 'Project not connected to GitHub repository' 
      }, { status: 400 });
    }

    // Create workspace path
    const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);
    let workspaceHandled = false; // Track if we've already handled the workspace setup

    // Check if workspace already exists
    let workspaceExists = false;
    try {
      await fs.access(workspacePath);
      workspaceExists = true;
    } catch {
      workspaceExists = false;
    }

    if (workspaceExists) {
      console.log(`Workspace already exists at ${workspacePath}, checking if it's a valid git repo`);
      
      // Check if it's a valid git repository
      let isValidRepo = false;
      try {
        await execAsync('git status', { cwd: workspacePath });
        isValidRepo = true;
      } catch (gitError: any) {
        console.log('Git status check failed:', gitError.message);
        isValidRepo = false;
      }

      if (isValidRepo) {
        // If it's a valid repo, check for InReview tasks with saved diffs BEFORE resetting
        console.log('Valid git repo found, checking for saved diffs before pulling changes');
        
        // Check for InReview tasks with saved diffs
        const inReviewTasks = await prisma.task.findMany({
          where: {
            projectId,
            status: 'inReview',
            diffs: { not: null }
          }
        });

        if (inReviewTasks.length > 0) {
          console.log(`Found ${inReviewTasks.length} InReview tasks with saved diffs - preserving and restoring files`);
          
          // Don't do a hard reset if we have saved diffs to restore
          try {
            await execAsync('git fetch origin', { cwd: workspacePath });
            
            // Restore files from saved diffs
            for (const task of inReviewTasks) {
              try {
                const diffs = JSON.parse(task.diffs as string);
                console.log(`Restoring files for task: ${task.title}`);
                
                for (const diff of diffs) {
                  if (diff.files && Array.isArray(diff.files)) {
                    for (const file of diff.files) {
                      if (file.fileContent && file.status !== 'deleted') {
                        const filePath = path.join(workspacePath, file.filePath);
                        try {
                          const fileDir = path.dirname(filePath);
                          await fs.mkdir(fileDir, { recursive: true });
                          await fs.writeFile(filePath, file.fileContent, 'utf-8');
                          console.log(`✅ Restored file: ${file.filePath}`);
                        } catch (fileError) {
                          console.error(`Failed to restore file ${file.filePath}:`, fileError);
                        }
                      }
                    }
                  }
                }
              } catch (diffError) {
                console.error(`Error restoring diffs for task ${task.id}:`, diffError);
              }
            }
            
            // Don't return early - continue to session initialization
            console.log('Files restored, continuing to session initialization...');
            workspaceHandled = true; // Mark workspace as handled
          } catch (error) {
            console.error('Error during fetch/restore:', error);
            // Continue with normal flow
          }
        } else {
          // No saved diffs, safe to do hard reset
          try {
            await execAsync('git fetch origin', { cwd: workspacePath });
            await execAsync('git reset --hard origin/main', { cwd: workspacePath });
            await execAsync('git clean -fd', { cwd: workspacePath });

            // Don't return early - continue to session initialization
            console.log('Workspace reset, continuing to session initialization...');
            workspaceHandled = true; // Mark workspace as handled
          } catch (pullError: any) {
            console.log('Failed to pull latest changes, will re-clone:', pullError.message);
            isValidRepo = false;
          }
        }
      }

      if (!isValidRepo) {
        // Not a valid git repo or corrupted, remove and re-clone
        console.log('Invalid or corrupted git repo, removing and re-cloning');
        
        // Force removal of the entire directory
        try {
          // First, try to forcefully remove using system commands
          if (process.platform === 'win32') {
            // Windows
            try {
              await execAsync(`rmdir /s /q "${workspacePath}"`);
            } catch {
              await execAsync(`rd /s /q "${workspacePath}"`);
            }
          } else {
            // Unix/Linux/Mac
            try {
              // Most aggressive removal - ignore errors
              await execAsync(`rm -rf "${workspacePath}" 2>/dev/null || true`);
            } catch (e) {
              console.log('First rm attempt failed, trying alternatives');
            }
            
            // Check if it still exists
            try {
              await fs.access(workspacePath);
              // If we're here, it still exists, try more methods
              
              // Try to remove .git first to unlock files
              try {
                await execAsync(`find "${workspacePath}" -name ".git" -type d -exec rm -rf {} + 2>/dev/null || true`);
              } catch {}
              
              // Try again with the directory
              try {
                await execAsync(`rm -rf "${workspacePath}"`);
              } catch {}
            } catch {
              // Directory doesn't exist anymore, good!
            }
          }
        } catch (rmError) {
          console.error('System command removal failed:', rmError);
        }

        // Double-check with Node.js fs if directory still exists
        try {
          await fs.access(workspacePath);
          // Still exists, try Node.js removal
          console.log('Directory still exists, trying Node.js fs.rm');
          await fs.rm(workspacePath, { 
            recursive: true, 
            force: true, 
            maxRetries: 10,
            retryDelay: 200
          });
        } catch (accessError) {
          // Good, directory doesn't exist or was removed
          console.log('Directory successfully removed or doesn\'t exist');
        }

        // Final check - if it STILL exists, rename it
        try {
          await fs.access(workspacePath);
          // Still there! Rename it as last resort
          const backupPath = `${workspacePath}_corrupted_${Date.now()}`;
          await fs.rename(workspacePath, backupPath);
          console.log(`Renamed stubborn directory to ${backupPath}`);
        } catch {
          // Good, it's finally gone or renamed
        }
      }
    } else {
      console.log(`Creating new workspace at ${workspacePath}`);
    }

    // Only clone if we haven't already handled the workspace
    if (!workspaceHandled) {
      // Ensure base workspace directory exists
      await fs.mkdir(WORKSPACE_CONFIG.basePath, { recursive: true });

      // Make absolutely sure the directory doesn't exist before cloning
      try {
        await fs.access(workspacePath);
        // If we reach here, directory exists - remove it
        console.log('Directory exists before clone, removing it completely...');
      try {
        if (process.platform === 'win32') {
          await execAsync(`rmdir /s /q "${workspacePath}"`);
        } else {
          await execAsync(`rm -rf "${workspacePath}"`);
        }
      } catch {
        await fs.rm(workspacePath, { recursive: true, force: true, maxRetries: 3 });
      }
      // Wait for filesystem
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch {
      // Directory doesn't exist, good to proceed
    }

    // Clone repository
    const repoUrl = `https://github.com/${project.githubOwner}/${project.githubRepo}.git`;
    
    console.log(`Cloning repository: ${repoUrl}`);
    
    // Clone with authentication token
    const cloneCommand = `git clone https://${session.accessToken}@github.com/${project.githubOwner}/${project.githubRepo}.git "${workspacePath}"`;
    
    try {
      const { stdout, stderr } = await execAsync(cloneCommand, {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0', // Disable git prompts
        }
      });
      
      console.log('Clone output:', stdout);
      if (stderr && !stderr.includes('Cloning into')) {
        console.warn('Clone warnings:', stderr);
      }
    } catch (cloneError: any) {
      console.error('Clone error:', cloneError);
      
      // Check if it's a directory exists error or invalid config error
      if (cloneError.message.includes('already exists') || 
          cloneError.message.includes('invalid config file') ||
          cloneError.message.includes('File exists')) {
        
        console.log('Clone failed due to existing/corrupted directory, force removing and retrying...');
        
        // Force remove the directory
        try {
          // Try system command first
          if (process.platform === 'win32') {
            await execAsync(`rmdir /s /q "${workspacePath}"`);
          } else {
            await execAsync(`rm -rf "${workspacePath}"`);
          }
        } catch {
          // Fallback to Node.js fs.rm
          try {
            await fs.rm(workspacePath, { 
              recursive: true, 
              force: true,
              maxRetries: 5,
              retryDelay: 100
            });
          } catch (rmError) {
            console.error('Could not remove workspace directory:', rmError);
          }
        }
        
        // Wait a bit for filesystem to settle
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Try cloning one more time
        try {
          const { stdout: retryStdout, stderr: retryStderr } = await execAsync(cloneCommand, {
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
            }
          });
          
          console.log('Retry clone successful');
          if (retryStderr && !retryStderr.includes('Cloning into')) {
            console.warn('Retry clone warnings:', retryStderr);
          }
        } catch (retryError: any) {
          console.error('Retry clone also failed:', retryError);
          
          // Last attempt: clean and return error
          try {
            await fs.rm(workspacePath, { recursive: true, force: true });
          } catch {}
          
          // Release lock before returning error
          workspaceLocks.delete(projectId);
          
          return NextResponse.json({
            error: 'Failed to clone repository. The workspace may be corrupted.',
            details: 'Please try again or manually delete: ' + workspacePath
          }, { status: 500 });
        }
      } else {
        // Some other clone error (e.g., auth, network, etc.)
        // Release lock before returning error
        workspaceLocks.delete(projectId);
        
        return NextResponse.json({
          error: 'Failed to clone repository',
          details: cloneError.message
        }, { status: 500 });
      }
    }
    } // End of if (!workspaceHandled)

    // Configure git user for the workspace
    try {
      await execAsync(`git config user.name "Kanbanix AI"`, { cwd: workspacePath });
      await execAsync(`git config user.email "ai@kanbanix.app"`, { cwd: workspacePath });
    } catch (configError) {
      console.warn('Git config warning:', configError);
    }

    // V2: Create or use session branch instead of task-specific branches
    let branchName = 'main';
    try {
      branchName = await gitService.createOrGetSessionBranch(workspacePath, projectId);
      console.log(`Using session branch: ${branchName}`);
    } catch (branchError) {
      console.error('Error creating/getting session branch:', branchError);
      // Continue on main branch if session branch creation fails
      console.log('Falling back to main branch');
    }

    // Get current branch info
    const branchInfo = await gitService.getBranchInfo(workspacePath);

    // RESTORE FILES FROM SAVED DIFFS FOR INREVIEW TASKS
    try {
      console.log('Checking for InReview tasks with saved diffs to restore...');
      const inReviewTasks = await prisma.task.findMany({
        where: {
          projectId,
          status: 'inReview',
          diffs: { not: null }
        }
      });

      if (inReviewTasks.length > 0) {
        console.log(`Found ${inReviewTasks.length} InReview tasks with saved diffs`);
        
        for (const task of inReviewTasks) {
          try {
            const diffs = JSON.parse(task.diffs as string);
            console.log(`Restoring files for task: ${task.title} (${diffs.length} diff versions)`);
            
            // Process each diff version (usually just one, but could have multiple)
            for (const diff of diffs) {
              if (diff.files && Array.isArray(diff.files)) {
                for (const file of diff.files) {
                  // Only restore files that have content and aren't deleted
                  if (file.fileContent && file.status !== 'deleted') {
                    const filePath = path.join(workspacePath, file.filePath);
                    
                    try {
                      // Ensure directory exists
                      const fileDir = path.dirname(filePath);
                      await fs.mkdir(fileDir, { recursive: true });
                      
                      // Write file content
                      await fs.writeFile(filePath, file.fileContent, 'utf-8');
                      console.log(`✅ Restored file: ${file.filePath}`);
                    } catch (fileError) {
                      console.error(`Failed to restore file ${file.filePath}:`, fileError);
                    }
                  }
                }
              }
            }
            
            console.log(`Restored files for task: ${task.title}`);
          } catch (diffError) {
            console.error(`Error restoring diffs for task ${task.id}:`, diffError);
          }
        }
        
        console.log('File restoration from saved diffs completed');
      } else {
        console.log('No InReview tasks with saved diffs found');
      }
    } catch (restoreError) {
      console.error('Error restoring files from saved diffs:', restoreError);
      // Don't fail the workspace enter if restoration fails
    }

    // Check for existing PRs from tasks in this project
    let existingPR = null;
    try {
      // Find any task with a PR in this project
      const taskWithPR = await prisma.task.findFirst({
        where: {
          projectId,
          githubPrNumber: { not: null },
          status: 'inReview'
        },
        orderBy: {
          updatedAt: 'desc'
        }
      });

      if (taskWithPR && taskWithPR.githubPrNumber && session.accessToken) {
        // Check if PR still exists on GitHub
        try {
          const octokit = new Octokit({
            auth: session.accessToken,
          });

          const { data: pr } = await octokit.pulls.get({
            owner: project.githubOwner,
            repo: project.githubRepo,
            pull_number: taskWithPR.githubPrNumber,
          });

          if (pr && pr.state === 'open') {
            existingPR = {
              number: pr.number,
              url: pr.html_url,
              title: pr.title,
              branch: pr.head.ref,
              state: pr.state
            };
            console.log('Found existing open PR:', existingPR);
            
            // Switch to the PR branch if it exists locally or remotely
            try {
              // First fetch all branches
              await execAsync('git fetch origin', { cwd: workspacePath });
              
              // Check if branch exists remotely
              const { stdout: remoteBranches } = await execAsync(
                `git branch -r | grep -w "origin/${pr.head.ref}" || true`,
                { cwd: workspacePath }
              );
              
              if (remoteBranches.trim()) {
                // Branch exists remotely, checkout
                await execAsync(`git checkout -B ${pr.head.ref} origin/${pr.head.ref}`, {
                  cwd: workspacePath
                });
                branchName = pr.head.ref;
                console.log(`Switched to existing PR branch: ${branchName}`);
              }
            } catch (branchError) {
              console.warn('Could not switch to PR branch:', branchError);
            }
          } else if (pr && pr.state === 'closed' && pr.merged) {
            // PR was merged, update task status to done
            const doneColumn = await prisma.column.findFirst({
              where: {
                projectId,
                OR: [
                  { name: { contains: 'Done' } },
                  { name: { contains: 'done' } },
                  { name: { contains: 'Complete' } }
                ]
              }
            });

            if (doneColumn) {
              await prisma.task.update({
                where: { id: taskWithPR.id },
                data: {
                  status: 'done',
                  columnId: doneColumn.id,
                  githubState: 'merged'
                }
              });
              console.log('Updated merged task to done status');
            }
          }
        } catch (prCheckError) {
          console.warn('Could not check PR status on GitHub:', prCheckError);
        }
      }
    } catch (prSearchError) {
      console.error('Error searching for existing PRs:', prSearchError);
    }

    console.log('=== ABOUT TO INITIALIZE SESSION STATE ===');
    console.log('Project ID:', projectId);
    console.log('User ID:', session.user.id);
    
    // Initialize or update SessionState
    console.log('Starting SessionState initialization for project:', projectId);
    try {
      // First, find any existing active session
      const existingSession = await prisma.sessionState.findFirst({
        where: {
          projectId,
          userId: session.user.id,
          isActive: true
        }
      });
      console.log('Existing session found:', existingSession ? 'Yes' : 'No');

      // Count actual commits ahead of origin/main
      let actualCommitsAhead = 0;
      try {
        // First fetch from origin to ensure we have latest remote state
        try {
          await execAsync('git fetch origin', { cwd: workspacePath });
        } catch (fetchError) {
          console.log('Could not fetch from origin:', fetchError);
        }
        
        // Try to count commits ahead of origin/main
        try {
          const { stdout: aheadOutput } = await execAsync(
            'git rev-list --count origin/main..HEAD',
            { cwd: workspacePath }
          );
          actualCommitsAhead = parseInt(aheadOutput.trim()) || 0;
        } catch (error) {
          // If origin/main doesn't exist, count all commits in current branch
          console.log('origin/main not found, counting all commits in branch');
          try {
            const { stdout: commitCount } = await execAsync(
              'git rev-list --count HEAD',
              { cwd: workspacePath }
            );
            const totalCommits = parseInt(commitCount.trim()) || 0;
            // Subtract the initial commit to get actual work commits
            actualCommitsAhead = Math.max(0, totalCommits - 1);
          } catch (countError) {
            console.log('Could not count commits:', countError);
          }
        }
        console.log(`Session branch has ${actualCommitsAhead} commits ahead of origin/main`);
        console.log('Session will be created/updated with totalCommitsInSession:', actualCommitsAhead);
      } catch (error) {
        console.error('Error counting commits:', error);
      }

      // Check for uncommitted changes
      let hasUncommittedChanges = false;
      try {
        const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: workspacePath });
        hasUncommittedChanges = statusOutput.trim().length > 0;
      } catch (statusError) {
        console.log('Could not check git status:', statusError);
      }

      const sessionData = {
        sessionBranch: branchName,
        baseBranch: 'main',
        workspacePath,
        hasUncommittedChanges,
        totalCommitsInSession: actualCommitsAhead, // Set the actual commit count
        // Restore PR info if found
        prCreated: existingPR ? true : false,
        prUrl: existingPR?.url || null,
        prNumber: existingPR?.number || null,
        prTitle: existingPR?.title || null,
        updatedAt: new Date()
      };

      if (existingSession) {
        // Update existing session with new branch info
        await prisma.sessionState.update({
          where: { id: existingSession.id },
          data: sessionData
        });
        console.log(`SessionState updated for project: ${projectId}, commits: ${actualCommitsAhead}`);
      } else {
        // Create new SessionState for this session
        await prisma.sessionState.create({
          data: {
            projectId,
            userId: session.user.id,
            ...sessionData,
            isActive: true
          }
        });
        console.log(`SessionState created for project: ${projectId}, commits: ${actualCommitsAhead}`);
      }
    } catch (sessionError: any) {
      console.error('Error initializing SessionState:', sessionError);
      console.error('SessionState error details:', {
        error: sessionError.message,
        code: sessionError.code,
        projectId,
        userId: session.user.id,
        branchName,
        actualCommitsAhead
      });
      // Don't fail the workspace enter if session state fails - but log it prominently
      console.error('⚠️ WARNING: SessionState not created/updated - PR button will not work!');
    }

    // Scan project context for incremental generation (Phase 1)
    try {
      console.log('[Context] Scanning project structure for context...');
      const scanResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/workspace/scan-context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': request.headers.get('cookie') || ''
        },
        body: JSON.stringify({ projectId })
      });
      
      if (scanResponse.ok) {
        const scanResult = await scanResponse.json();
        console.log(`[Context] Project scanned: ${scanResult.structure?.projectType || 'unknown'} type detected`);
      }
    } catch (scanError) {
      console.log('[Context] Could not scan project context:', scanError);
      // Don't fail workspace enter if context scan fails
    }

    // Release lock on success
    workspaceLocks.delete(projectId);

    return NextResponse.json({
      success: true,
      workspacePath,
      message: 'Workspace created successfully',
      project: {
        id: project.id,
        name: project.name,
        githubOwner: project.githubOwner,
        githubRepo: project.githubRepo,
        defaultBranch: 'main'
      },
      git: {
        branch: branchInfo.current,
        branches: branchInfo.all,
        hasUncommittedChanges: branchInfo.hasUncommittedChanges
      }
    });

  } catch (error: any) {
    console.error('Workspace enter error:', error);
    
    // Release lock on error
    if (projectId) {
      workspaceLocks.delete(projectId);
    }
    
    return NextResponse.json({
      error: 'Failed to create workspace',
      details: error.message
    }, { status: 500 });
  }
}