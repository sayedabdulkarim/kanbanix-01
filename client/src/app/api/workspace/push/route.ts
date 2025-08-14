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

export async function POST(request: NextRequest) {
  try {
    // Get session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get request data
    const { projectId, branch } = await request.json();
    if (!projectId) {
      return NextResponse.json({ 
        error: 'Project ID required' 
      }, { status: 400 });
    }

    // Verify project ownership
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        user: {
          select: {
            accounts: {
              where: { provider: 'github' },
              select: { access_token: true }
            }
          }
        }
      }
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get workspace path
    const workspacePath = path.join(WORKSPACE_CONFIG.basePath, projectId);
    
    // Get current branch if not provided
    const branchInfo = await gitService.getBranchInfo(workspacePath);
    const branchToPush = branch || branchInfo.current;
    
    // Get GitHub access token
    const accessToken = project.user.accounts[0]?.access_token;
    
    // Push to remote
    await gitService.pushBranch(workspacePath, branchToPush, accessToken);
    
    // Log activity
    await prisma.activity.create({
      data: {
        projectId,
        userId: session.user.id,
        action: 'push',
        details: {
          branch: branchToPush,
          timestamp: new Date().toISOString()
        }
      }
    });
    
    return NextResponse.json({
      success: true,
      branch: branchToPush,
      message: `Pushed branch ${branchToPush} to remote`
    });

  } catch (error: any) {
    console.error('Push error:', error);
    return NextResponse.json({
      error: 'Failed to push to remote',
      details: error.message
    }, { status: 500 });
  }
}