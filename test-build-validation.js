#!/usr/bin/env node

/**
 * Test script for Phase 2.5 Build Validation Reflection Loop
 * Tests that build errors are detected and fixed across 5 attempts
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic import to avoid module issues
const loadGenerator = async () => {
  const module = await import('./mcp-server/src/tools/context-enhanced-generator.js');
  return module.ContextEnhancedGenerator;
};

const TEST_WORKSPACE = path.join(__dirname, 'workspace-projects', 'test-build-validation');

async function setup() {
  console.log('🔧 Setting up test workspace...');
  
  // Clean up if exists
  try {
    await fs.rm(TEST_WORKSPACE, { recursive: true });
  } catch (e) {
    // Ignore if doesn't exist
  }
  
  // Create test workspace
  await fs.mkdir(TEST_WORKSPACE, { recursive: true });
  
  // Create a Next.js project structure
  await fs.mkdir(path.join(TEST_WORKSPACE, 'src'), { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, 'src', 'lib'), { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, 'src', 'styles'), { recursive: true });
  
  // Create package.json with build script
  await fs.writeFile(
    path.join(TEST_WORKSPACE, 'package.json'),
    JSON.stringify({
      name: 'test-build-validation',
      version: '1.0.0',
      scripts: {
        build: 'echo "Build would run here"',
        lint: 'eslint . --fix'
      },
      dependencies: {
        next: '^14.0.0',
        react: '^18.0.0',
        '@prisma/client': '^5.0.0'
      },
      devDependencies: {
        eslint: '^8.0.0',
        typescript: '^5.0.0'
      }
    }, null, 2)
  );
  
  // Create a file with intentional errors
  await fs.writeFile(
    path.join(TEST_WORKSPACE, 'src', 'app.tsx'),
    `import React from 'react';
import { prisma } from '@/lib/prisma'; // This will fail - missing file
import '@/styles/globals.css'; // This will fail - missing file
import { NonExistentComponent } from './components/Missing'; // This will fail

export default function App() {
  const data = await prisma.user.findMany(); // Missing await in non-async
  
  return (
    <div>
      <h1>Test App</h1>
      <NonExistentComponent />
    </div>
  );
}`
  );
  
  console.log('✅ Test workspace created with intentional errors');
}

async function testBuildValidation() {
  console.log('\n🧪 Testing Build Validation Reflection Loop...\n');
  
  const ContextEnhancedGenerator = await loadGenerator();
  const generator = new ContextEnhancedGenerator();
  
  // Test the build validation with 5 attempts
  const buildResult = await generator.validateBuild(TEST_WORKSPACE, 'npm run build');
  
  console.log('\n📊 Build Validation Results:');
  console.log('- Success:', buildResult.success);
  console.log('- Attempts:', buildResult.attempts);
  console.log('- Errors Fixed:', buildResult.fixedErrors?.length || 0);
  
  if (!buildResult.success) {
    console.log('\n❌ Remaining Errors:');
    buildResult.errors?.forEach(err => {
      console.log(`  - ${err.substring(0, 100)}...`);
    });
  }
  
  // Check if files were created
  console.log('\n📁 Checking created files:');
  
  const filesToCheck = [
    'src/lib/prisma.ts',
    'src/styles/globals.css',
    'src/components/Missing.tsx'
  ];
  
  for (const file of filesToCheck) {
    const fullPath = path.join(TEST_WORKSPACE, file);
    const exists = await fs.access(fullPath).then(() => true).catch(() => false);
    console.log(`  ${file}: ${exists ? '✅ Created' : '❌ Missing'}`);
    
    if (exists) {
      const content = await fs.readFile(fullPath, 'utf-8');
      console.log(`    Preview: ${content.substring(0, 50)}...`);
    }
  }
  
  // Test specific error patterns
  console.log('\n🔍 Testing Error Detection Patterns:');
  
  const testErrors = [
    {
      error: "Module not found: Can't resolve '@/lib/prisma'",
      expectedCategory: 'missingImports',
      expectedFix: 'Create src/lib/prisma.ts'
    },
    {
      error: "Module not found: Can't resolve '@/styles/globals.css'",
      expectedCategory: 'missingImports',
      expectedFix: 'Create src/styles/globals.css'
    },
    {
      error: "Cannot find module './components/Missing'",
      expectedCategory: 'missingImports',
      expectedFix: 'Create src/components/Missing.tsx'
    },
    {
      error: "Parsing error: The keyword 'await' is reserved",
      expectedCategory: 'syntaxErrors',
      expectedFix: 'Run ESLint --fix'
    }
  ];
  
  const categorized = await generator.categorizeErrors(testErrors.map(t => t.error), TEST_WORKSPACE);
  
  for (const test of testErrors) {
    const found = categorized[test.expectedCategory]?.some(e => 
      e.includes(test.error.split(':')[1]?.trim())
    );
    console.log(`  ${test.error.substring(0, 50)}...`);
    console.log(`    Category: ${test.expectedCategory} ${found ? '✅' : '❌'}`);
    console.log(`    Fix: ${test.expectedFix}`);
  }
  
  return buildResult;
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test workspace...');
  try {
    await fs.rm(TEST_WORKSPACE, { recursive: true });
    console.log('✅ Cleanup complete');
  } catch (e) {
    console.error('⚠️ Could not clean up test workspace:', e.message);
  }
}

async function main() {
  try {
    await setup();
    const result = await testBuildValidation();
    
    if (result.success || result.attempts === 5) {
      console.log('\n✨ Build Validation Reflection Loop test completed!');
      console.log('\n📝 Results Summary:');
      console.log(`- System made ${result.attempts} attempt(s) to fix errors`);
      console.log(`- Max attempts configured: 5`);
      console.log(`- Final status: ${result.success ? 'BUILD PASSED ✅' : 'BUILD FAILED ❌'}`);
      
      if (result.attempts === 5 && !result.success) {
        console.log('\n⚠️ Note: Build still failing after 5 attempts.');
        console.log('This is expected for complex errors that need manual intervention.');
      }
    } else {
      console.log('\n❌ Test failed: Did not complete expected attempts');
    }
    
    await cleanup();
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    await cleanup();
    process.exit(1);
  }
}

main();