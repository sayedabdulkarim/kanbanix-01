import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { authOptions } from '../../../auth/[...nextauth]/route';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// GET /api/tasks/[taskId]/execution - Get latest execution for a task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId } = await params;
    
    // Get the latest execution for this task
    const execution = await prisma.agentExecution.findFirst({
      where: {
        taskId: taskId,
        task: {
          project: {
            userId: session.user.id
          }
        }
      },
      include: {
        task: {
          select: {
            diffs: true
          }
        },
        logs: {
          orderBy: {
            timestamp: 'asc'
          }
        }
      },
      orderBy: {
        startedAt: 'desc'
      }
    });

    if (!execution) {
      return NextResponse.json({ message: 'No execution found' }, { status: 404 });
    }

    // Parse changes if it's a string
    let changes = execution.changes;
    if (typeof changes === 'string') {
      try {
        changes = JSON.parse(changes);
      } catch (e) {
        console.error('Error parsing changes:', e);
        changes = [];
      }
    }

    // Ensure changes is an array
    if (!Array.isArray(changes)) {
      changes = [];
    }

    // If execution changes are empty, check task diffs
    if (changes.length === 0 && execution.task?.diffs) {
      try {
        const taskDiffs = typeof execution.task.diffs === 'string'
          ? JSON.parse(execution.task.diffs)
          : execution.task.diffs;

        // Task diffs are an array of diff versions, get the latest
        if (Array.isArray(taskDiffs) && taskDiffs.length > 0) {
          const latestDiff = taskDiffs[taskDiffs.length - 1];

          // Convert task diff format to changes format
          if (latestDiff.files && Array.isArray(latestDiff.files)) {
            changes = latestDiff.files.map((file: any) => ({
              path: file.filePath || file.path, // FileDiff uses 'filePath' property
              type: file.status || 'modified',
              additions: file.additions || 0,
              deletions: file.deletions || 0
            }));
            console.log(`Using task diffs: ${changes.length} files from diff version ${latestDiff.version}`);
          }
        }
      } catch (e) {
        console.error('Error parsing task diffs:', e);
      }
    }

    console.log('Execution API - changes count:', changes.length);
    
    // Parse metadata in logs
    const parsedLogs = execution.logs.map((log: any) => ({
      id: log.id,
      level: log.level,
      message: log.message,
      data: log.metadata ? (typeof log.metadata === 'string' ? 
        (() => { try { return JSON.parse(log.metadata); } catch { return null; }})() : 
        log.metadata) : null,
      timestamp: log.timestamp
    }));

    return NextResponse.json({
      id: execution.id,
      taskId: execution.taskId,
      status: execution.status,
      agentType: execution.agentType,
      summary: execution.summary,
      output: execution.output,
      changes: changes,
      error: execution.error,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      logs: parsedLogs
    });
  } catch (error: any) {
    console.error('Error fetching execution:', error);
    return NextResponse.json(
      { error: 'Failed to fetch execution', details: error.message },
      { status: 500 }
    );
  }
}