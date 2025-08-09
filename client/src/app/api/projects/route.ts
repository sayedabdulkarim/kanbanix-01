import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { authOptions } from '../auth/[...nextauth]/route';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// GET /api/projects - List all projects for authenticated user
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projects = await prisma.project.findMany({
      where: {
        userId: session.user.id,
      },
      include: {
        columns: {
          include: {
            tasks: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    const formattedProjects = projects.map(project => ({
      id: project.id,
      name: project.name,
      description: project.description,
      gradient: project.gradient,
      initials: project.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
      githubUrl: project.githubRepoUrl,
      techStack: [], // TODO: Extract from GitHub languages API
      type: project.githubRepoId ? 'github' : 'standard',
      tasksCount: project.columns.reduce((total, col) => total + col.tasks.length, 0),
      columnsCount: project.columns.length,
      createdAt: project.createdAt,
      modifiedAt: project.updatedAt,
    }));

    return NextResponse.json(formattedProjects);
  } catch (error: any) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects', details: error.message },
      { status: 500 }
    );
  }
}

// POST /api/projects - Create new project
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

    // Create GitHub repository if requested
    if (createGithubRepo) {
      try {
        const octokit = new Octokit({
          auth: session.accessToken,
        });
        
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
      },
      include: {
        columns: true,
      },
    });

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