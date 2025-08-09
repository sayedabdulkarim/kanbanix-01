import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { getGithubClient, createGithubWebhook, syncGithubIssues } from '../../lib/github';
import { randomBytes } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { repoId, repoName, repoDescription, repoUrl, owner, repo } = await request.json();

    // Check if project already exists
    const existingProject = await prisma.project.findUnique({
      where: { githubRepoId: repoId.toString() },
    });

    if (existingProject) {
      return NextResponse.json(
        { error: 'Repository already imported', projectId: existingProject.id },
        { status: 400 }
      );
    }

    // Generate a random gradient for the project card
    const gradients = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
    ];
    const randomGradient = gradients[Math.floor(Math.random() * gradients.length)];

    // Create project with default columns
    const project = await prisma.project.create({
      data: {
        name: repoName,
        description: repoDescription,
        gradient: randomGradient,
        githubRepoId: repoId.toString(),
        githubRepoUrl: repoUrl,
        githubOwner: owner,
        githubRepo: repo,
        userId: session.user.id,
        columns: {
          create: [
            { name: 'Backlog', order: 0, color: '#6B7280' },
            { name: 'To Do', order: 1, color: '#3B82F6' },
            { name: 'In Progress', order: 2, color: '#F59E0B' },
            { name: 'In Review', order: 3, color: '#8B5CF6' },
            { name: 'Done', order: 4, color: '#10B981' },
          ],
        },
      },
      include: {
        columns: true,
      },
    });

    // Create webhook for real-time updates
    const webhookSecret = randomBytes(20).toString('hex');
    const webhookUrl = `${process.env.NEXTAUTH_URL}/api/webhooks/github`;
    
    try {
      const webhook = await createGithubWebhook(owner, repo, webhookUrl, webhookSecret);
      
      if (webhook) {
        await prisma.webhook.create({
          data: {
            webhookId: webhook.id.toString(),
            secret: webhookSecret,
            events: JSON.stringify(webhook.events),
            projectId: project.id,
          },
        });
      }
    } catch (error) {
      console.error('Failed to create webhook:', error);
      // Continue without webhook - it's not critical
    }

    // Import existing issues as tasks
    try {
      const issues = await syncGithubIssues(owner, repo);
      
      // Get the default column (Backlog)
      const backlogColumn = project.columns.find(col => col.name === 'Backlog');
      
      if (backlogColumn && issues.length > 0) {
        const tasks = issues
          .filter(issue => !issue.pull_request) // Filter out PRs
          .map((issue, index) => ({
            title: issue.title,
            description: issue.body || '',
            status: 'todo',
            priority: issue.labels.some((l: any) => l.name === 'urgent') ? 'high' :
                     issue.labels.some((l: any) => l.name === 'bug') ? 'medium' : 'low',
            order: index,
            githubIssueNumber: issue.number,
            githubIssueId: issue.id.toString(),
            githubState: issue.state,
            projectId: project.id,
            columnId: backlogColumn.id,
            createdAt: new Date(issue.created_at),
            updatedAt: new Date(issue.updated_at),
          }));

        await prisma.task.createMany({
          data: tasks,
        });
      }
    } catch (error) {
      console.error('Failed to import issues:', error);
      // Continue without importing issues
    }

    return NextResponse.json({
      projectId: project.id,
      message: 'Repository imported successfully',
    });
  } catch (error: any) {
    console.error('Error importing repository:', error);
    return NextResponse.json(
      { error: 'Failed to import repository', details: error.message },
      { status: 500 }
    );
  }
}