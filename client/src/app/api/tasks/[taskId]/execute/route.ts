// AI Task Execution API - Trigger agents when task moves to "In Progress"
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { AIAgentService, AgentType } from '@/lib/services/aiAgentService';

const prisma = new PrismaClient();

// POST /api/tasks/[taskId]/execute - Execute task with AI agent
export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId } = params;
    const body = await request.json();
    const { agentType, autoTrigger = false } = body;

    // Verify task ownership and get task details
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          userId: session.user.id
        }
      },
      include: {
        project: true,
        column: true
      }
    });

    if (!task) {
      return NextResponse.json({ 
        error: 'Task not found or unauthorized' 
      }, { status: 404 });
    }

    // Update task to enable AI if not already enabled
    if (!task.agentEnabled) {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          agentEnabled: true,
          agentType: agentType || determineAgentType(task.title, task.description || '')
        }
      });
    }

    // Initialize AI Agent Service
    const aiService = new AIAgentService();
    
    // Determine agent type if not provided
    const finalAgentType = agentType || determineAgentType(task.title, task.description || '');

    // Execute the task with AI agent
    const execution = await aiService.executeTask(
      taskId,
      finalAgentType,
      {
        projectPath: process.cwd(),
        autoTrigger,
        userId: session.user.id
      }
    );

    // If auto-triggered from drag operation, update task status
    if (autoTrigger && task.status !== 'inProgress') {
      await prisma.task.update({
        where: { id: taskId },
        data: { 
          status: 'inProgress',
          startedAt: new Date()
        }
      });

      // Create activity log
      await prisma.activity.create({
        data: {
          type: 'ai_execution_started',
          description: `AI agent (${finalAgentType}) started execution`,
          taskId,
          userId: session.user.id,
          metadata: JSON.stringify({
            agentType: finalAgentType,
            executionId: execution.id
          })
        }
      });
    }

    return NextResponse.json({
      success: true,
      execution: {
        id: execution.id,
        status: execution.status,
        agentType: execution.agentType,
        progress: execution.progress,
        currentStep: execution.currentStep
      },
      task: {
        id: task.id,
        status: autoTrigger ? 'inProgress' : task.status,
        agentEnabled: true,
        agentType: finalAgentType
      }
    });

  } catch (error: any) {
    console.error('Task execution error:', error);
    return NextResponse.json({
      error: 'Failed to execute task',
      details: error.message
    }, { status: 500 });
  }
}

// GET /api/tasks/[taskId]/execute - Get execution status and logs
export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId } = params;

    // Verify task ownership
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          userId: session.user.id
        }
      }
    });

    if (!task) {
      return NextResponse.json({ 
        error: 'Task not found or unauthorized' 
      }, { status: 404 });
    }

    // Get executions for this task
    const aiService = new AIAgentService();
    const executions = await aiService.getTaskExecutions(taskId);

    return NextResponse.json({
      executions,
      task: {
        id: task.id,
        agentEnabled: task.agentEnabled,
        agentType: task.agentType
      }
    });

  } catch (error: any) {
    console.error('Get execution error:', error);
    return NextResponse.json({
      error: 'Failed to get execution status',
      details: error.message
    }, { status: 500 });
  }
}

// DELETE /api/tasks/[taskId]/execute - Cancel running execution
export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId } = params;
    const { searchParams } = new URL(request.url);
    const executionId = searchParams.get('executionId');

    if (!executionId) {
      return NextResponse.json({ 
        error: 'Execution ID required' 
      }, { status: 400 });
    }

    // Verify ownership through task
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          userId: session.user.id
        }
      }
    });

    if (!task) {
      return NextResponse.json({ 
        error: 'Task not found or unauthorized' 
      }, { status: 404 });
    }

    // Cancel execution
    const aiService = new AIAgentService();
    await aiService.cancelExecution(executionId);

    // Create activity log
    await prisma.activity.create({
      data: {
        type: 'ai_execution_cancelled',
        description: 'AI agent execution cancelled by user',
        taskId,
        userId: session.user.id,
        metadata: JSON.stringify({
          executionId
        })
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Execution cancelled successfully'
    });

  } catch (error: any) {
    console.error('Cancel execution error:', error);
    return NextResponse.json({
      error: 'Failed to cancel execution',
      details: error.message
    }, { status: 500 });
  }
}

// Helper function to determine agent type based on task content
function determineAgentType(title: string, description: string): AgentType {
  const content = (title + ' ' + description).toLowerCase();

  // Bug fixing keywords
  if (content.match(/\b(fix|bug|error|issue|problem|broken|debug)\b/)) {
    return AgentType.BUG_FIXER;
  }

  // Testing keywords  
  if (content.match(/\b(test|testing|spec|unit test|integration test)\b/)) {
    return AgentType.TESTING;
  }

  // Documentation keywords
  if (content.match(/\b(document|docs|readme|comment|documentation)\b/)) {
    return AgentType.DOCUMENTATION;
  }

  // Refactoring keywords
  if (content.match(/\b(refactor|optimize|clean|improve|restructure)\b/)) {
    return AgentType.REFACTORING;
  }

  // Review keywords
  if (content.match(/\b(review|audit|check|validate|examine)\b/)) {
    return AgentType.REVIEW;
  }

  // Default to code generation
  return AgentType.CODE_GENERATOR;
}