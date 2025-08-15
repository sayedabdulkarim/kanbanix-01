#!/usr/bin/env node

/**
 * Test script for the new boilerplate generation using npx create-next-app
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Testing Boilerplate Generation with npx create-next-app...\n');

// Start the MCP server
const mcpServer = spawn('node', [
  path.join(__dirname, 'mcp-server/src/index.js')
], {
  env: {
    ...process.env,
    NODE_ENV: 'development',
    MCP_MODE: 'desktop'
  }
});

// Handle server output
mcpServer.stderr.on('data', (data) => {
  console.log('MCP Server:', data.toString());
});

mcpServer.stdout.on('data', (data) => {
  console.log('MCP Output:', data.toString());
});

// Wait for server to start
setTimeout(() => {
  console.log('\n🚀 Testing new project creation...\n');
  
  // Test 1: Create boilerplate request
  const test1 = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 1,
    params: {
      name: 'generate_task_code',
      arguments: {
        task_title: 'Create a boilerplate',
        task_description: 'Initialize a new Next.js project',
        context: {
          projectPath: '/tmp/test-kanbanix',
          projectName: 'test-nextjs-app'
        }
      }
    }
  }) + '\n';
  
  mcpServer.stdin.write(test1);
}, 1000);

// Test 2: Feature request (should be rejected)
setTimeout(() => {
  console.log('\n🧩 Testing feature request (should be rejected)...\n');
  
  const test2 = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 2,
    params: {
      name: 'generate_task_code',
      arguments: {
        task_title: 'Add a login button',
        task_description: 'Create a login button component',
        context: {
          projectPath: '/tmp/test-kanbanix'
        }
      }
    }
  }) + '\n';
  
  mcpServer.stdin.write(test2);
}, 3000);

// Clean up after tests
setTimeout(() => {
  console.log('\n✅ Tests completed. Cleaning up...');
  
  // Clean up test directory
  const { exec } = require('child_process');
  exec('rm -rf /tmp/test-kanbanix', (error) => {
    if (error) {
      console.log('Note: Test directory cleanup failed:', error.message);
    } else {
      console.log('Test directory cleaned up.');
    }
    
    mcpServer.kill();
    process.exit(0);
  });
}, 5000);

// Handle errors
mcpServer.on('error', (error) => {
  console.error('❌ Error starting MCP server:', error);
  process.exit(1);
});