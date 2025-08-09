import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { getGithubClient, createGithubWebhook } from '../../lib/github';
import { randomBytes } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, description, isPrivate, createGithubRepo } = await request.json();

    // Validate input
    if (!name || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      );
    }

    let githubRepoData = null;
    let webhookData = null;

    // Create GitHub repository if requested
    if (createGithubRepo) {
      try {
        const octokit = await getGithubClient();
        
        // Create repository on GitHub
        const { data: repo } = await octokit.repos.createForAuthenticatedUser({
          name: name.replace(/\s+/g, '-').toLowerCase(),
          description: description || undefined,
          private: isPrivate || false,
          auto_init: true,
          gitignore_template: 'Node',
          license_template: 'mit',
        });

        githubRepoData = {
          githubRepoId: repo.id.toString(),
          githubRepoUrl: repo.html_url,
          githubOwner: repo.owner.login,
          githubRepo: repo.name,
        };

        // Create webhook for the new repository
        const webhookSecret = randomBytes(20).toString('hex');
        const webhookUrl = `${process.env.NEXTAUTH_URL}/api/webhooks/github`;
        
        try {
          const webhook = await createGithubWebhook(
            repo.owner.login,
            repo.name,
            webhookUrl,
            webhookSecret
          );
          
          if (webhook) {
            webhookData = {
              webhookId: webhook.id.toString(),
              secret: webhookSecret,
              events: JSON.stringify(webhook.events),
            };
          }
        } catch (error) {
          console.error('Failed to create webhook:', error);
        }
      } catch (error: any) {
        console.error('Failed to create GitHub repository:', error);
        return NextResponse.json(
          { 
            error: 'Failed to create GitHub repository', 
            details: error.message,
            suggestion: 'Check if the repository name already exists or if you have the necessary permissions'
          },
          { status: 500 }
        );
      }
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

    // Create project in database
    const project = await prisma.project.create({
      data: {
        name,
        description: description || null,
        gradient: randomGradient,
        ...githubRepoData,
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
        ...(webhookData && {
          webhooks: {
            create: webhookData,
          },
        }),
      },
      include: {
        columns: true,
        webhooks: true,
      },
    });

    // Create initial README task if GitHub repo was created
    if (githubRepoData) {
      const backlogColumn = project.columns.find(col => col.name === 'Backlog');
      if (backlogColumn) {
        await prisma.task.create({
          data: {
            title: 'Setup project README',
            description: 'Create a comprehensive README.md file with project documentation',
            status: 'todo',
            priority: 'medium',
            order: 0,
            projectId: project.id,
            columnId: backlogColumn.id,
          },
        });
      }
    }

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        gradient: project.gradient,
        githubUrl: project.githubRepoUrl,
        columnsCount: project.columns.length,
      },
      message: createGithubRepo 
        ? 'Project and GitHub repository created successfully' 
        : 'Project created successfully',
    });
  } catch (error: any) {
    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Failed to create project', details: error.message },
      { status: 500 }
    );
  }
}