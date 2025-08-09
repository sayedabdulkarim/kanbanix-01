import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { authOptions } from '../../auth/[...nextauth]/route';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const project = await prisma.project.findFirst({
      where: {
        id: params.projectId,
        userId: session.user.id,
      },
      include: {
        columns: {
          orderBy: {
            order: 'asc',
          },
        },
        tasks: {
          include: {
            column: true,
            labels: true,
            assignee: true,
            comments: {
              include: {
                author: true,
              },
            },
            activities: {
              include: {
                user: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
              take: 10,
            },
          },
          orderBy: {
            order: 'asc',
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Format the response to match frontend expectations
    const formattedProject = {
      id: project.id,
      name: project.name,
      description: project.description || '',
      gradient: project.gradient || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      initials: project.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
      type: project.githubRepoId ? 'github' : 'standard',
      githubRepoUrl: project.githubRepoUrl,
      githubOwner: project.githubOwner,
      githubRepo: project.githubRepo,
      columns: project.columns.map(col => ({
        id: col.id,
        name: col.name,
        order: col.order,
        color: col.color,
      })),
      tasks: project.tasks.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description || '',
        status: task.status,
        priority: task.priority || 'medium',
        columnId: task.columnId,
        projectId: task.projectId,
        order: task.order,
        githubIssueNumber: task.githubIssueNumber,
        githubPrNumber: task.githubPrNumber,
        githubState: task.githubState,
        dueDate: task.dueDate,
        timeEstimate: task.timeEstimate,
        timeSpent: task.timeSpent,
        assignee: task.assignee ? {
          id: task.assignee.id,
          name: task.assignee.name,
          image: task.assignee.image,
        } : null,
        labels: task.labels.map(label => ({
          id: label.id,
          name: label.name,
          color: label.color,
        })),
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
      })),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };

    return NextResponse.json(formattedProject);
  } catch (error: any) {
    console.error('Error fetching project:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project', details: error.message },
      { status: 500 }
    );
  }
}