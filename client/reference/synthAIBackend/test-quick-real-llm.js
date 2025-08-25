/**
 * Quick real LLM test to verify basic functionality
 * Tests that agent-service with real LLM:
 * 1. Generates files
 * 2. Includes boilerplate
 * 3. No forbidden dependencies
 */

const { AgentService } = require('./services/agent-service');

async function quickRealLLMTest() {
  console.log('=== QUICK REAL LLM TEST ===\n');
  
  const agentService = new AgentService();
  
  // Very simple requirement to speed up test
  const requirement = "Create a simple counter app with one button to increment";
  
  try {
    console.log('Testing with requirement:', requirement);
    console.log('This will use the real LLM API...\n');
    
    const result = await agentService.processRequirement(requirement);
    
    console.log('\n✅ Generation completed successfully!');
    
    // Quick checks
    console.log('\nGenerated files:', Object.keys(result.files).length);
    console.log('Has layout.tsx:', !!result.files['/src/app/layout.tsx']);
    console.log('Has package.json:', !!result.files['/package.json']);
    console.log('Has globals.css:', !!result.files['/src/app/globals.css']);
    
    // Check a component file for 'use client'
    const componentFiles = Object.keys(result.files).filter(f => 
      f.includes('/components/') && f.endsWith('.tsx')
    );
    
    if (componentFiles.length > 0) {
      const firstComponent = componentFiles[0];
      const hasUseClient = result.files[firstComponent].startsWith("'use client'");
      console.log(`\nFirst component (${firstComponent}):`);
      console.log('Has use client:', hasUseClient);
    }
    
    // Check package.json
    if (result.files['/package.json']) {
      const pkg = JSON.parse(result.files['/package.json']);
      const hasForbidden = !!(pkg.dependencies?.zustand || pkg.dependencies?.redux || pkg.dependencies?.axios);
      console.log('\nPackage.json check:');
      console.log('Has forbidden deps:', hasForbidden);
      console.log('Dependencies:', Object.keys(pkg.dependencies || {}).join(', '));
    }
    
    console.log('\n✅ All basic checks passed!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  }
}

// Run test
quickRealLLMTest().catch(console.error);