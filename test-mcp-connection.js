#!/usr/bin/env node

/**
 * Test script to verify MCP server connection
 * This simulates how Claude Desktop would communicate with the MCP server
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Testing MCP Server Connection...\n');

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

// Send a test request to list tools
setTimeout(() => {
  console.log('\n📋 Sending request to list available tools...\n');
  
  const listToolsRequest = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/list',
    id: 1,
    params: {}
  }) + '\n';
  
  mcpServer.stdin.write(listToolsRequest);
}, 1000);

// Send a test tool call
setTimeout(() => {
  console.log('\n🔧 Testing MCP connection tool...\n');
  
  const testRequest = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 2,
    params: {
      name: 'test_mcp_connection',
      arguments: {
        message: 'Hello from test script!'
      }
    }
  }) + '\n';
  
  mcpServer.stdin.write(testRequest);
}, 2000);

// Test intent analysis
setTimeout(() => {
  console.log('\n🤔 Testing intent analysis...\n');
  
  const intentRequest = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 3,
    params: {
      name: 'test_intent_analysis',
      arguments: {
        task_title: 'Create a boilerplate',
        task_description: 'Setup a new Next.js project with TypeScript'
      }
    }
  }) + '\n';
  
  mcpServer.stdin.write(intentRequest);
}, 3000);

// Clean up after 5 seconds
setTimeout(() => {
  console.log('\n✅ Test completed. Shutting down MCP server...');
  mcpServer.kill();
  process.exit(0);
}, 5000);

// Handle errors
mcpServer.on('error', (error) => {
  console.error('❌ Error starting MCP server:', error);
  process.exit(1);
});