import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import gitService from '@/lib/services/gitService';

const prisma = new PrismaClient();

const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), 'projects'),
};

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const filePath = searchParams.get('file');
    const taskId = searchParams.get('taskId'); // V2: Support task-specific diffs
    
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    // Verify project ownership
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);
    
    // V2: If taskId is provided, get task-specific diff
    if (taskId) {
      try {
        // Get the task's execution to find its commit SHA
        // Get ALL executions and find the first one with a valid commit
        const executions = await prisma.agentExecution.findMany({
          where: { 
            taskId: taskId,
            commitSha: { not: null }
          },
          orderBy: { createdAt: 'desc' }
        });
        
        // Find the first execution with a commit that exists in the repo
        let execution = null;
        for (const exec of executions) {
          if (exec.commitSha) {
            try {
              // Check if commit exists
              await gitService.getParentCommit(workspacePath, exec.commitSha);
              execution = exec;
              break;
            } catch (e) {
              console.log(`Skipping invalid commit ${exec.commitSha} for execution ${exec.id}`);
            }
          }
        }

        if (execution && execution.commitSha) {
          try {
            // Get the parent commit to diff against
            const parentCommit = await gitService.getParentCommit(workspacePath, execution.commitSha);
            
            if (parentCommit) {
              // Get diff between parent and task commit
              const diff = await gitService.getDiffBetweenCommits(
                workspacePath,
                parentCommit,
                execution.commitSha
              );
              
              const structuredDiff = parseDiff(diff);
              
              return NextResponse.json({
                success: true,
                taskId,
                commitSha: execution.commitSha,
                parentCommit,
                diff,
                structuredDiff,
                isTaskSpecific: true
              });
            }
          } catch (parentError) {
            console.log('Could not get parent commit, trying direct diff for commit:', execution.commitSha);
            
            // If parent commit fails, try to get diff for the specific commit
            try {
              const diff = await gitService.getDiffBetweenCommits(
                workspacePath,
                `${execution.commitSha}~1`,  // Use git's ~ notation for parent
                execution.commitSha
              );
              
              console.log(`Task diff for ${execution.commitSha}: ${diff.length} chars`);
              
              // Log first 500 chars of raw diff to see format
              console.log('Raw diff preview:', diff.substring(0, 500));
              
              // Also get list of changed files to ensure we catch them all
              const changedFiles = await gitService.getChangedFilesInCommit(workspacePath, execution.commitSha);
              console.log(`Changed files in commit: ${changedFiles.join(', ')}`);
              
              const structuredDiff = parseDiff(diff);
              console.log(`Parsed ${structuredDiff.length} files from diff`);
              structuredDiff.forEach(file => {
                console.log(`  - ${file.path}: ${file.hunks.length} hunks`);
              });
              
              return NextResponse.json({
                success: true,
                taskId,
                commitSha: execution.commitSha,
                diff,
                structuredDiff,
                isTaskSpecific: true
              });
            } catch (diffError) {
              console.error('Error getting commit diff:', diffError);
              // Continue to fallback
            }
          }
        }
        
        // Fallback if no commit found for task
        return NextResponse.json({
          success: false,
          error: 'No commit found for this task',
          taskId
        });
      } catch (error) {
        console.error('Error getting task diff:', error);
        // Fallback to regular diff
      }
    }
    
    if (filePath) {
      // Get diff for specific file
      const diff = await gitService.getFileDiff(workspacePath, filePath);
      return NextResponse.json({
        success: true,
        file: filePath,
        diff
      });
    } else {
      // Get all diffs  
      const diff = await gitService.getDiff(workspacePath);
      const changes = await gitService.getUncommittedChanges(workspacePath);
      
      // Parse diff into structured format
      const structuredDiff = parseDiff(diff);
      
      // If no diff yet, try to get diff for untracked files
      if (structuredDiff.length === 0 && changes.length > 0) {
        // For new files, we can't get a diff, but we can show them as added
        const newFileDiffs = changes.map(file => ({
          path: file,
          hunks: [{
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            content: '',
            changes: [{ type: 'add', content: `New file: ${file}` }]
          }]
        }));
        
        return NextResponse.json({
          success: true,
          changes,
          diff,
          structuredDiff: newFileDiffs
        });
      }
      
      return NextResponse.json({
        success: true,
        changes,
        diff,
        structuredDiff
      });
    }

  } catch (error: any) {
    console.error('Error getting diff:', error);
    return NextResponse.json({
      error: 'Failed to get diff',
      details: error.message
    }, { status: 500 });
  }
}

function parseDiff(diff: string): any[] {
  const files: any[] = [];
  const lines = diff.split('\n');
  let currentFile: any = null;
  let currentHunk: any = null;
  
  console.log(`Parsing diff with ${lines.length} lines`);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('diff --git')) {
      // New file - save previous file if exists
      if (currentFile && currentFile.hunks.length > 0) {
        console.log(`Adding file to diff: ${currentFile.path} with ${currentFile.hunks.length} hunks`);
        files.push(currentFile);
      }
      
      // Parse file paths from diff header
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      if (match) {
        currentFile = {
          path: match[2],
          hunks: []
        };
        currentHunk = null;
        console.log(`Starting new file: ${currentFile.path}`);
      }
    } else if (line.startsWith('--- ')) {
      // Old file path (for context, we don't use this)
      continue;
    } else if (line.startsWith('+++ ')) {
      // New file path - update if different
      const match = line.match(/\+\+\+ b\/(.*)/);
      if (match && currentFile) {
        currentFile.path = match[1];
        console.log(`Confirmed file path: ${currentFile.path}`);
      }
    } else if (line.startsWith('@@')) {
      // Hunk header
      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)/);
      if (match && currentFile) {
        currentHunk = {
          oldStart: parseInt(match[1]),
          oldLines: parseInt(match[2] || '1'),
          newStart: parseInt(match[3]),
          newLines: parseInt(match[4] || '1'),
          content: match[5] || '',
          changes: []
        };
        currentFile.hunks.push(currentHunk);
        console.log(`New hunk for ${currentFile.path}: @@ -${currentHunk.oldStart},${currentHunk.oldLines} +${currentHunk.newStart},${currentHunk.newLines} @@`);
      }
    } else if (currentHunk && currentFile) {
      // Diff lines - only process if we have a current hunk
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentHunk.changes.push({ type: 'add', content: line.substring(1) });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentHunk.changes.push({ type: 'remove', content: line.substring(1) });
      } else if (line.startsWith(' ')) {
        currentHunk.changes.push({ type: 'context', content: line.substring(1) });
      } else if (line === '') {
        // Empty lines in diff are context lines
        currentHunk.changes.push({ type: 'context', content: '' });
      }
    }
  }
  
  // Don't forget the last file
  if (currentFile && currentFile.hunks.length > 0) {
    console.log(`Adding final file to diff: ${currentFile.path} with ${currentFile.hunks.length} hunks`);
    files.push(currentFile);
  }
  
  console.log(`Total files parsed: ${files.length}`);
  return files;
}