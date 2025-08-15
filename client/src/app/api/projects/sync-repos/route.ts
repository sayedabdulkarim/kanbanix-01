import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { authOptions } from '../../auth/[...nextauth]/route';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// POST /api/projects/sync-repos - Sync all projects with GitHub to check if repos still exist
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !session.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all projects for the user that have GitHub repos
    const projects = await prisma.project.findMany({
      where: {
        userId: session.user.id,
        githubRepoUrl: {
          not: null,
        },
      },
    });

    const octokit = new Octokit({
      auth: session.accessToken,
    });

    const syncResults = {
      checked: 0,
      deleted: 0,
      errors: 0,
      deletedProjects: [] as string[],
    };

    // Check each project's GitHub repo
    for (const project of projects) {
      if (!project.githubOwner || !project.githubRepo) continue;
      
      syncResults.checked++;
      
      try {
        // Try to get the repository
        await octokit.repos.get({
          owner: project.githubOwner,
          repo: project.githubRepo,
        });
        
        // Repository exists, no action needed
      } catch (error: any) {
        if (error.status === 404) {
          // Repository not found - it was deleted on GitHub
          console.log(`Repository ${project.githubOwner}/${project.githubRepo} not found on GitHub`);
          
          // Delete the project from database
          await prisma.project.delete({
            where: {
              id: project.id,
            },
          });
          
          syncResults.deleted++;
          syncResults.deletedProjects.push(project.name);
        } else if (error.status === 403) {
          // No access - might be private or access revoked
          console.log(`No access to repository ${project.githubOwner}/${project.githubRepo}`);
          // Keep the project but could mark it as inaccessible
        } else {
          // Other error
          console.error(`Error checking repository ${project.githubOwner}/${project.githubRepo}:`, error);
          syncResults.errors++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Sync completed: ${syncResults.checked} projects checked, ${syncResults.deleted} deleted, ${syncResults.errors} errors`,
      ...syncResults,
    });
  } catch (error: any) {
    console.error('Error syncing projects with GitHub:', error);
    return NextResponse.json(
      { error: 'Failed to sync projects', details: error.message },
      { status: 500 }
    );
  }
}

// GET /api/projects/sync-repos - Get sync status (optional)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Count projects with GitHub repos
    const projectCount = await prisma.project.count({
      where: {
        userId: session.user.id,
        githubRepoUrl: {
          not: null,
        },
      },
    });

    return NextResponse.json({
      projectsWithGitHub: projectCount,
      message: 'Use POST to sync projects with GitHub',
    });
  } catch (error: any) {
    console.error('Error getting sync status:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status', details: error.message },
      { status: 500 }
    );
  }
}