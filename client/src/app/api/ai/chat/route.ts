import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { PrismaClient } from '@prisma/client';
import { AIAgentService } from '@/lib/services/aiAgentService';
import { diffTrackingService } from '@/lib/services/diffTrackingService.server';
import path from 'path';
import fs from 'fs/promises';

const prisma = new PrismaClient();
const aiAgentService = new AIAgentService();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      taskId, 
      projectId, 
      message, 
      attachedFiles = [],
      context 
    } = body;

    if (!taskId || !projectId || !message) {
      return NextResponse.json({ 
        error: 'Task ID, Project ID, and message are required' 
      }, { status: 400 });
    }

    // Get task details
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: true,
        agentExecutions: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Verify task is in InReview status
    if (task.status !== 'inReview') {
      return NextResponse.json({ 
        error: 'Chat is only available for tasks in review' 
      }, { status: 400 });
    }

    // Get workspace path
    const workspacePath = path.join(process.cwd(), 'projects', projectId);

    // Read attached files if any
    let fileContents: { path: string; content: string }[] = [];
    if (attachedFiles.length > 0) {
      for (const filePath of attachedFiles) {
        try {
          const fullPath = path.join(workspacePath, filePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          fileContents.push({ path: filePath, content });
        } catch (error) {
          console.error(`Error reading file ${filePath}:`, error);
        }
      }
    }

    // Build context for AI agent
    const aiContext = {
      taskTitle: task.title,
      taskDescription: task.description,
      previousExecution: task.agentExecutions[0] || null,
      attachedFiles: fileContents,
      workspacePath,
      projectInfo: {
        name: task.project.name,
        githubOwner: task.project.githubOwner,
        githubRepo: task.project.githubRepo
      }
    };

    // Get AI response and potentially make changes
    const aiResponse = await aiAgentService.handleFollowUpRequest({
      message,
      context: aiContext,
      taskId,
      projectId
    });

    // Check if AI made any changes
    let hasChanges = false;
    let newDiffs = null;

    if (aiResponse.changes && aiResponse.changes.length > 0) {
      hasChanges = true;
      
      // Create a new agent execution record for these changes
      const execution = await prisma.agentExecution.create({
        data: {
          taskId,
          status: 'COMPLETED',
          agentType: 'CODE_GENERATOR',
          input: JSON.stringify({
            title: `Follow-up: ${task.title}`,
            description: message,
            requirements: [],
            context: { isFollowUp: true }
          }),
          summary: aiResponse.response,
          changes: JSON.stringify(aiResponse.changes),
          progress: 100,
          currentStep: 'Changes applied',
          attempts: 1,
          startedAt: new Date(),
          completedAt: new Date()
        }
      });

      // Track the new diffs - fix the path extraction
      const changedFilePaths = aiResponse.changes.map((change: any) => 
        change.path ? change.path.replace(/^\//, '') : change.filePath || ''
      ).filter((path: string) => path);
      
      if (changedFilePaths.length > 0) {
        newDiffs = await diffTrackingService.captureDiff(
          taskId,
          execution.id,
          workspacePath,
          changedFilePaths,
          'chat-modification'
        );

        // Update task's diffs
        const existingDiffs = task.diffs ? JSON.parse(task.diffs as string) : [];
        const updatedDiffs = [...existingDiffs, newDiffs].filter(Boolean);
        
        await prisma.task.update({
          where: { id: taskId },
          data: {
            diffs: JSON.stringify(updatedDiffs),
            updatedAt: new Date()
          }
        });
      }
    }

    // Note: Since Task doesn't have a metadata field, we'll skip storing chat history for now
    // In a production app, you'd create a separate ChatMessage table to store this
    console.log('Chat messages processed successfully');

    return NextResponse.json({
      success: true,
      response: aiResponse.response,
      hasChanges,
      changes: aiResponse.changes || [],
      diffs: newDiffs
    });

  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json({
      error: 'Failed to process chat message',
      details: error.message
    }, { status: 500 });
  }
}