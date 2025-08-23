import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId, message, taskIds } = await request.json();

    if (!projectId || !message || !taskIds || taskIds.length === 0) {
      return NextResponse.json(
        { error: 'Project ID, message, and task IDs are required' },
        { status: 400 }
      );
    }

    // Get the project workspace path
    const workspacePath = path.join(process.cwd(), 'projects', projectId);

    try {
      // First check if there are any changes to commit
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { 
        cwd: workspacePath 
      });
      
      if (!statusOutput.trim()) {
        return NextResponse.json(
          { error: 'No changes to commit. Tasks may have been auto-committed previously.' },
          { status: 400 }
        );
      }
      
      // Stage all changes
      await execAsync('git add -A', { cwd: workspacePath });
      
      // Commit with the provided message
      const { stdout: commitOutput } = await execAsync(
        `git commit -m "${message.replace(/"/g, '\\"')}"`,
        { cwd: workspacePath }
      );
      
      // Extract commit hash
      const hashMatch = commitOutput.match(/\[[\w-]+\s+([\w]+)\]/);
      const commitHash = hashMatch ? hashMatch[1] : null;
      
      // Update all task executions with commit info
      if (commitHash && taskIds.length > 0) {
        // Get the latest execution for each task
        const executions = await prisma.agentExecution.findMany({
          where: {
            taskId: { in: taskIds },
            status: 'completed'
          },
          orderBy: { createdAt: 'desc' },
          distinct: ['taskId']
        });
        
        // Update each execution with the commit SHA
        await Promise.all(
          executions.map(exec => 
            prisma.agentExecution.update({
              where: { id: exec.id },
              data: { commitSha: commitHash }
            })
          )
        );
      }
      
      // Update SessionState with commit information
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
            hasUncommittedChanges: false,
            lastCommitSha: commitHash,
            lastCommitMessage: message,
            lastCommitAt: new Date(),
            totalCommitsInSession: sessionState.totalCommitsInSession + 1
          }
        });
      }
      
      return NextResponse.json({
        success: true,
        commitHash,
        message: 'All changes committed successfully',
        taskCount: taskIds.length
      });
      
    } catch (gitError: any) {
      console.error('Git commit error:', gitError);
      
      return NextResponse.json(
        { error: 'Failed to commit changes', details: gitError.message },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Commit all error:', error);
    return NextResponse.json(
      { error: 'Failed to commit changes', details: error.message },
      { status: 500 }
    );
  }
}