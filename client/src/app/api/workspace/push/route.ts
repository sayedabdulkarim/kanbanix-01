import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

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

    const { projectId, branch } = await request.json();
    
    if (!projectId || !branch) {
      return NextResponse.json(
        { error: 'Project ID and branch are required' },
        { status: 400 }
      );
    }

    // Get project
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

    try {
      // Set remote URL with token
      const remoteUrl = `https://${session.accessToken}@github.com/${project.githubOwner}/${project.githubRepo}.git`;
      await execAsync(`git remote set-url origin "${remoteUrl}"`, { cwd: workspacePath });
      
      // Push to remote
      console.log(`Pushing branch ${branch} to GitHub...`);
      const { stdout, stderr } = await execAsync(
        `git push origin ${branch}`,
        { cwd: workspacePath }
      );
      
      console.log('Push output:', stdout);
      if (stderr && !stderr.includes('Everything up-to-date')) {
        console.log('Push stderr:', stderr);
      }
      
      // Update session state
      const sessionState = await prisma.sessionState.findFirst({
        where: {
          projectId,
          userId: session.user.id,
          isActive: true
        }
      });
      
      if (sessionState && sessionState.prCreated) {
        // Update the lastCommitAt to match prCreatedAt so button shows "View PR"
        // This indicates all commits have been pushed to the PR
        await prisma.sessionState.update({
          where: { id: sessionState.id },
          data: {
            commitsAfterPR: sessionState.commitsAfterPR + 1,
            lastCommitAt: sessionState.prCreatedAt, // Set to PR creation time to indicate no new commits
            hasUncommittedChanges: false
          }
        });
      }
      
      return NextResponse.json({
        success: true,
        message: 'Changes pushed successfully',
        branch
      });
      
    } catch (gitError: any) {
      console.error('Git push error:', gitError);
      
      if (gitError.message.includes('Everything up-to-date')) {
        return NextResponse.json({
          success: true,
          message: 'No new changes to push',
          branch
        });
      }
      
      return NextResponse.json(
        { error: 'Failed to push changes', details: gitError.message },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Push error:', error);
    return NextResponse.json(
      { error: 'Failed to push changes', details: error.message },
      { status: 500 }
    );
  }
}