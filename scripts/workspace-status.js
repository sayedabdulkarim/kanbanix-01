#!/usr/bin/env node

/**
 * Check workspace status for all projects
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE_BASE = require('path').join(process.cwd(), 'client', 'projects');

// Colors
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function color(text, colorName) {
  return `${colors[colorName]}${text}${colors.reset}`;
}

async function getWorkspaceInfo() {
  try {
    await fs.access(WORKSPACE_BASE);
  } catch {
    console.log(color('No workspace directory found at: ' + WORKSPACE_BASE, 'yellow'));
    return;
  }

  const workspaces = await fs.readdir(WORKSPACE_BASE);
  
  if (workspaces.length === 0) {
    console.log(color('No active workspaces', 'yellow'));
    return;
  }

  console.log(color('\n📊 Workspace Status Report', 'bold'));
  console.log(color('═'.repeat(60), 'blue'));
  
  for (const workspace of workspaces) {
    const workspacePath = path.join(WORKSPACE_BASE, workspace);
    const stats = await fs.stat(workspacePath);
    
    console.log(color(`\n📁 ${workspace}`, 'cyan'));
    console.log(color('─'.repeat(40), 'blue'));
    
    // Basic info
    console.log(`  Path: ${workspacePath}`);
    console.log(`  Created: ${stats.birthtime.toLocaleString()}`);
    console.log(`  Modified: ${stats.mtime.toLocaleString()}`);
    
    // Size
    try {
      const size = execSync(`du -sh "${workspacePath}" | cut -f1`, { encoding: 'utf8' }).trim();
      console.log(`  Size: ${color(size, 'yellow')}`);
    } catch {}
    
    // Git info
    try {
      const branch = execSync('git branch --show-current', {
        cwd: workspacePath,
        encoding: 'utf8'
      }).trim();
      
      const statusOutput = execSync('git status --porcelain', {
        cwd: workspacePath,
        encoding: 'utf8'
      });
      
      const hasChanges = statusOutput.trim().length > 0;
      const changeCount = statusOutput.trim().split('\n').filter(l => l).length;
      
      console.log(`  Git Branch: ${color(branch, 'green')}`);
      console.log(`  Status: ${hasChanges ? 
        color(`${changeCount} uncommitted change(s)`, 'yellow') : 
        color('Clean', 'green')}`);
        
      // Check for generated files
      const generatedFiles = execSync('find . -type f -not -path "*/\.*" -not -path "*/node_modules/*" | wc -l', {
        cwd: workspacePath,
        encoding: 'utf8'
      }).trim();
      
      console.log(`  Files: ${color(generatedFiles + ' files', 'blue')}`);
      
    } catch (error) {
      console.log(`  ${color('Not a git repository', 'red')}`);
    }
  }
  
  console.log(color('\n' + '═'.repeat(60), 'blue'));
  console.log(color(`\nTotal Workspaces: ${workspaces.length}`, 'green'));
  
  // Total size
  try {
    const totalSize = execSync(`du -sh "${WORKSPACE_BASE}" | cut -f1`, { encoding: 'utf8' }).trim();
    console.log(color(`Total Size: ${totalSize}`, 'yellow'));
  } catch {}
}

async function main() {
  await getWorkspaceInfo();
  
  console.log(color('\n💡 Tips:', 'cyan'));
  console.log('  • View workspace: npm run workspace:view <projectId>');
  console.log('  • Clean workspace: npm run workspace:clean <projectId>');
  console.log('  • View database: npm run db:studio');
}

main().catch(console.error);