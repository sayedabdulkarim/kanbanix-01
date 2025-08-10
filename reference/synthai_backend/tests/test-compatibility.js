/**
 * Quick compatibility test to ensure changes don't break existing functionality
 */

const { AgentService } = require('../services/agent-service');

async function testCompatibility() {
  console.log('=== COMPATIBILITY TEST ===\n');
  
  const agentService = new AgentService();
  
  // Mock for speed
  agentService.prdService.generatePRD = async (req) => `Simple PRD for: ${req}`;
  
  agentService.taskGenerator.callLLM = async (prompt) => {
    if (prompt.includes('Create a detailed task list')) {
      return JSON.stringify({
        tasks: [{
          id: "task-1",
          name: "Create counter component",
          description: "Create a simple counter",
          files: ["src/components/Counter.tsx"],
          priority: 1
        }]
      });
    }
    
    if (prompt.includes('Create counter component')) {
      return JSON.stringify({
        files: [{
          path: "src/components/Counter.tsx",
          content: `'use client';

import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(count + 1)}>Increment</button>
      <button onClick={() => setCount(count - 1)}>Decrement</button>
    </div>
  );
}`
        }],
        description: "Created counter component"
      });
    }
    
    return '{}';
  };
  
  try {
    console.log('Testing simple counter app generation...');
    const result = await agentService.processRequirement("Create a simple counter app");
    
    // Check results
    const checks = {
      'Files generated': Object.keys(result.files).length > 0,
      'Has boilerplate files': !!result.files['/src/app/layout.tsx'] && !!result.files['/package.json'],
      'Has counter component': !!result.files['/src/components/Counter.tsx'],
      'No validation errors': !result.feedback,
      'Counter has use client': result.files['/src/components/Counter.tsx']?.startsWith("'use client'")
    };
    
    console.log('\nResults:');
    for (const [check, passed] of Object.entries(checks)) {
      console.log(`  ${check}: ${passed ? '✅' : '❌'}`);
    }
    
    const allPassed = Object.values(checks).every(v => v);
    console.log(`\nOverall: ${allPassed ? '✅ COMPATIBLE' : '❌ BREAKING CHANGES DETECTED'}`);
    
    // Also test that Context validation doesn't interfere with non-Context apps
    const hasContextErrors = result.feedback?.includes('Context');
    if (hasContextErrors) {
      console.log('\n⚠️  Context validation is interfering with non-Context apps!');
      return false;
    }
    
    return allPassed;
    
  } catch (error) {
    console.error('\n❌ Error during test:', error.message);
    return false;
  }
}

// Run test
testCompatibility()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });