import { ContextEnhancedGenerator } from './mcp-server/src/tools/context-enhanced-generator.js';

async function testTodoTask() {
  console.log('\n=== Testing TODO with Backend Task (Phase 4 Fixed) ===\n');
  
  const gen = new ContextEnhancedGenerator();
  
  try {
    const result = await gen.generateCode({
      task: 'create a TODO with backend',
      project_name: 'nextjs-test-project'
    });
    
    console.log('\n=== FINAL RESULT ===');
    console.log('Success:', result.success);
    console.log('Message:', result.message);
    
    if (result.subtasks) {
      console.log('\n=== SUBTASK RESULTS ===');
      result.subtasks.forEach((subtask, i) => {
        console.log(`${i + 1}. ${subtask.name}: ${subtask.success ? '✅ SUCCESS' : '❌ FAILED'}`);
        if (!subtask.success && subtask.error) {
          console.log(`   Error: ${subtask.error}`);
        }
      });
    }
    
    if (result.generatedCode) {
      console.log('\n=== FILES GENERATED ===');
      result.generatedCode.forEach(file => {
        console.log(`- ${file.path}`);
      });
    }
    
    if (result.buildResults) {
      console.log('\n=== BUILD RESULTS ===');
      console.log('Attempts:', result.buildResults.attempts);
      console.log('Success:', result.buildResults.success);
      if (result.buildResults.fixesApplied) {
        console.log('Fixes Applied:', result.buildResults.fixesApplied.join(', '));
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testTodoTask();