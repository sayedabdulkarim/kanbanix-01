/**
 * Test code generation with real LLM (not mocked)
 * This will make actual API calls to test the constraints
 */

const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

// Check for API key
if (!process.env.OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY environment variable is required');
  console.error('Please set it before running this test');
  process.exit(1);
}

async function runBuildTest(projectPath) {
  return new Promise((resolve) => {
    console.log('\n🔨 Running build test...');
    const build = spawn('npm', ['run', 'build'], {
      cwd: projectPath,
      shell: true,
      stdio: 'pipe'
    });
    
    let output = '';
    let errorOutput = '';
    
    build.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    build.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    build.on('close', (code) => {
      resolve({
        success: code === 0,
        output,
        errorOutput
      });
    });
  });
}

async function testRealLLMGeneration() {
  console.log('\n' + '='.repeat(60));
  console.log('🤖 REAL LLM CODE GENERATION TEST');
  console.log('='.repeat(60));
  console.log('\nThis test will make actual API calls to generate code.');
  console.log('Testing if LLM follows our constraints...\n');
  
  try {
    // Use the real services without mocking
    const { AgentService } = require('../services/agent-service');
    const service = new AgentService();
    
    // Test requirements that might trigger forbidden patterns
    const testCases = [
      {
        name: 'Counter with State Management',
        requirement: 'Create a counter app with state management for increment, decrement, and history tracking',
        checkFor: ['zustand', 'redux', 'mobx'],
        shouldNotContain: true
      },
      {
        name: 'Todo App with Storage',
        requirement: 'Build a todo list app where users can add, complete, and delete tasks',
        checkFor: ['zustand', 'redux', 'react-hook-form'],
        shouldNotContain: true
      },
      {
        name: 'Dashboard with Data',
        requirement: 'Create a simple dashboard showing stats cards with numbers',
        checkFor: ['axios', 'swr', 'react-query', 'recharts'],
        shouldNotContain: true
      }
    ];
    
    // Test just the first case for now (to save API calls)
    const testCase = testCases[0];
    
    console.log(`📋 Test Case: ${testCase.name}`);
    console.log(`Requirement: "${testCase.requirement}"`);
    console.log('\n⏳ Generating code with real LLM...\n');
    
    const startTime = Date.now();
    const result = await service.processRequirement(testCase.requirement);
    const generationTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`✅ Code generated in ${generationTime}s`);
    
    // Analyze results
    console.log('\n📊 Analysis:');
    console.log('─'.repeat(40));
    
    // Check for forbidden dependencies
    const codeString = JSON.stringify(result.files);
    const foundForbidden = testCase.checkFor.filter(lib => 
      codeString.toLowerCase().includes(lib)
    );
    
    console.log(`\n🔍 Checking for forbidden libraries:`);
    testCase.checkFor.forEach(lib => {
      const found = codeString.toLowerCase().includes(lib);
      console.log(`  ${found ? '❌' : '✅'} ${lib}: ${found ? 'FOUND (should not be there!)' : 'Not found (good!)'}`);
    });
    
    // Check package.json
    const packageJson = result.files['/package.json'];
    if (packageJson) {
      const pkg = JSON.parse(packageJson);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      console.log('\n📦 Dependencies found:');
      Object.keys(deps).forEach(dep => {
        console.log(`  - ${dep}`);
      });
      
      // Check if only allowed deps
      const allowedDeps = [
        'next', 'react', 'react-dom', 'typescript',
        '@types/react', '@types/react-dom', '@types/node',
        'tailwindcss', 'autoprefixer', 'postcss',
        'eslint', 'eslint-config-next'
      ];
      
      const hasOnlyAllowed = Object.keys(deps).every(dep => 
        allowedDeps.some(allowed => dep.startsWith(allowed))
      );
      
      console.log(`\n${hasOnlyAllowed ? '✅' : '❌'} Only allowed dependencies used`);
    }
    
    // Check for required files
    console.log('\n📁 Required files check:');
    const requiredFiles = [
      '/src/app/layout.tsx',
      '/src/app/page.tsx',
      '/src/app/globals.css',
      '/package.json',
      '/tailwind.config.js',
      '/postcss.config.js'
    ];
    
    requiredFiles.forEach(file => {
      const exists = !!result.files[file];
      console.log(`  ${exists ? '✅' : '❌'} ${file}`);
    });
    
    // Check 'use client' directives
    console.log('\n🏷️  Use client directives:');
    const componentFiles = Object.entries(result.files)
      .filter(([path]) => path.includes('/components/') && path.endsWith('.tsx'));
    
    componentFiles.forEach(([path, content]) => {
      const hasUseClient = content.trim().startsWith("'use client'");
      console.log(`  ${hasUseClient ? '✅' : '❌'} ${path}`);
    });
    
    // Check for validation feedback
    if (result.feedback) {
      console.log('\n⚠️  Validation Feedback:');
      console.log(result.feedback);
    }
    
    // Write to temp directory for build test
    const testDir = path.join(__dirname, 'temp-real-llm-test');
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(testDir, { recursive: true });
    
    console.log('\n📝 Writing generated files...');
    for (const [filePath, content] of Object.entries(result.files)) {
      const fullPath = path.join(testDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }
    
    // Install and build
    console.log('\n📦 Installing dependencies...');
    const install = spawn('npm', ['install'], {
      cwd: testDir,
      shell: true,
      stdio: 'inherit'
    });
    
    await new Promise((resolve) => install.on('close', resolve));
    
    // Run build test
    const buildResult = await runBuildTest(testDir);
    
    console.log('\n🏗️  Build Results:');
    console.log('─'.repeat(40));
    console.log(`Build: ${buildResult.success ? '✅ PASSED' : '❌ FAILED'}`);
    
    if (!buildResult.success) {
      console.log('\nBuild errors:');
      console.log(buildResult.errorOutput || buildResult.output);
    }
    
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    
    // Summary
    const constraintsFollowed = foundForbidden.length === 0;
    const hasRequiredFiles = requiredFiles.every(f => !!result.files[f]);
    const buildPassed = buildResult.success;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 REAL LLM TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`LLM followed constraints: ${constraintsFollowed ? '✅ YES' : '❌ NO'}`);
    console.log(`Required files present: ${hasRequiredFiles ? '✅ YES' : '❌ NO'}`);
    console.log(`Build successful: ${buildPassed ? '✅ YES' : '❌ NO'}`);
    
    if (!constraintsFollowed) {
      console.log(`\n❌ Found forbidden libraries: ${foundForbidden.join(', ')}`);
    }
    
    const testPassed = constraintsFollowed && hasRequiredFiles && buildPassed;
    console.log(`\nReal LLM Test: ${testPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log('='.repeat(60));
    
    return testPassed;
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    
    // Check if it's an API error
    if (error.message.includes('API') || error.message.includes('401')) {
      console.error('\n⚠️  This might be an API key issue. Please check:');
      console.error('1. OPENROUTER_API_KEY is set correctly');
      console.error('2. The API key has sufficient credits');
      console.error('3. The API endpoint is accessible');
    }
    
    return false;
  }
}

// Run test
console.log('⚠️  This test will use your OpenRouter API credits!');
console.log('Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');

setTimeout(() => {
  testRealLLMGeneration()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test error:', error);
      process.exit(1);
    });
}, 3000);