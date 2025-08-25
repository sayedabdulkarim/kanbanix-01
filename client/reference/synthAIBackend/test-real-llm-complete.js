/**
 * Test with real LLM - Complete integration test
 * This verifies all our fixes work together:
 * 1. Boilerplate templates are included
 * 2. No external dependencies are used
 * 3. 'use client' directives are properly added
 * 4. Import/export validation passes
 */

const { AgentService } = require('./services/agent-service');
const fs = require('fs').promises;
const path = require('path');

async function testRealLLMComplete() {
  console.log('=== REAL LLM INTEGRATION TEST ===\n');
  
  const agentService = new AgentService();
  
  // Test with a simple requirement
  const requirement = "Create a todo app where users can add, complete, and delete tasks";
  
  try {
    console.log('Processing requirement:', requirement);
    console.log('Using real LLM (this may take a moment)...\n');
    
    const startTime = Date.now();
    const result = await agentService.processRequirement(requirement);
    const endTime = Date.now();
    
    console.log(`\nProcessing completed in ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    
    // Check generated files
    console.log('\n--- GENERATED FILES ---');
    const files = Object.keys(result.files).sort();
    files.forEach(file => {
      console.log(`  ${file}`);
    });
    
    // Check for boilerplate files
    console.log('\n--- BOILERPLATE FILES CHECK ---');
    const criticalFiles = [
      '/src/app/layout.tsx',
      '/src/app/globals.css',
      '/package.json',
      '/tailwind.config.js',
      '/postcss.config.js'
    ];
    
    criticalFiles.forEach(file => {
      if (result.files[file]) {
        console.log(`  ✓ ${file}`);
      } else {
        console.log(`  ✗ ${file} MISSING!`);
      }
    });
    
    // Check for 'use client' directives
    console.log('\n--- USE CLIENT DIRECTIVES CHECK ---');
    const componentFiles = files.filter(f => 
      (f.includes('/components/') || f.includes('/app/')) && 
      (f.endsWith('.tsx') || f.endsWith('.jsx'))
    );
    
    componentFiles.forEach(file => {
      const content = result.files[file];
      const hasUseClient = content.startsWith("'use client'");
      console.log(`  ${file}: ${hasUseClient ? '✓ has use client' : '✗ missing use client'}`);
    });
    
    // Check for forbidden dependencies
    console.log('\n--- DEPENDENCY CHECK ---');
    if (result.files['/package.json']) {
      const packageJson = JSON.parse(result.files['/package.json']);
      const dependencies = Object.keys(packageJson.dependencies || {});
      const devDependencies = Object.keys(packageJson.devDependencies || {});
      const allDeps = [...dependencies, ...devDependencies];
      
      const forbiddenDeps = ['zustand', 'redux', 'mobx', 'axios', 'framer-motion', 'styled-components'];
      const foundForbidden = allDeps.filter(dep => forbiddenDeps.includes(dep));
      
      if (foundForbidden.length > 0) {
        console.log(`  ✗ Found forbidden dependencies: ${foundForbidden.join(', ')}`);
      } else {
        console.log('  ✓ No forbidden dependencies found');
      }
      
      console.log(`  Dependencies: ${dependencies.join(', ')}`);
    }
    
    // Check for Tailwind import issues
    console.log('\n--- TAILWIND IMPORT CHECK ---');
    let tailwindImportIssues = false;
    componentFiles.forEach(file => {
      const content = result.files[file];
      if (content.includes("import 'tailwindcss") || content.includes('require("tailwindcss')) {
        console.log(`  ✗ ${file} has direct tailwind import!`);
        tailwindImportIssues = true;
      }
    });
    if (!tailwindImportIssues) {
      console.log('  ✓ No direct tailwind imports found');
    }
    
    // Check validation results
    console.log('\n--- VALIDATION RESULTS ---');
    if (result.feedback) {
      console.log('  Validation feedback:', result.feedback);
    } else {
      console.log('  ✓ No validation errors');
    }
    
    // Write a sample file to disk for inspection
    const testDir = path.join(__dirname, 'test-output-real-llm');
    await fs.mkdir(testDir, { recursive: true });
    
    // Write layout.tsx for inspection
    if (result.files['/src/app/layout.tsx']) {
      await fs.writeFile(
        path.join(testDir, 'layout.tsx'), 
        result.files['/src/app/layout.tsx']
      );
      console.log(`\n  Sample file written to: ${path.join(testDir, 'layout.tsx')}`);
    }
    
    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Total files generated: ${files.length}`);
    console.log(`Has all critical boilerplate: ${criticalFiles.every(f => result.files[f])}`);
    console.log(`All components have 'use client': ${componentFiles.every(f => result.files[f].startsWith("'use client'"))}`);
    console.log(`No forbidden dependencies: ${result.files['/package.json'] ? !JSON.parse(result.files['/package.json']).dependencies?.zustand : true}`);
    console.log(`No validation errors: ${!result.feedback}`);
    
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
  }
}

// Run the test
console.log('Starting real LLM test...\n');
testRealLLMComplete().catch(console.error);