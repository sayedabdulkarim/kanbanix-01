#!/usr/bin/env node

/**
 * Calculate Build Success Rate from AgentExecution data
 *
 * This script analyzes your actual AI code generation performance
 * and calculates real metrics for your resume/demo
 */

const path = require('path');

// Prisma client is in the client directory
const { PrismaClient } = require(path.join(__dirname, '../client/node_modules/@prisma/client'));

const prisma = new PrismaClient();

async function calculateSuccessRate() {
  console.log('\n📊 Kanbanix Build Success Rate Analysis\n');
  console.log('=' .repeat(60));

  try {
    // Get all agent executions
    const allExecutions = await prisma.agentExecution.findMany({
      include: {
        task: {
          select: {
            title: true,
            status: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (allExecutions.length === 0) {
      console.log('\n⚠️  No execution data found yet.');
      console.log('Generate some code first to see real metrics!\n');
      return;
    }

    // Overall statistics
    const total = allExecutions.length;
    const successful = allExecutions.filter(e => e.status === 'success').length;
    const failed = allExecutions.filter(e => e.status === 'failed').length;
    const running = allExecutions.filter(e => e.status === 'running').length;
    const pending = allExecutions.filter(e => e.status === 'pending').length;
    const cancelled = allExecutions.filter(e => e.status === 'cancelled').length;

    // Calculate success rate
    const completedExecutions = successful + failed;
    const successRate = completedExecutions > 0
      ? ((successful / completedExecutions) * 100).toFixed(1)
      : 0;

    // Calculate average attempts
    const totalAttempts = allExecutions.reduce((sum, e) => sum + (e.attempts || 1), 0);
    const avgAttempts = (totalAttempts / total).toFixed(2);

    // Calculate average duration
    const completedWithDuration = allExecutions.filter(e => e.duration);
    const avgDuration = completedWithDuration.length > 0
      ? (completedWithDuration.reduce((sum, e) => sum + e.duration, 0) / completedWithDuration.length / 1000).toFixed(1)
      : 0;

    // First attempt success rate (no retries needed)
    const firstAttemptSuccess = allExecutions.filter(
      e => e.status === 'success' && e.attempts === 1
    ).length;
    const firstAttemptRate = completedExecutions > 0
      ? ((firstAttemptSuccess / completedExecutions) * 100).toFixed(1)
      : 0;

    // Print results
    console.log('\n📈 OVERALL STATISTICS');
    console.log('-'.repeat(60));
    console.log(`Total Executions:        ${total}`);
    console.log(`Successful:              ${successful} ✅`);
    console.log(`Failed:                  ${failed} ❌`);
    console.log(`Running:                 ${running} 🏃`);
    console.log(`Pending:                 ${pending} ⏳`);
    console.log(`Cancelled:               ${cancelled} 🚫`);

    console.log('\n🎯 SUCCESS METRICS');
    console.log('-'.repeat(60));
    console.log(`Build Success Rate:      ${successRate}%`);
    console.log(`First Attempt Success:   ${firstAttemptRate}%`);
    console.log(`Average Attempts:        ${avgAttempts}`);
    console.log(`Average Duration:        ${avgDuration}s`);

    // Agent type breakdown
    const byAgentType = {};
    allExecutions.forEach(e => {
      const type = e.agentType || 'unknown';
      if (!byAgentType[type]) {
        byAgentType[type] = { total: 0, success: 0, failed: 0 };
      }
      byAgentType[type].total++;
      if (e.status === 'success') byAgentType[type].success++;
      if (e.status === 'failed') byAgentType[type].failed++;
    });

    if (Object.keys(byAgentType).length > 0) {
      console.log('\n🤖 BY AGENT TYPE');
      console.log('-'.repeat(60));
      Object.entries(byAgentType).forEach(([type, stats]) => {
        const rate = stats.total > 0
          ? ((stats.success / (stats.success + stats.failed)) * 100).toFixed(1)
          : 0;
        console.log(`${type.padEnd(20)} ${stats.success}/${stats.total} (${rate}%)`);
      });
    }

    // Recent executions
    console.log('\n📋 RECENT EXECUTIONS (Last 5)');
    console.log('-'.repeat(60));
    allExecutions.slice(0, 5).forEach((exec, i) => {
      const status = exec.status === 'success' ? '✅' :
                     exec.status === 'failed' ? '❌' :
                     exec.status === 'running' ? '🏃' : '⏳';
      const duration = exec.duration ? `${(exec.duration / 1000).toFixed(1)}s` : 'N/A';
      console.log(`${i + 1}. [${status}] ${exec.task?.title || 'Unknown'} - ${duration} (${exec.attempts} attempts)`);
    });

    // Summary for Resume
    console.log('\n' + '='.repeat(60));
    console.log('📝 FOR YOUR RESUME/LINKEDIN:');
    console.log('='.repeat(60));
    console.log(`
✨ Kanbanix Performance Metrics:
   • Build Success Rate: ${successRate}%
   • First-Attempt Success: ${firstAttemptRate}%
   • Total Code Generations: ${total}
   • Average Generation Time: ${avgDuration}s
   • Retry Rate: ${avgAttempts}x attempts average
    `);

    console.log('\n💡 SUGGESTED RESUME BULLET POINTS:');
    console.log('-'.repeat(60));
    console.log(`• Implemented automated code generation with ${successRate}% build success rate`);
    console.log(`• Achieved ${firstAttemptRate}% first-attempt success through context-aware validation`);
    console.log(`• Processed ${total}+ AI-powered code generation tasks with ${avgDuration}s average completion time`);
    console.log(`• Reduced manual coding effort by ${successRate}% through intelligent automation\n`);

  } catch (error) {
    console.error('❌ Error calculating metrics:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the analysis
calculateSuccessRate();
