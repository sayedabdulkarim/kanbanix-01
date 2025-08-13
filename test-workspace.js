#!/usr/bin/env node

/**
 * Test script for workspace management functionality
 * Run with: node test-workspace.js
 */

const fetch = require('node-fetch');

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PROJECT_ID = process.env.PROJECT_ID || 'test-project-id'; // Replace with actual project ID

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testWorkspaceAPIs() {
  log('\n=== Testing Workspace Management APIs ===\n', 'blue');
  
  try {
    // Test 1: Enter Workspace
    log('1. Testing /api/workspace/enter...', 'yellow');
    const enterResponse = await fetch(`${BASE_URL}/api/workspace/enter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID })
    });
    
    if (enterResponse.ok) {
      const enterData = await enterResponse.json();
      log(`✓ Workspace entered successfully at: ${enterData.workspacePath}`, 'green');
      log(`  Project: ${enterData.project?.name || 'Unknown'}`, 'green');
    } else {
      const error = await enterResponse.json();
      log(`✗ Failed to enter workspace: ${error.error}`, 'red');
      return;
    }
    
    // Test 2: Check Workspace Status
    log('\n2. Testing /api/workspace/status...', 'yellow');
    const statusResponse = await fetch(`${BASE_URL}/api/workspace/status?projectId=${PROJECT_ID}`);
    
    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      log('✓ Workspace status retrieved:', 'green');
      log(`  Exists: ${statusData.workspace.exists}`, 'green');
      log(`  Path: ${statusData.workspace.path}`, 'green');
      if (statusData.workspace.git) {
        log(`  Branch: ${statusData.workspace.git.branch}`, 'green');
        log(`  Has changes: ${statusData.workspace.git.hasUncommittedChanges}`, 'green');
      }
    } else {
      const error = await statusResponse.json();
      log(`✗ Failed to get workspace status: ${error.error}`, 'red');
    }
    
    // Test 3: Refresh Workspace
    log('\n3. Testing /api/workspace/refresh...', 'yellow');
    const refreshResponse = await fetch(`${BASE_URL}/api/workspace/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        projectId: PROJECT_ID,
        discardChanges: false 
      })
    });
    
    if (refreshResponse.ok) {
      const refreshData = await refreshResponse.json();
      log('✓ Workspace refreshed successfully', 'green');
      log(`  Current branch: ${refreshData.currentBranch}`, 'green');
      log(`  Last commit: ${refreshData.lastCommit}`, 'green');
    } else {
      const error = await refreshResponse.json();
      if (refreshResponse.status === 409) {
        log(`⚠ Uncommitted changes detected: ${error.message}`, 'yellow');
      } else {
        log(`✗ Failed to refresh workspace: ${error.error}`, 'red');
      }
    }
    
    // Test 4: Leave Workspace (cleanup)
    log('\n4. Testing /api/workspace/leave...', 'yellow');
    const leaveResponse = await fetch(`${BASE_URL}/api/workspace/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID })
    });
    
    if (leaveResponse.ok) {
      const leaveData = await leaveResponse.json();
      log('✓ Workspace cleaned up successfully', 'green');
      if (leaveData.tasksReset > 0) {
        log(`  Tasks reset: ${leaveData.tasksReset}`, 'green');
      }
    } else {
      const error = await leaveResponse.json();
      log(`✗ Failed to leave workspace: ${error.error}`, 'red');
    }
    
    // Test 5: Verify workspace is cleaned
    log('\n5. Verifying workspace is cleaned...', 'yellow');
    const verifyResponse = await fetch(`${BASE_URL}/api/workspace/status?projectId=${PROJECT_ID}`);
    
    if (verifyResponse.ok) {
      const verifyData = await verifyResponse.json();
      if (!verifyData.workspace.exists) {
        log('✓ Workspace successfully cleaned (does not exist)', 'green');
      } else {
        log('⚠ Workspace still exists after cleanup', 'yellow');
      }
    }
    
    log('\n=== All Tests Completed ===\n', 'blue');
    
  } catch (error) {
    log(`\n✗ Test failed with error: ${error.message}`, 'red');
    console.error(error);
  }
}

// Run tests
testWorkspaceAPIs().catch(console.error);