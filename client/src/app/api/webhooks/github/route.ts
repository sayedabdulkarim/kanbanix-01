import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Verify GitHub webhook signature
function verifyWebhookSignature(payload: string, signature: string | null): boolean {
  if (!signature) return false;
  
  const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
  if (!secret) {
    console.warn('No GITHUB_WEBHOOK_SECRET configured, accepting webhook');
    return true; // For development, accept without verification
  }
  
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(signature)
  );
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-hub-signature-256');
    const event = request.headers.get('x-github-event');
    const body = await request.text();
    
    // Verify webhook signature
    if (!verifyWebhookSignature(body, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    
    const payload = JSON.parse(body);
    
    // Handle pull request events
    if (event === 'pull_request') {
      const { action, pull_request, repository } = payload;
      
      console.log(`GitHub webhook: PR ${action} - #${pull_request.number}`);
      
      // Find task by PR number
      const task = await prisma.task.findFirst({
        where: {
          githubPrNumber: pull_request.number,
          project: {
            githubRepo: repository.name,
            githubOwner: repository.owner.login,
          }
        },
        include: {
          project: true,
        }
      });
      
      if (!task) {
        console.log('No task found for PR #' + pull_request.number);
        return NextResponse.json({ message: 'No task found' });
      }
      
      // Handle different PR actions
      if (action === 'closed' && pull_request.merged) {
        // PR was merged - move task to Done
        console.log(`Moving task ${task.id} to Done (PR merged)`);
        
        // Find the "Done" column
        const doneColumn = await prisma.column.findFirst({
          where: {
            projectId: task.projectId,
            OR: [
              { name: { contains: 'Done', mode: 'insensitive' } },
              { name: { contains: 'done', mode: 'insensitive' } },
              { name: { contains: 'Completed', mode: 'insensitive' } },
            ]
          }
        });
        
        await prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'done',
            githubState: 'merged',
            columnId: doneColumn?.id || task.columnId,
            completedAt: new Date(),
          }
        });
        
        // Log activity
        await prisma.activity.create({
          data: {
            taskId: task.id,
            userId: task.project.userId,
            type: 'pr_merged',
            description: `PR #${pull_request.number} merged to ${pull_request.base.ref}`,
            metadata: JSON.stringify({
              prNumber: pull_request.number,
              prUrl: pull_request.html_url,
              mergedBy: pull_request.merged_by?.login,
              mergedAt: pull_request.merged_at,
            })
          }
        });
        
      } else if (action === 'opened' || action === 'reopened') {
        // PR opened/reopened - ensure task is in Review
        const inReviewColumn = await prisma.column.findFirst({
          where: {
            projectId: task.projectId,
            OR: [
              { name: { contains: 'Review', mode: 'insensitive' } },
              { name: { contains: 'review', mode: 'insensitive' } },
            ]
          }
        });
        
        await prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'inReview',
            githubState: 'open',
            columnId: inReviewColumn?.id || task.columnId,
          }
        });
        
      } else if (action === 'closed' && !pull_request.merged) {
        // PR closed without merging - move back to In Progress
        const inProgressColumn = await prisma.column.findFirst({
          where: {
            projectId: task.projectId,
            OR: [
              { name: { contains: 'Progress', mode: 'insensitive' } },
              { name: { contains: 'progress', mode: 'insensitive' } },
            ]
          }
        });
        
        await prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'inProgress',
            githubState: 'closed',
            columnId: inProgressColumn?.id || task.columnId,
          }
        });
      }
      
      return NextResponse.json({ 
        success: true,
        message: `Processed PR ${action} for task ${task.id}` 
      });
    }
    
    // Handle push events (for detecting merges to main)
    if (event === 'push' && payload.ref === 'refs/heads/main') {
      console.log('Push to main branch detected');
      // Could check for merged PRs here if needed
    }
    
    return NextResponse.json({ 
      success: true,
      message: `Webhook ${event} processed` 
    });
    
  } catch (error: any) {
    console.error('GitHub webhook error:', error);
    return NextResponse.json({
      error: 'Webhook processing failed',
      details: error.message
    }, { status: 500 });
  }
}

// GitHub sends a ping event when webhook is first configured
export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    message: 'GitHub webhook endpoint',
    status: 'ready' 
  });
}