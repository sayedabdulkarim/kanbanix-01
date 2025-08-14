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
  
  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      // New file
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      if (match) {
        if (currentFile) {
          files.push(currentFile);
        }
        currentFile = {
          path: match[2],
          hunks: []
        };
        currentHunk = null;
      }
    } else if (line.startsWith('+++')) {
      // File path
      const match = line.match(/\+\+\+ b\/(.*)/);
      if (match && currentFile) {
        currentFile.path = match[1];
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
      }
    } else if (currentHunk) {
      // Diff lines
      if (line.startsWith('+')) {
        currentHunk.changes.push({ type: 'add', content: line.substring(1) });
      } else if (line.startsWith('-')) {
        currentHunk.changes.push({ type: 'remove', content: line.substring(1) });
      } else if (line.startsWith(' ')) {
        currentHunk.changes.push({ type: 'context', content: line.substring(1) });
      }
    }
  }
  
  if (currentFile) {
    files.push(currentFile);
  }
  
  return files;
}