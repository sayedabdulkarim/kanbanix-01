#!/usr/bin/env node

/**
 * View workspace contents for Kanbanix projects
 * Usage: npm run workspace:view [projectId]
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE_BASE = require('path').join(process.cwd(), 'client', 'projects');

// Colors for terminal output
const colors = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function color(text, colorName) {
  return `${colors[colorName]}${text}${colors.reset}`;
}

async function listWorkspaces() {
  try {
    const entries = await fs.readdir(WORKSPACE_BASE);
    if (entries.length === 0) {
      console.log(color('No workspaces found', 'yellow'));
      return null;
    }
    
    console.log(color('\n📁 Available Workspaces:', 'cyan'));
    console.log(color('─'.repeat(50), 'blue'));
    
    for (const entry of entries) {
      const workspacePath = path.join(WORKSPACE_BASE, entry);
      const stats = await fs.stat(workspacePath);
      
      // Try to get git info
      let gitInfo = '';
      try {
        const branch = execSync('git branch --show-current', {
          cwd: workspacePath,
          encoding: 'utf8'
        }).trim();
        gitInfo = color(` (${branch})`, 'green');
      } catch {}
      
      console.log(`  ${color('•', 'blue')} ${entry}${gitInfo}`);
      console.log(`    ${color('Path:', 'yellow')} ${workspacePath}`);
      console.log(`    ${color('Modified:', 'yellow')} ${stats.mtime.toLocaleString()}`);
    }
    
    return entries;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(color('No workspace directory found', 'yellow'));
    } else {
      console.error(color(`Error: ${error.message}`, 'red'));
    }
    return null;
  }
}

async function viewWorkspace(projectId) {
  const workspacePath = path.join(WORKSPACE_BASE, projectId);
  
  try {
    await fs.access(workspacePath);
  } catch {
    console.log(color(`\n❌ Workspace not found: ${projectId}`, 'red'));
    return;
  }
  
  console.log(color(`\n📂 Workspace: ${projectId}`, 'cyan'));
  console.log(color('═'.repeat(60), 'blue'));
  
  // Get git status
  try {
    const branch = execSync('git branch --show-current', {
      cwd: workspacePath,
      encoding: 'utf8'
    }).trim();
    
    const status = execSync('git status --short', {
      cwd: workspacePath,
      encoding: 'utf8'
    });
    
    console.log(color('\n🔀 Git Information:', 'green'));
    console.log(`  Branch: ${color(branch, 'yellow')}`);
    
    if (status) {
      console.log(color('\n📝 Uncommitted Changes:', 'yellow'));
      console.log(status.split('\n').map(line => '  ' + line).join('\n'));
    } else {
      console.log(color('  ✓ Working directory clean', 'green'));
    }
  } catch (error) {
    console.log(color('  Not a git repository', 'yellow'));
  }
  
  // Show directory structure
  console.log(color('\n📁 Directory Structure:', 'magenta'));
  
  async function showTree(dir, prefix = '') {
    const items = await fs.readdir(dir);
    const filteredItems = items.filter(item => 
      !item.startsWith('.') || item === '.git'
    );
    
    for (let i = 0; i < filteredItems.length; i++) {
      const item = filteredItems[i];
      const itemPath = path.join(dir, item);
      const stats = await fs.stat(itemPath);
      const isLast = i === filteredItems.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      
      if (stats.isDirectory()) {
        if (item === '.git') {
          console.log(`${prefix}${connector}${color('.git/', 'blue')}`);
        } else if (item === 'node_modules') {
          console.log(`${prefix}${connector}${color('node_modules/', 'yellow')} (skipped)`);
        } else {
          console.log(`${prefix}${connector}${color(item + '/', 'cyan')}`);
          const newPrefix = prefix + (isLast ? '    ' : '│   ');
          await showTree(itemPath, newPrefix);
        }
      } else {
        const size = (stats.size / 1024).toFixed(1) + 'KB';
        console.log(`${prefix}${connector}${item} ${color(`(${size})`, 'yellow')}`);
      }
    }
  }
  
  try {
    await showTree(workspacePath, '  ');
  } catch (error) {
    console.error(color(`Error reading directory: ${error.message}`, 'red'));
  }
  
  // Show recently modified files
  console.log(color('\n🕐 Recently Modified Files:', 'green'));
  try {
    const recentFiles = execSync(
      `find . -type f -not -path "*/\.*" -not -path "*/node_modules/*" -exec ls -lt {} + | head -5`,
      { cwd: workspacePath, encoding: 'utf8' }
    );
    console.log(recentFiles.split('\n').map(line => '  ' + line).join('\n'));
  } catch {}
  
  console.log(color('\n' + '═'.repeat(60), 'blue'));
}

async function main() {
  const projectId = process.argv[2];
  
  console.log(color('\n🚀 Kanbanix Workspace Viewer', 'bold'));
  
  if (!projectId) {
    const workspaces = await listWorkspaces();
    if (workspaces && workspaces.length > 0) {
      console.log(color('\nUsage: npm run workspace:view <projectId>', 'yellow'));
      console.log(color('Example: npm run workspace:view ' + workspaces[0], 'green'));
    }
  } else {
    await viewWorkspace(projectId);
  }
}

main().catch(console.error);