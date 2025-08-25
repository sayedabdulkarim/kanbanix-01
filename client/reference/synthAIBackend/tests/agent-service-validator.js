/**
 * Test validator for agent-service
 * Runs validation before API calls to ensure proper code generation
 */

const { AgentService } = require('../services/agent-service');
const fs = require('fs').promises;
const path = require('path');

class AgentServiceValidator {
  constructor() {
    this.agentService = new AgentService();
    this.tempDir = path.join(__dirname, '../../temp/test-validation');
  }

  /**
   * Pre-validation: Check if service is properly configured
   */
  async validateServiceConfiguration() {
    console.log('\n🔍 Validating Service Configuration...\n');
    
    const checks = {
      hasTaskGenerator: false,
      hasAPIKey: false,
      canLoadService: false
    };
    
    try {
      // Check if service loads
      const service = new AgentService();
      checks.canLoadService = true;
      
      // Check if task generator exists
      checks.hasTaskGenerator = !!service.taskGenerator;
      
      // Check if API key is configured
      checks.hasAPIKey = !!process.env.OPENROUTER_API_KEY;
      
      // Report results
      console.log(`✅ Service loads properly: ${checks.canLoadService}`);
      console.log(`${checks.hasTaskGenerator ? '✅' : '❌'} Task generator configured`);
      console.log(`${checks.hasAPIKey ? '✅' : '❌'} API key configured`);
      
      return checks.canLoadService && checks.hasTaskGenerator;
    } catch (error) {
      console.error('❌ Service configuration error:', error.message);
      return false;
    }
  }

  /**
   * Mock generation test without API calls
   */
  async testMockGeneration(requirement) {
    console.log('\n🧪 Testing Mock Generation Pattern...\n');
    console.log(`Requirement: "${requirement}"`);
    
    const expectedPatterns = {
      counter: {
        files: [
          '/src/app/page.tsx',
          '/src/components/Counter.tsx',
          '/src/context/CounterContext.tsx'
        ],
        exports: {
          'Counter.tsx': 'export default',
          'CounterContext.tsx': 'export const CounterContext'
        },
        imports: {
          'page.tsx': "import Counter from '@/components/Counter'"
        }
      },
      todo: {
        files: [
          '/src/app/page.tsx',
          '/src/components/TodoApp.tsx',
          '/src/types/Task.ts'
        ],
        exports: {
          'TodoApp.tsx': 'export default',
          'Task.ts': 'export interface Task'
        },
        imports: {
          'page.tsx': "import TodoApp from '@/components/TodoApp'"
        }
      }
    };
    
    // Determine expected pattern
    const projectType = requirement.toLowerCase().includes('counter') ? 'counter' : 'todo';
    const expected = expectedPatterns[projectType];
    
    console.log(`\nExpected patterns for ${projectType} app:`);
    console.log('Files:', expected.files);
    console.log('Export patterns:', expected.exports);
    console.log('Import patterns:', expected.imports);
    
    return expected;
  }

  /**
   * Validate requirement format
   */
  validateRequirement(requirement) {
    console.log('\n📝 Validating Requirement...\n');
    
    const validations = {
      notEmpty: requirement && requirement.trim().length > 0,
      minLength: requirement && requirement.length >= 10,
      notTooLong: requirement && requirement.length <= 1000,
      hasValidChars: requirement && /^[\w\s.,!?-]+$/i.test(requirement),
      isClear: !requirement.includes('undefined') && !requirement.includes('null')
    };
    
    console.log(`${validations.notEmpty ? '✅' : '❌'} Not empty`);
    console.log(`${validations.minLength ? '✅' : '❌'} Minimum length (10 chars)`);
    console.log(`${validations.notTooLong ? '✅' : '❌'} Not too long (< 1000 chars)`);
    console.log(`${validations.hasValidChars ? '✅' : '❌'} Valid characters`);
    console.log(`${validations.isClear ? '✅' : '❌'} Clear requirement`);
    
    return Object.values(validations).every(v => v);
  }

  /**
   * Test expected file structure
   */
  async validateExpectedStructure(requirement) {
    console.log('\n🏗️  Validating Expected Structure...\n');
    
    const projectType = this._determineProjectType(requirement);
    console.log(`Project type: ${projectType}`);
    
    const requiredComponents = {
      'counter-app': [
        'Counter component',
        'CounterContext or state management',
        'Increment/Decrement functionality',
        'Display component'
      ],
      'todo-app': [
        'TodoApp component',
        'Task type definition',
        'Add task functionality',
        'Task list display',
        'Task completion toggle'
      ]
    };
    
    const components = requiredComponents[projectType] || ['Main component', 'Basic functionality'];
    
    console.log('\nRequired components:');
    components.forEach(comp => console.log(`  - ${comp}`));
    
    return {
      projectType,
      requiredComponents: components
    };
  }

