#!/usr/bin/env node

// Test the context-enhanced code generation
import { spawn } from 'child_process';
import path from 'path';

const testProjectPath = process.argv[2] || './client/projects/test-project';
const projectId = process.argv[3] || 'test-project-id';

console.log('Testing Context-Enhanced Code Generation...');
console.log('Project Path:', testProjectPath);
console.log('Project ID:', projectId);

function testGenerateWithContext() {
  return new Promise((resolve) => {
    console.log('\n=== Testing Code Generation with Context ===');
    
    const mcpProcess = spawn('node', ['./mcp-server/src/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MCP_MODE: 'desktop',
        WORKSPACE_PATH: testProjectPath,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
      }
    });

    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'generate_code_with_context',
        arguments: {
          task_title: 'Add a simple counter component',
          task_description: 'Create a counter with increment and decrement buttons',
          project_id: projectId,
          workspace_path: testProjectPath
        }
      }
    };

    console.log('Sending request to generate code with context...');
    mcpProcess.stdin.write(JSON.stringify(request) + '\n');

    let output = '';
    mcpProcess.stdout.on('data', (data) => {
      output += data.toString();
      console.log('Output chunk:', data.toString());
    });

    mcpProcess.stderr.on('data', (data) => {
      console.error('Error:', data.toString());
    });

    setTimeout(() => {
      console.log('\nFinal Response:', output);
      mcpProcess.kill();
      resolve();
    }, 10000); // Give it 10 seconds for API call
  });
}

// Run test
async function runTest() {
  try {
    await testGenerateWithContext();
    console.log('\n✅ Test completed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

runTest();