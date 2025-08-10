/**
 * Quick validation test for TODO app
 * Focuses on validation without build step
 */

const { AgentService } = require('../services/agent-service');

async function testTodoValidation() {
  console.log('=== TODO APP VALIDATION TEST ===\n');
  
  const agentService = new AgentService();
  
  try {
    console.log('Generating TODO app...');
    const result = await agentService.processRequirement(
      "Create a TODO app where users can add, complete, and delete tasks"
    );
    
    console.log(`\n✓ Generated ${Object.keys(result.files).length} files`);
    
    // Check validation feedback
    if (result.feedback) {
      console.log('\n⚠ Validation feedback:');
      console.log(result.feedback);
      return false;
    } else {
      console.log('\n✅ No validation errors!');
    }
    
    // Quick checks
    const contextFile = Object.keys(result.files).find(f => 
      f.toLowerCase().includes('context') && f.includes('todo')
    );
    
    if (contextFile) {
      const content = result.files[contextFile];
      console.log(`\n✓ Context file: ${contextFile}`);
      console.log(`  - Has TodoContext: ${content.includes('export const TodoContext') ? '✓' : '✗'}`);
      console.log(`  - Has useTodoContext: ${content.includes('export function useTodoContext') ? '✓' : '✗'}`);
      console.log(`  - Has TodoProvider: ${content.includes('Provider') ? '✓' : '✗'}`);
    }
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    return false;
  }
}

// Run test with timeout
const timeout = setTimeout(() => {
  console.log('\n⏱ Test timed out after 30 seconds');
  process.exit(1);
}, 30000);

testTodoValidation()
  .then(success => {
    clearTimeout(timeout);
    console.log(success ? '\n✅ Validation test passed!' : '\n❌ Validation test failed');
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    clearTimeout(timeout);
    console.error('Test error:', error);
    process.exit(1);
  });