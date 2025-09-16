#!/usr/bin/env node

/**
 * Simple test for build validation - tests the actual MCP server integration
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_WORKSPACE = path.join(__dirname, 'workspace-projects', 'test-validation');

async function runCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command.split(' ');
    const proc = spawn(cmd, args, { cwd, shell: true });
    
    let output = '';
    let errorOutput = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
      console.log(data.toString());
    });
    
    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error(data.toString());
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output });
      } else {
        resolve({ success: false, output, error: errorOutput });
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function setup() {
  console.log('🔧 Setting up test project...');
  
  // Clean up
  try {
    await fs.rm(TEST_WORKSPACE, { recursive: true });
  } catch (e) {}
  
  // Create Next.js project structure
  await fs.mkdir(path.join(TEST_WORKSPACE, 'src', 'app'), { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, 'src', 'lib'), { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, 'src', 'styles'), { recursive: true });
  
  // Create package.json
  await fs.writeFile(
    path.join(TEST_WORKSPACE, 'package.json'),
    JSON.stringify({
      name: 'test-validation',
      version: '1.0.0',
      scripts: {
        build: 'echo "Testing build validation..."',
        dev: 'echo "Dev mode"'
      },
      dependencies: {
        next: '^14.0.0',
        react: '^18.0.0',
        '@prisma/client': '^5.0.0'
      }
    }, null, 2)
  );
  
  // Create test file with missing imports
  await fs.writeFile(
    path.join(TEST_WORKSPACE, 'src', 'app', 'page.tsx'),
    `import React from 'react';
import { prisma } from '@/lib/prisma';
import '@/styles/globals.css';

export default function HomePage() {
  return (
    <div>
      <h1>Test Page</h1>
    </div>
  );
}`
  );
  
  console.log('✅ Test project created');
}

async function testValidation() {
  console.log('\n🧪 Testing build validation...\n');
  
  // Run build to generate errors
  console.log('Running initial build to detect errors...');
  const buildResult = await runCommand('npm run build 2>&1', TEST_WORKSPACE);
  
  console.log('\nBuild result:', buildResult.success ? '✅ Success' : '❌ Failed');
  
  if (!buildResult.success) {
    // Check what files exist after attempted fixes
    console.log('\n📁 Checking for auto-generated files:');
    
    const filesToCheck = [
      'src/lib/prisma.ts',
      'src/styles/globals.css',
      'tsconfig.json',
      'jsconfig.json'
    ];
    
    for (const file of filesToCheck) {
      const fullPath = path.join(TEST_WORKSPACE, file);
      const exists = await fs.access(fullPath).then(() => true).catch(() => false);
      console.log(`  ${file}: ${exists ? '✅' : '❌'}`);
      
      if (exists && file.endsWith('.ts')) {
        const content = await fs.readFile(fullPath, 'utf-8');
        console.log(`    Content preview: ${content.substring(0, 80)}...`);
      }
    }
  }
}

async function main() {
  try {
    await setup();
    await testValidation();
    
    console.log('\n✨ Test completed');
    
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await fs.rm(TEST_WORKSPACE, { recursive: true });
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();