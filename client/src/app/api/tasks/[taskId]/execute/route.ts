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

    // Determine agent type if not provided
    const finalAgentType = agentType || await determineAgentType(task.title, task.description || '');

    // Update task to enable AI if not already enabled
    if (!task.agentEnabled) {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          agentEnabled: true,
          agentType: finalAgentType
        }
      });
    }

    // Initialize AI Agent Service
    const aiService = new AIAgentService();

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
// Now uses intelligent intent detection with LLM fallback to keywords
async function determineAgentType(title: string, description: string): Promise<AgentType> {
  try {
    // Dynamic import to avoid initialization issues
    const { intentDetectionService } = await import('@/lib/services/intentDetectionService');
    
    // Use the intelligent intent detection service
    const result = await intentDetectionService.detectIntent(title, description);
    
    console.log(`[Agent Type Detection] Method: ${result.method}, Type: ${result.agentType}, Confidence: ${result.confidence}%`);
    console.log(`[Agent Type Detection] Reasoning: ${result.reasoning}`);
    
    // Map string agent type to enum
    switch (result.agentType) {
      case 'bug_fixer':
        return AgentType.BUG_FIXER;
      case 'testing':
        return AgentType.TESTING;
      case 'documentation':
        return AgentType.DOCUMENTATION;
      case 'refactoring':
        return AgentType.REFACTORING;
      case 'review':
        return AgentType.REVIEW;
      case 'code_generator':
      default:
        return AgentType.CODE_GENERATOR;
    }
  } catch (error) {
    console.error('[Agent Type Detection] Service failed, using basic fallback:', error);
    
    // Ultimate fallback - basic keyword matching
    const content = (title + ' ' + description).toLowerCase();
    
    // Check action verbs first
    if (content.match(/\b(create|add|implement|build)\b/)) {
      return AgentType.CODE_GENERATOR;
    }
    if (content.match(/\b(fix|debug|repair)\b/)) {
      return AgentType.BUG_FIXER;
    }
    if (content.match(/\b(test|testing)\b/)) {
      return AgentType.TESTING;
    }
    if (content.match(/\b(document|docs)\b/)) {
      return AgentType.DOCUMENTATION;
    }
    
    return AgentType.CODE_GENERATOR; // Default
  }
}