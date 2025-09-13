#!/usr/bin/env node

// Test script for MCP context-aware tools
import { spawn } from 'child_process';
import path from 'path';

const testProjectPath = process.argv[2] || './client/projects/test-project';
const projectId = process.argv[3] || 'test-project-id';

console.log('Testing MCP Context-Aware Tools...');
console.log('Project Path:', testProjectPath);
console.log('Project ID:', projectId);

// Test 1: Scan Project Structure
function testScanProject() {
  return new Promise((resolve) => {
    console.log('\n=== Test 1: Scanning Project Structure ===');
    
    const mcpProcess = spawn('node', ['./mcp-server/src/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MCP_MODE: 'desktop',
        WORKSPACE_PATH: testProjectPath
      }
    });

    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'scan_project_structure',
        arguments: {
          workspace_path: testProjectPath,
          project_id: projectId
        }
      }
    };

    mcpProcess.stdin.write(JSON.stringify(request) + '\n');

    let output = '';
    mcpProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    setTimeout(() => {
      console.log('Response:', output);
      mcpProcess.kill();
      resolve();
    }, 3000);
  });
}

// Test 2: Detect Files with Context
function testDetectFiles() {
  return new Promise((resolve) => {
    console.log('\n=== Test 2: Detecting Files with Context ===');
    
    const mcpProcess = spawn('node', ['./mcp-server/src/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MCP_MODE: 'desktop',
        WORKSPACE_PATH: testProjectPath
      }
    });

    const request = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'detect_files_with_context',
        arguments: {
          task_title: 'Add TODO feature with backend',
          workspace_path: testProjectPath,
          project_id: projectId
        }
      }
    };

    mcpProcess.stdin.write(JSON.stringify(request) + '\n');

    let output = '';
    mcpProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    setTimeout(() => {
      console.log('Response:', output);
      mcpProcess.kill();
      resolve();
    }, 3000);
  });
}

// Test 3: Get Project Summary
function testProjectSummary() {
  return new Promise((resolve) => {
    console.log('\n=== Test 3: Getting Project Summary ===');
    
    const mcpProcess = spawn('node', ['./mcp-server/src/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MCP_MODE: 'desktop',
        WORKSPACE_PATH: testProjectPath
      }
    });

    const request = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_project_summary',
        arguments: {
          project_id: projectId,
          workspace_path: testProjectPath
        }
      }
    };

    mcpProcess.stdin.write(JSON.stringify(request) + '\n');

    let output = '';
    mcpProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    setTimeout(() => {
      console.log('Response:', output);
      mcpProcess.kill();
      resolve();
    }, 3000);
  });
}

// Run tests
async function runTests() {
  try {
    await testScanProject();
    await testDetectFiles();
    await testProjectSummary();
    console.log('\n✅ All tests completed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

runTests();