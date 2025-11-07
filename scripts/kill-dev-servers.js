#!/usr/bin/env node

/**
 * Kill all running dev servers (client + MCP) before starting new ones
 */

const { execSync } = require('child_process');

console.log('🧹 Cleaning up old dev server processes...');

try {
  // Kill all node processes related to this project
  const processes = execSync('ps aux | grep -E "mcp-server|server.js|concurrently" | grep -v grep || true', { encoding: 'utf-8' });

  if (processes.trim()) {
    console.log('Found running processes:');
    console.log(processes);

    // Kill concurrently processes (parent)
    try {
      execSync('pkill -f "concurrently.*CLIENT.*MCP" || true');
      console.log('✅ Killed concurrently processes');
    } catch (e) {
      // Ignore errors
    }

    // Kill MCP server processes
    try {
      execSync('pkill -f "mcp-server/src/index.js" || true');
      console.log('✅ Killed MCP server processes');
    } catch (e) {
      // Ignore errors
    }

    // Kill client server processes
    try {
      execSync('pkill -f "client.*server.js" || true');
      console.log('✅ Killed client server processes');
    } catch (e) {
      // Ignore errors
    }

    // Wait a bit for cleanup
    console.log('⏳ Waiting for cleanup...');
    execSync('sleep 2');

  } else {
    console.log('✨ No old processes found, all clean!');
  }

  console.log('✅ Cleanup complete! Ready to start fresh servers.\n');

} catch (error) {
  console.error('⚠️  Warning: Cleanup had issues, but continuing...', error.message);
}
