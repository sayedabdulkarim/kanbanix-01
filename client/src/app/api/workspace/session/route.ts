import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

// Get workspace path for a project
function getWorkspacePath(projectId: string): string {
  return path.join(process.cwd(), 'projects', projectId);
}

// GET /api/workspace/session - Get current session state
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = request.nextUrl.searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID required' }, { status: 400 });
    }

    // Get active session state
    const sessionState = await prisma.sessionState.findFirst({
      where: {
        projectId,
        userId: session.user.id,
        isActive: true
      }
    });

    if (!sessionState) {
      return NextResponse.json({ 
        exists: false,
        message: 'No active session'
      });
    }

    // Check current git status for uncommitted changes
    const workspacePath = getWorkspacePath(projectId);
    let hasUncommittedChanges = false;
    
    try {
      const { stdout } = await execAsync('git status --porcelain', { 
        cwd: workspacePath 
      });
      hasUncommittedChanges = stdout.trim().length > 0;

      // Update if changed
      if (hasUncommittedChanges !== sessionState.hasUncommittedChanges) {
        await prisma.sessionState.update({
          where: { id: sessionState.id },
          data: { hasUncommittedChanges }
        });
      }
    } catch (error) {
      console.error('Error checking git status:', error);
    }

    // Get tasks in review
    const tasksInReview = await prisma.task.findMany({
      where: {
        projectId,
        status: 'inReview'
      },
      select: {
        id: true,
        title: true
      }
    });

    return NextResponse.json({
      exists: true,
      sessionState: {
        ...sessionState,
        hasUncommittedChanges
      },
      tasksInReview,
      buttonStates: {
        commitAll: {
          enabled: tasksInReview.length > 0 && hasUncommittedChanges,
          reason: tasksInReview.length === 0 
            ? 'No tasks in review' 
            : !hasUncommittedChanges 
              ? 'No uncommitted changes' 
              : 'Ready to commit'
        },
        createPR: {
          enabled: !hasUncommittedChanges && !sessionState.prCreated && sessionState.totalCommitsInSession > 0,
          reason: hasUncommittedChanges 
            ? 'Uncommitted changes exist' 
            : sessionState.prCreated 
              ? 'PR already created' 
              : sessionState.totalCommitsInSession === 0
                ? 'No commits in session'
                : 'Ready to create PR'
        }
      }
    });
  } catch (error: any) {
    console.error('Session state error:', error);
    return NextResponse.json({
      error: 'Failed to get session state',
      details: error.message
    }, { status: 500 });
  }
}

// POST /api/workspace/session - Create or update session state
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, sessionBranch, workspacePath } = body;

    if (!projectId || !sessionBranch) {
      return NextResponse.json({ 
        error: 'Project ID and session branch required' 
      }, { status: 400 });
    }

    // Deactivate any existing active sessions for this project/user
    await prisma.sessionState.updateMany({
      where: {
        projectId,
        userId: session.user.id,
        isActive: true
      },
      data: {
        isActive: false
      }
    });

    // Create new session state
    const sessionState = await prisma.sessionState.create({
      data: {
        projectId,
        userId: session.user.id,
        sessionBranch,
        workspacePath: workspacePath || getWorkspacePath(projectId),
        isActive: true,
        hasUncommittedChanges: false
      }
    });

    return NextResponse.json({
      success: true,
      sessionState
    });
  } catch (error: any) {
    console.error('Create session state error:', error);
    return NextResponse.json({
      error: 'Failed to create session state',
      details: error.message
    }, { status: 500 });
  }
}

// PATCH /api/workspace/session - Update session state
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { projectId, updates } = body;

    if (!projectId) {
      return NextResponse.json({ 
        error: 'Project ID required' 
      }, { status: 400 });
    }

    // Find active session
    const sessionState = await prisma.sessionState.findFirst({
      where: {
        projectId,
        userId: session.user.id,
        isActive: true
      }
    });

    if (!sessionState) {
      return NextResponse.json({ 
        error: 'No active session found' 
      }, { status: 404 });
    }

    // Update session state
    const updatedSession = await prisma.sessionState.update({
      where: { id: sessionState.id },
      data: updates
    });

    return NextResponse.json({
      success: true,
      sessionState: updatedSession
    });
  } catch (error: any) {
    console.error('Update session state error:', error);
    return NextResponse.json({
      error: 'Failed to update session state',
      details: error.message
    }, { status: 500 });
  }
}