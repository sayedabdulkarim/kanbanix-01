/**
 * Unit tests for agent-service with mocked dependencies
 */

const path = require('path');
const fs = require('fs').promises;

// Set a mock API key for testing
process.env.OPENROUTER_API_KEY = 'mock-api-key-for-testing';

class AgentServiceMockTests {
  constructor() {
    this.results = [];
    this.tempDir = path.join(__dirname, '../../temp/test');
  }

  /**
   * Test 1: Check if agent-service loads correctly
   */
  async testServiceLoading() {
    console.log('\n📋 Test 1: Service Loading\n');
    
    try {
      // Clear require cache to ensure fresh load
      delete require.cache[require.resolve('../services/agent-service')];
      delete require.cache[require.resolve('../services/llm-service')];
      delete require.cache[require.resolve('../services/task-based-generator')];
      
      const { AgentService } = require('../services/agent-service');
      const service = new AgentService();
      
      // Check if service has required properties
      const hasTaskGenerator = !!service.taskGenerator;
      const hasLLMService = !!service.llmService;
      const hasProcessRequirement = typeof service.processRequirement === 'function';
      
      console.log(`✅ Service instantiated successfully`);
      console.log(`${hasTaskGenerator ? '✅' : '❌'} Has taskGenerator property`);
      console.log(`${hasLLMService ? '✅' : '❌'} Has llmService property`);
      console.log(`${hasProcessRequirement ? '✅' : '❌'} Has processRequirement method`);
      
      return {
        name: 'Service Loading',
        passed: hasTaskGenerator && hasLLMService && hasProcessRequirement,
        details: { hasTaskGenerator, hasLLMService, hasProcessRequirement }
      };
    } catch (error) {
      console.error('❌ Failed to load service:', error.message);
      return {
        name: 'Service Loading',
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * Test 2: Test project type determination
   */
  async testProjectTypeDetermination() {
    console.log('\n📋 Test 2: Project Type Determination\n');
    
    try {
      const { AgentService } = require('../services/agent-service');
      const service = new AgentService();
      
      const testCases = [
        { input: 'Create a counter app', expected: 'counter-app' },
        { input: 'Build a todo list', expected: 'todo-app' },
        { input: 'Make a task manager', expected: 'todo-app' },
        { input: 'Create a blog', expected: 'blog-app' },
        { input: 'Build a dashboard', expected: 'dashboard-app' },
        { input: 'Create a website', expected: 'web-app' }
      ];
      
      let allPassed = true;
      
      for (const test of testCases) {
        const result = service._determineProjectType(test.input);
        const passed = result === test.expected;
        allPassed = allPassed && passed;
        
        console.log(`${passed ? '✅' : '❌'} "${test.input}" -> ${result} (expected: ${test.expected})`);
      }
      
      return {
        name: 'Project Type Determination',
        passed: allPassed,
        details: testCases
      };
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      return {
        name: 'Project Type Determination',
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * Test 3: Test file collection method
   */
  async testFileCollection() {
    console.log('\n📋 Test 3: File Collection\n');
    
    try {
      const { AgentService } = require('../services/agent-service');
      const service = new AgentService();
      
      // Create test directory structure
      const testPath = path.join(this.tempDir, 'file-collection-test');
      await fs.mkdir(testPath, { recursive: true });
      
      // Create test files
      const testFiles = {
        'index.js': 'console.log("test");',
        'src/app.js': 'export default App;',
        'src/components/Test.jsx': 'export default Test;'
      };
      
      // Create directory structure
      await fs.mkdir(path.join(testPath, 'src'), { recursive: true });
      await fs.mkdir(path.join(testPath, 'src/components'), { recursive: true });
      
      // Write test files
      for (const [filePath, content] of Object.entries(testFiles)) {
        await fs.writeFile(path.join(testPath, filePath), content);
      }
      
      // Test file collection
      const collected = await service._collectGeneratedFiles(testPath, []);
      
      // Check results
      const expectedKeys = ['/index.js', '/src/app.js', '/src/components/Test.jsx'];
      const hasAllFiles = expectedKeys.every(key => collected[key] !== undefined);
      const correctContent = collected['/index.js'] === 'console.log("test");';
      
      console.log(`${hasAllFiles ? '✅' : '❌'} Collected all files`);
      console.log(`${correctContent ? '✅' : '❌'} Content preserved correctly`);
      console.log(`Files found: ${Object.keys(collected).join(', ')}`);
      
      // Cleanup
      await fs.rm(testPath, { recursive: true, force: true });
      
      return {
        name: 'File Collection',
        passed: hasAllFiles && correctContent,
        details: { filesCollected: Object.keys(collected).length }
      };
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      return {
        name: 'File Collection',
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * Test 4: Mock processRequirement flow
   */
  async testProcessRequirementFlow() {
    console.log('\n📋 Test 4: Process Requirement Flow (Mocked)\n');
    
    try {
      const { AgentService } = require('../services/agent-service');
      const service = new AgentService();
      
      // Mock the task generator to avoid actual API calls
      let prdGenerated = false;
      let projectGenerated = false;
      
      service.taskGenerator = {
        generatePRD: async (req) => {
          prdGenerated = true;
          return `# PRD\n\nRequirement: ${req}`;
        },
        generateProject: async (prd, path) => {
          projectGenerated = true;
          // Create a mock file to test collection
          await fs.mkdir(path, { recursive: true });
          await fs.writeFile(path + '/test.js', 'test content');
          
          return {
            tasks: [{ name: 'Mock Task', completed: true }],
            summary: 'Mock generation complete',
            generatedFiles: [{ path: 'test.js' }]
          };
        }
      };
      
      // Test the flow
      const result = await service.processRequirement('Create a test app');
      
      // Verify flow execution
      console.log(`${prdGenerated ? '✅' : '❌'} PRD generation called`);
      console.log(`${projectGenerated ? '✅' : '❌'} Project generation called`);
      console.log(`${result.files ? '✅' : '❌'} Files returned`);
      console.log(`${result.analysis ? '✅' : '❌'} Analysis returned`);
      console.log(`${result.plan ? '✅' : '❌'} Plan returned`);
      
      const hasCorrectStructure = result.files && result.analysis && result.plan;
      
      return {
        name: 'Process Requirement Flow',
        passed: prdGenerated && projectGenerated && hasCorrectStructure,
        details: { 
          prdGenerated, 
          projectGenerated, 
          resultKeys: Object.keys(result || {})
        }
      };
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      return {
        name: 'Process Requirement Flow',
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * Test 5: Error handling
   */
  async testErrorHandling() {
    console.log('\n📋 Test 5: Error Handling\n');
    
    try {
      const { AgentService } = require('../services/agent-service');
      const service = new AgentService();
      
      // Mock task generator to throw error
      service.taskGenerator = {
        generatePRD: async () => {
          throw new Error('Mock PRD error');
        }
      };
      
      let errorCaught = false;
      let errorMessage = '';
      
      try {
        await service.processRequirement('Test requirement');
      } catch (error) {
        errorCaught = true;
        errorMessage = error.message;
      }
      
      console.log(`${errorCaught ? '✅' : '❌'} Error properly caught`);
      console.log(`${errorMessage.includes('Failed to process requirement') ? '✅' : '❌'} Error message wrapped correctly`);
      
      return {
        name: 'Error Handling',
        passed: errorCaught && errorMessage.includes('Failed to process requirement'),
        details: { errorMessage }
      };
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      return {
        name: 'Error Handling',
        passed: false,
        error: error.message
      };
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('\n' + '='.repeat(50));
    console.log('🧪 AGENT SERVICE UNIT TESTS (MOCKED)');
    console.log('='.repeat(50));
    
    // Ensure temp directory exists
    await fs.mkdir(this.tempDir, { recursive: true });
    
    const tests = [
      this.testServiceLoading(),
      this.testProjectTypeDetermination(),
      this.testFileCollection(),
      this.testProcessRequirementFlow(),
      this.testErrorHandling()
    ];
    
    // Run all tests
    for (const testPromise of tests) {
      const result = await testPromise;
      this.results.push(result);
    }
    
    // Cleanup temp directory
    await fs.rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(50));
    
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    
    this.results.forEach(result => {
      console.log(`${result.passed ? '✅' : '❌'} ${result.name}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });
    
    console.log(`\nTotal: ${passed}/${total} tests passed`);
    console.log('='.repeat(50));
    
    // Clean up mock env var
    delete process.env.OPENROUTER_API_KEY;
    
    return {
      passed,
      total,
      results: this.results,
      success: passed === total
    };
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new AgentServiceMockTests();
  
  tester.runAllTests()
    .then(summary => {
      console.log(`\nTests ${summary.success ? 'PASSED ✅' : 'FAILED ❌'}`);
      process.exit(summary.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}

module.exports = AgentServiceMockTests;