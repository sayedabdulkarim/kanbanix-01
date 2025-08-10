#!/usr/bin/env node

/**
 * Start the MCP server for development
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting MCP Server for No-Code Framework...\n');

const mcpServerPath = path.join(__dirname, 'mcp/server.js');

// Start the MCP server
const mcpProcess = spawn('node', [mcpServerPath], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' }
});

mcpProcess.on('error', (error) => {
  console.error('❌ Failed to start MCP server:', error);
  process.exit(1);
});

mcpProcess.on('close', (code) => {
  console.log(`\nMCP server exited with code ${code}`);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down MCP server...');
  mcpProcess.kill();
  process.exit(0);
});

console.log('✅ MCP Server is running');
console.log('📝 The server provides tools for Claude to access project files\n');
console.log('Press Ctrl+C to stop\n');