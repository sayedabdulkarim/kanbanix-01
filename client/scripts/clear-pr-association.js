const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function clearOldPRAssociation(projectId) {
  try {
    console.log(`Clearing old PR associations for project ${projectId}...`);
    
    // Clear tasks that have githubState: 'merged' but no PR number
    const orphanedMergedTasks = await prisma.task.updateMany({
      where: {
        projectId,
        githubState: 'merged',
        githubPrNumber: null
      },
      data: {
        githubState: null,
        githubPrId: null
      }
    });
    
    console.log(`Cleared orphaned merged state from ${orphanedMergedTasks.count} tasks`);
    
    // Update tasks that have PR #17 and are in done status
    const result = await prisma.task.updateMany({
      where: {
        projectId,
        githubPrNumber: 17,
        status: 'done'
      },
      data: {
        githubPrNumber: null,
        githubPrId: null,
        githubState: null
      }
    });
    
    console.log(`Cleared PR #17 association from ${result.count} tasks`);
    
    // Also clear any lingering session state PR references
    const sessionResult = await prisma.sessionState.updateMany({
      where: {
        projectId,
        prNumber: 17
      },
      data: {
        prNumber: null,
        prUrl: null,
        prTitle: null,
        prCreated: false
      }
    });
    
    console.log(`Cleared PR from ${sessionResult.count} session states`);
    
  } catch (error) {
    console.error('Error clearing PR associations:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Get project ID from command line or use the one from your logs
const projectId = process.argv[2] || 'cmeqv6pcs0011e2yaoftlnj2l';
clearOldPRAssociation(projectId);