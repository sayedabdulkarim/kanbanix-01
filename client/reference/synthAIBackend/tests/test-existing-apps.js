/**
 * Test to ensure existing app patterns still work after changes
 */

const { AgentService } = require('../services/agent-service');

async function testExistingApps() {
  console.log('=== TESTING EXISTING APP PATTERNS ===\n');
  
  const testCases = [
    {
      name: "Simple Counter",
      requirement: "Create a counter app with increment and decrement buttons"
    },
    {
      name: "Hello World",
      requirement: "Create a simple hello world app"
    },
    {
      name: "Basic Form",
      requirement: "Create a contact form with name and email fields"
    }
  ];
  
  const agentService = new AgentService();
  const results = [];
  
  for (const test of testCases) {
    console.log(`Testing: ${test.name}`);
    
    try {
      const result = await agentService.processRequirement(test.requirement);
      
      // Check basic requirements
      const checks = {
        hasFiles: Object.keys(result.files).length > 0,
        hasLayout: !!result.files['/src/app/layout.tsx'],
        hasPackageJson: !!result.files['/package.json'],
        hasPage: !!result.files['/src/app/page.tsx'],
        noErrors: !result.feedback
      };
      
      const passed = Object.values(checks).every(v => v);
      
      console.log(`  Files generated: ${Object.keys(result.files).length}`);
      console.log(`  Has layout: ${checks.hasLayout ? '✓' : '✗'}`);
      console.log(`  Has package.json: ${checks.hasPackageJson ? '✓' : '✗'}`);
      console.log(`  No validation errors: ${checks.noErrors ? '✓' : '✗'}`);
      console.log(`  Result: ${passed ? '✅ PASSED' : '❌ FAILED'}\n`);
      
      results.push({ name: test.name, passed });
      
    } catch (error) {
      console.log(`  ❌ ERROR: ${error.message}\n`);
      results.push({ name: test.name, passed: false, error: error.message });
    }
  }
  
  // Summary
  console.log('=== SUMMARY ===');
  const passed = results.filter(r => r.passed).length;
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${results.length - passed}`);
  
  return passed === results.length;
}

// Simple mock responses
function mockSimpleApp(prompt, appType) {
  if (prompt.includes('Create a detailed task list')) {
    return JSON.stringify({
      tasks: [{
        id: "task-1",
        name: `Create ${appType} component`,
        description: `Create the main ${appType} component`,
        files: [`src/components/${appType}.tsx`],
        priority: 1
      }]
    });
  }
  
  if (prompt.includes(`Create ${appType} component`)) {
    return JSON.stringify({
      files: [{
        path: `src/components/${appType}.tsx`,
        content: `'use client';\n\nexport default function ${appType}() {\n  return <div>${appType} Component</div>;\n}`
      }],
      description: `Created ${appType} component`
    });
  }
  
  return '{}';
}

// Run test
if (require.main === module) {
  testExistingApps()
    .then(success => {
      console.log(success ? '\n✅ All existing patterns work!' : '\n❌ Some patterns broken!');
      process.exit(success ? 0 : 1);
    })
    .catch(console.error);
}

module.exports = { testExistingApps };