import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), '..', 'workspace-projects'),
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await request.json();
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);

    console.log(`Syncing git repository for project ${projectId}...`);

    try {
      // Get current branch
      const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { 
        cwd: workspacePath 
      });
      const branch = currentBranch.trim();
      
      console.log(`Current branch: ${branch}`);

      // Fetch latest changes
      await execAsync('git fetch origin', { cwd: workspacePath });

      if (branch === 'main' || branch === 'master') {
        // If on main, just pull latest
        await execAsync('git pull origin main --ff-only', { cwd: workspacePath });
        console.log('Updated main branch with latest changes');
      } else {
        // If on feature branch, merge main into it
        await execAsync('git fetch origin main', { cwd: workspacePath });
        
        // Try to merge main into current branch
        try {
          await execAsync('git merge origin/main --no-edit', { cwd: workspacePath });
          console.log(`Merged main into ${branch}`);
        } catch (mergeError: any) {
          if (mergeError.message.includes('CONFLICT')) {
            console.log('Merge conflicts detected, will need manual resolution');
            return NextResponse.json({
              success: false,
              message: 'Merge conflicts detected. Manual resolution required.',
              hasConflicts: true
            });
          }
          throw mergeError;
        }
      }

      // Get updated status
      const { stdout: status } = await execAsync('git status --short', { cwd: workspacePath });

      return NextResponse.json({
        success: true,
        branch,
        hasChanges: status.trim().length > 0,
        message: 'Repository synced successfully'
      });

    } catch (error: any) {
      console.error('Git sync error:', error);
      return NextResponse.json({
        success: false,
        error: 'Failed to sync repository',
        details: error.message
      });
    }

  } catch (error: any) {
    console.error('Sync error:', error);
    return NextResponse.json({
      error: 'Failed to sync repository',
      details: error.message
    }, { status: 500 });
  }
}