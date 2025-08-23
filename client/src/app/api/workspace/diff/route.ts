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
    
    // V2 Phase 3: If taskId is provided, get task-specific diff from filesChanged
    if (taskId) {
      try {
        // First try to get the latest execution for this task
        const execution = await prisma.agentExecution.findFirst({
          where: { 
            taskId: taskId,
            status: { in: ['completed', 'running'] }
          },
          orderBy: { createdAt: 'desc' }
        });
        
        // If we have an execution with filesChanged, show diff for those files
        if (execution && execution.filesChanged) {
          try {
            const filesChanged = JSON.parse(execution.filesChanged);
            console.log(`[DIFF] Task ${taskId} has filesChanged:`, filesChanged);
            
            // Get diff for the specific files changed by this task
            // This will show the current uncommitted changes for these files
            let taskDiff = '';
            let fileDetails = [];
            
            for (const file of filesChanged) {
              console.log(`[DIFF] Getting diff for file: ${file}`);
              const fileDiff = await gitService.getDiffForFile(workspacePath, file);
              
              if (fileDiff) {
                console.log(`[DIFF] Found diff for ${file}: ${fileDiff.length} chars`);
                taskDiff += fileDiff + '\n';
                fileDetails.push({ file, diffLength: fileDiff.length });
              } else {
                console.log(`[DIFF] No diff found for ${file} - file may be new/untracked`);
                // For new files, we need to show them differently
                // Check if file exists but is untracked
                const fs = require('fs').promises;
                const filePath = path.join(workspacePath, file.startsWith('/') ? file.substring(1) : file);
                
                try {
                  await fs.access(filePath);
                  // File exists, might be untracked - add it to git index to see diff
                  const { exec } = require('child_process');
                  const { promisify } = require('util');
                  const execAsync = promisify(exec);
                  
                  // Add file to index temporarily to get diff
                  await execAsync(`git add -N "${file.startsWith('/') ? file.substring(1) : file}"`, { cwd: workspacePath });
                  
                  // Now try to get diff again
                  const newFileDiff = await gitService.getDiffForFile(workspacePath, file);
                  if (newFileDiff) {
                    console.log(`[DIFF] Got diff for new file ${file}: ${newFileDiff.length} chars`);
                    taskDiff += newFileDiff + '\n';
                    fileDetails.push({ file, diffLength: newFileDiff.length, isNew: true });
                  }
                } catch (e) {
                  console.log(`[DIFF] File ${file} doesn't exist or can't be accessed`);
                }
              }
            }
            
            console.log(`[DIFF] Total diff length: ${taskDiff.length}, files with diffs: ${fileDetails.length}`);
            
            if (taskDiff) {
              const structuredDiff = parseDiff(taskDiff);
              console.log(`[DIFF] Parsed ${structuredDiff.length} files from diff`);
              
              return NextResponse.json({
                success: true,
                taskId,
                filesChanged,
                fileDetails,
                diff: taskDiff,
                structuredDiff,
                isTaskSpecific: true,
                isUncommitted: true
              });
            } else {
              console.log(`[DIFF] No diffs found for any files`);
            }
          } catch (error) {
            console.log('Error getting diff for task files:', error);
          }
        }
        
        // Fallback: If no filesChanged, try to get all uncommitted changes
        // This handles the case where task executed but filesChanged wasn't stored
        const uncommittedDiff = await gitService.getDiff(workspacePath, filePath);
        
        if (uncommittedDiff) {
          const structuredDiff = parseDiff(uncommittedDiff);
          
          return NextResponse.json({
            success: true,
            taskId,
            diff: uncommittedDiff,
            structuredDiff,
            isTaskSpecific: false,
            isUncommitted: true
          });
        } else {
          // No changes to show
          return NextResponse.json({
            success: true,
            taskId,
            diff: '',
            structuredDiff: [],
            isTaskSpecific: true,
            isUncommitted: true,
            message: 'No uncommitted changes for this task'
          });
        }
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