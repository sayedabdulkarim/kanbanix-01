import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { authOptions } from '../../auth/[...nextauth]/route';
import path from 'path';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// GET /api/tasks/[taskId] - Get single task
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
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          userId: session.user.id,
        },
      },
      include: {
        project: true,
        assignee: true,
        labels: true,
        comments: {
          include: {
            author: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        activities: {
          include: {
            user: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 50,
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      order: task.order,
      columnId: task.columnId,
      projectId: task.projectId,
      githubIssueNumber: task.githubIssueNumber,
      githubPrNumber: task.githubPrNumber,
      githubState: task.githubState,
      dueDate: task.dueDate,
      timeEstimate: task.timeEstimate,
      timeSpent: task.timeSpent,
      assignee: task.assignee,
      labels: task.labels,
      comments: task.comments.map(comment => ({
        id: comment.id,
        content: comment.content,
        authorName: comment.author.name,
        authorImage: comment.author.image,
        createdAt: comment.createdAt,
      })),
      activities: task.activities.map(activity => ({
        id: activity.id,
        type: activity.type,
        description: activity.description,
        userName: activity.user.name,
        createdAt: activity.createdAt,
      })),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  } catch (error: any) {
    console.error('Error fetching task:', error);
    return NextResponse.json(
      { error: 'Failed to fetch task', details: error.message },
      { status: 500 }
    );
  }
}

// PUT /api/tasks/[taskId] - Update task
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId } = await params;
    const updates = await request.json();
    
    console.log('=== TASK UPDATE DEBUG ===');
    console.log('Task ID:', taskId);
    console.log('Updates received:', JSON.stringify(updates, null, 2));
    console.log('Environment variables:', {
      AI_AUTO_EXECUTE_ON_DRAG: process.env.AI_AUTO_EXECUTE_ON_DRAG,
      MCP_MODE: process.env.MCP_MODE,
      NODE_ENV: process.env.NODE_ENV
    });
    console.log('========================');

    // Verify user owns the task
    const existingTask = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          userId: session.user.id,
        },
      },
    });

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Filter valid update fields
    const validFields = [
      'title', 'description', 'status', 'priority', 'columnId', 
      'order', 'dueDate', 'timeEstimate', 'timeSpent', 'assigneeId'
    ];
    
    const filteredUpdates: any = {};
    for (const [key, value] of Object.entries(updates)) {
      if (validFields.includes(key)) {
        if (key === 'dueDate' && value) {
          filteredUpdates[key] = new Date(value as string);
        } else {
          filteredUpdates[key] = value;
        }
      }
    }

    // Update the task
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: filteredUpdates,
      include: {
        assignee: true,
        labels: true,
      },
    });

    // Sync with GitHub if status changed and task has GitHub integration
    if (filteredUpdates.status && 
        filteredUpdates.status !== existingTask.status && 
        existingTask.githubIssueNumber && 
        existingTask.project.githubOwner && 
        existingTask.project.githubRepo &&
        session.accessToken) {
      
      try {
        const octokit = new Octokit({ auth: session.accessToken });
        
        // Map task status to GitHub issue state
        let githubState: 'open' | 'closed' = 'open';
        if (filteredUpdates.status === 'done') {
          githubState = 'closed';
        }
        
        // Only update if GitHub state needs to change
        if ((githubState === 'closed' && existingTask.githubState !== 'closed') ||
            (githubState === 'open' && existingTask.githubState === 'closed')) {
          
          await octokit.issues.update({
            owner: existingTask.project.githubOwner,
            repo: existingTask.project.githubRepo,
            issue_number: existingTask.githubIssueNumber,
            state: githubState,
          });
          
          // Update task's GitHub state
          await prisma.task.update({
            where: { id: taskId },
            data: { githubState },
          });
          
          // Log GitHub sync activity
          await prisma.activity.create({
            data: {
              type: 'synced',
              description: `GitHub issue #${existingTask.githubIssueNumber} ${githubState === 'closed' ? 'closed' : 'reopened'} automatically`,
              taskId: updatedTask.id,
              userId: session.user.id,
            },
          });
        }
      } catch (githubError: any) {
        console.error('GitHub sync error:', githubError);
        // Don't fail the task update if GitHub sync fails
        await prisma.activity.create({
          data: {
            type: 'error',
            description: `Failed to sync with GitHub: ${githubError.message}`,
            taskId: updatedTask.id,
            userId: session.user.id,
          },
        });
      }
    }

    // AI Agent Auto-Trigger: Check if status changed to "inProgress"
    console.log('=== AI TRIGGER CHECK ===');
    console.log('Filtered updates status:', filteredUpdates.status);
    console.log('Existing task status:', existingTask.status);
    console.log('AI auto execute on drag:', process.env.AI_AUTO_EXECUTE_ON_DRAG);
    console.log('Condition check:', {
      statusIsInProgress: filteredUpdates.status === 'inProgress',
      statusChanged: existingTask.status !== 'inProgress',
      aiEnabled: process.env.AI_AUTO_EXECUTE_ON_DRAG !== 'false',
      willTrigger: filteredUpdates.status === 'inProgress' && 
                   existingTask.status !== 'inProgress' &&
                   process.env.AI_AUTO_EXECUTE_ON_DRAG !== 'false'
    });
    console.log('========================');
    
    let aiExecutionTriggered = false;
    if (filteredUpdates.status === 'inProgress' && 
        existingTask.status !== 'inProgress' &&
        process.env.AI_AUTO_EXECUTE_ON_DRAG !== 'false') {
      
      try {
        console.log('>>> AI AGENT TRIGGERING <<<');
        console.log('Starting AI agent for task:', updatedTask.title);
        
        // Dynamic import to avoid circular dependencies
        const { AIAgentService, AgentType } = await import('@/lib/services/aiAgentService');
        const aiService = new AIAgentService();
        
        // Determine agent type based on task content (await the async function)
        const agentType = await determineAgentType(updatedTask.title, updatedTask.description || '');
        console.log('Determined agent type:', agentType);
        
        // Enable AI for this task and execute
        await prisma.task.update({
          where: { id: taskId },
          data: {
            agentEnabled: true,
            agentType,
            startedAt: new Date()
          }
        });
        console.log('Task AI settings updated');

        // Get workspace path for the project
        const workspacePath = path.join(process.cwd(), 'projects', existingTask.projectId);
        
        // Execute AI agent with workspace context
        console.log('Calling AI service executeTask with workspace:', workspacePath);
        await aiService.executeTask(taskId, agentType, {
          projectPath: workspacePath,
          workspacePath: workspacePath,
          projectId: existingTask.projectId,
          autoTrigger: true,
          userId: session.user.id
        });

        aiExecutionTriggered = true;
        console.log('AI agent execution initiated successfully');

        // Log AI execution trigger
        await prisma.activity.create({
          data: {
            type: 'ai_execution_started',
            description: `AI agent (${agentType}) automatically started execution`,
            taskId: updatedTask.id,
            userId: session.user.id,
            metadata: JSON.stringify({
              agentType,
              autoTriggered: true
            })
          },
        });
      } catch (aiError: any) {
        console.error('AI agent trigger error:', aiError);
        // Log error but don't fail the task update
        await prisma.activity.create({
          data: {
            type: 'error',
            description: `Failed to start AI agent: ${aiError.message}`,
            taskId: updatedTask.id,
            userId: session.user.id,
          },
        });
      }
    }

    // Create activity log for significant changes
    const significantChanges = ['status', 'columnId', 'assigneeId'];
    for (const field of significantChanges) {
      if (filteredUpdates[field] !== undefined && filteredUpdates[field] !== existingTask[field as keyof typeof existingTask]) {
        let description = '';
        switch (field) {
          case 'status':
            description = `Task status changed from ${existingTask.status} to ${filteredUpdates[field]}`;
            if (filteredUpdates[field] === 'inProgress' && aiExecutionTriggered) {
              description += ' (AI agent started automatically)';
            }
            break;
          case 'columnId':
            description = `Task moved to different column`;
            break;
          case 'assigneeId':
            description = filteredUpdates[field] ? 'Task was assigned' : 'Task assignee was removed';
            break;
        }
        
        await prisma.activity.create({
          data: {
            type: 'updated',
            description,
            taskId: updatedTask.id,
            userId: session.user.id,
          },
        });
      }
    }

    return NextResponse.json({
      id: updatedTask.id,
      title: updatedTask.title,
      description: updatedTask.description,
      status: updatedTask.status,
      priority: updatedTask.priority,
      order: updatedTask.order,
      columnId: updatedTask.columnId,
      projectId: updatedTask.projectId,
      dueDate: updatedTask.dueDate,
      timeEstimate: updatedTask.timeEstimate,
      timeSpent: updatedTask.timeSpent,
      assignee: updatedTask.assignee,
      labels: updatedTask.labels,
      createdAt: updatedTask.createdAt,
      updatedAt: updatedTask.updatedAt,
    });
  } catch (error: any) {
    console.error('Error updating task:', error);
    return NextResponse.json(
      { error: 'Failed to update task', details: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/tasks/[taskId] - Delete task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId } = await params;
    // Verify user owns the task
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        project: {
          userId: session.user.id,
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Delete the task (cascade will handle related records)
    await prisma.task.delete({
      where: { id: taskId },
    });

    return NextResponse.json({ message: 'Task deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting task:', error);
    return NextResponse.json(
      { error: 'Failed to delete task', details: error.message },
      { status: 500 }
    );
  }
}

// Helper function to determine agent type based on task content
// Now uses intelligent intent detection with LLM fallback to keywords
async function determineAgentType(title: string, description: string): Promise<string> {
  try {
    // Dynamic import to avoid initialization issues
    const { intentDetectionService } = await import('@/lib/services/intentDetectionService');
    
    // Use the intelligent intent detection service
    const result = await intentDetectionService.detectIntent(title, description);
    
    console.log(`[Agent Type Detection] Method: ${result.method}, Type: ${result.agentType}, Confidence: ${result.confidence}%`);
    console.log(`[Agent Type Detection] Reasoning: ${result.reasoning}`);
    
    return result.agentType;
  } catch (error) {
    console.error('[Agent Type Detection] Service failed, using basic fallback:', error);
    
    // Ultimate fallback - basic keyword matching
    const content = (title + ' ' + description).toLowerCase();
    
    // Check action verbs first
    if (content.match(/\b(create|add|implement|build)\b/)) {
      return 'code_generator';
    }
    if (content.match(/\b(fix|debug|repair)\b/)) {
      return 'bug_fixer';
    }
    if (content.match(/\b(test|testing)\b/)) {
      return 'testing';
    }
    if (content.match(/\b(document|docs)\b/)) {
      return 'documentation';
    }
    
    return 'code_generator'; // Default
  }
}