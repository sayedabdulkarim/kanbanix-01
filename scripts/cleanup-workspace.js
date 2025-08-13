#!/usr/bin/env node

/**
 * Utility script to clean up workspace directories
 * Use this if workspaces get corrupted or stuck
 * 
 * Usage:
 *   node scripts/cleanup-workspace.js           # Clean all workspaces
 *   node scripts/cleanup-workspace.js PROJECT_ID # Clean specific workspace
 */

const fs = require('fs').promises;
const path = require('path');

const WORKSPACE_BASE = path.join(process.cwd(), 'client', 'projects');

async function cleanWorkspace(projectId) {
  const workspacePath = path.join(WORKSPACE_BASE, projectId);
  
  try {
    await fs.access(workspacePath);
    console.log(`Found workspace: ${workspacePath}`);
    
    console.log('Removing workspace...');
    await fs.rm(workspacePath, { recursive: true, force: true });
    console.log(`✓ Successfully removed workspace for project: ${projectId}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`No workspace found for project: ${projectId}`);
    } else {
      console.error(`Error removing workspace: ${error.message}`);
    }
  }
}

async function cleanAllWorkspaces() {
  try {
    await fs.access(WORKSPACE_BASE);
    const entries = await fs.readdir(WORKSPACE_BASE);
    
    if (entries.length === 0) {
      console.log('No workspaces found');
      return;
    }
    
    console.log(`Found ${entries.length} workspace(s)`);
    
    for (const entry of entries) {
      await cleanWorkspace(entry);
    }
    
    console.log('\nAll workspaces cleaned');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No workspace directory found at:', WORKSPACE_BASE);
    } else {
      console.error('Error cleaning workspaces:', error.message);
    }
  }
}

async function main() {
  const projectId = process.argv[2];
  
  console.log('=== Workspace Cleanup Utility ===\n');
  
  if (projectId) {
    await cleanWorkspace(projectId);
  } else {
    const response = await new Promise((resolve) => {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      readline.question('Clean ALL workspaces? (y/n): ', (answer) => {
        readline.close();
        resolve(answer.toLowerCase());
      });
    });
    
    if (response === 'y' || response === 'yes') {
      await cleanAllWorkspaces();
    } else {
      console.log('Cleanup cancelled');
    }
  }
}

main().catch(console.error);