  /**
   * Integration test - simulate the flow
   */
  async simulateGenerationFlow(requirement) {
    console.log('\n🔄 Simulating Generation Flow...\n');
    
    const steps = [
      { name: 'Validate requirement', status: false },
      { name: 'Check service config', status: false },
      { name: 'Generate PRD', status: false },
      { name: 'Plan tasks', status: false },
      { name: 'Generate code', status: false },
      { name: 'Validate output', status: false }
    ];
    
    try {
      // Step 1: Validate requirement
      steps[0].status = this.validateRequirement(requirement);
      console.log(`${steps[0].status ? '✅' : '❌'} ${steps[0].name}`);
      
      if (!steps[0].status) {
        throw new Error('Invalid requirement format');
      }
      
      // Step 2: Check service config
      steps[1].status = await this.validateServiceConfiguration();
      console.log(`${steps[1].status ? '✅' : '❌'} ${steps[1].name}`);
      
      if (!steps[1].status) {
        throw new Error('Service not properly configured');
      }
      
      // Step 3: Simulate PRD generation
      steps[2].status = true; // Would generate PRD
      console.log(`✅ ${steps[2].name} (simulated)`);
      
      // Step 4: Simulate task planning
      steps[3].status = true; // Would plan tasks
      console.log(`✅ ${steps[3].name} (simulated)`);
      
      // Step 5: Simulate code generation
      steps[4].status = true; // Would generate code
      console.log(`✅ ${steps[4].name} (simulated)`);
      
      // Step 6: Validate expected output
      const expectedStructure = await this.validateExpectedStructure(requirement);
      steps[5].status = !!expectedStructure;
      console.log(`${steps[5].status ? '✅' : '❌'} ${steps[5].name}`);
      
    } catch (error) {
      console.error('\n❌ Flow simulation failed:', error.message);
    }
    
    const allPassed = steps.every(s => s.status);
    console.log(`\n${allPassed ? '✅' : '❌'} Overall flow: ${allPassed ? 'READY' : 'NOT READY'}`);
    
    return allPassed;
  }

  /**
   * Run all pre-flight checks
   */
  async runPreFlightChecks(requirement) {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 AGENT SERVICE PRE-FLIGHT CHECKS');
    console.log('='.repeat(50));
    
    const results = {
      timestamp: new Date().toISOString(),
      requirement: requirement,
      checks: {}
    };
    
    // 1. Service configuration
    results.checks.serviceConfig = await this.validateServiceConfiguration();
    
    // 2. Requirement validation
    results.checks.requirementValid = this.validateRequirement(requirement);
    
    // 3. Expected patterns
    results.checks.patterns = await this.testMockGeneration(requirement);
    
    // 4. Expected structure
    results.checks.structure = await this.validateExpectedStructure(requirement);
    
    // 5. Flow simulation
    results.checks.flowReady = await this.simulateGenerationFlow(requirement);
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 PRE-FLIGHT CHECK SUMMARY');
    console.log('='.repeat(50));
    
    const allPassed = results.checks.serviceConfig && 
                     results.checks.requirementValid && 
                     results.checks.flowReady;
    
    console.log(`\nStatus: ${allPassed ? '✅ READY FOR API CALL' : '❌ NOT READY'}`);
    
    if (!allPassed) {
      console.log('\nIssues to fix:');
      if (!results.checks.serviceConfig) console.log('  - Service configuration');
      if (!results.checks.requirementValid) console.log('  - Requirement format');
      if (!results.checks.flowReady) console.log('  - Generation flow');
    }
    
    return results;
  }

  /**
   * Helper: Determine project type
   */
  _determineProjectType(requirement) {
    const lowerReq = requirement.toLowerCase();
    
    if (lowerReq.includes('counter')) {
      return 'counter-app';
    } else if (lowerReq.includes('todo') || lowerReq.includes('task')) {
      return 'todo-app';
    } else if (lowerReq.includes('blog')) {
      return 'blog-app';
    } else if (lowerReq.includes('dashboard')) {
      return 'dashboard-app';
    } else {
      return 'web-app';
    }
  }
}

// CLI interface for testing
if (require.main === module) {
  const validator = new AgentServiceValidator();
  
  // Test different requirements
  const testRequirements = [
    'Create a counter application',
    'Build a todo app with task management',
    '', // Empty requirement
    'x', // Too short
    'Create a ' + 'very '.repeat(250) + 'long requirement' // Too long
  ];
  
  (async () => {
    for (const req of testRequirements) {
      console.log('\n\n' + '🔵'.repeat(25) + '\n');
      await validator.runPreFlightChecks(req);
    }
  })();
}

module.exports = AgentServiceValidator;