import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

const WORKSPACE_CONFIG = {
  basePath: process.env.WORKSPACE_PATH || path.join(process.cwd(), '..', 'workspace-projects'),
};

export async function GET(request: NextRequest) {
  try {
    // Get session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const filePath = searchParams.get('path');
    
    if (!projectId || !filePath) {
      return NextResponse.json({ 
        error: 'Project ID and file path required' 
      }, { status: 400 });
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

    // Get workspace path
    const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);
    const fullFilePath = path.join(workspacePath, filePath);
    
    // Security: Ensure the file path is within the workspace
    const resolvedPath = path.resolve(fullFilePath);
    const resolvedWorkspace = path.resolve(workspacePath);
    
    if (!resolvedPath.startsWith(resolvedWorkspace)) {
      return NextResponse.json({ 
        error: 'Invalid file path' 
      }, { status: 403 });
    }
    
    // Check if file exists
    let content: string;
    let fromSavedDiff = false;
    
    try {
      await fs.access(fullFilePath);
      // File exists, read it
      content = await fs.readFile(fullFilePath, 'utf-8');
    } catch {
      // File doesn't exist, check if we have it in saved diffs
      console.log(`File ${filePath} not found in workspace, checking saved diffs...`);
      
      // Find InReview tasks with saved diffs that might contain this file
      const tasksWithDiffs = await prisma.task.findMany({
        where: {
          projectId,
          status: 'inReview',
          diffs: { not: null }
        }
      });
      
      let fileFound = false;
      for (const task of tasksWithDiffs) {
        if (fileFound) break;
        
        try {
          const diffs = JSON.parse(task.diffs as string);
          
          for (const diff of diffs) {
            if (diff.files && Array.isArray(diff.files)) {
              for (const file of diff.files) {
                if (file.filePath === filePath && file.fileContent) {
                  content = file.fileContent;
                  fromSavedDiff = true;
                  fileFound = true;
                  console.log(`Found file ${filePath} in saved diffs for task: ${task.title}`);
                  break;
                }
              }
            }
            if (fileFound) break;
          }
        } catch (error) {
          console.error(`Error parsing diffs for task ${task.id}:`, error);
        }
      }
      
      if (!fileFound) {
        return NextResponse.json({ 
          error: 'File not found in workspace or saved diffs' 
        }, { status: 404 });
      }
    }
    
    return NextResponse.json({
      success: true,
      path: filePath,
      content,
      size: content.length,
      fromSavedDiff
    });

  } catch (error: any) {
    console.error('Error reading file:', error);
    return NextResponse.json({
      error: 'Failed to read file',
      details: error.message
    }, { status: 500 });
  }
}