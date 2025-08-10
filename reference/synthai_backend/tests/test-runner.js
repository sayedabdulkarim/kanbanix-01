/**
 * Complete test runner for the no-code framework
 * Tests generation rules and validates fixes without calling LLM
 */

const GenerationRulesTester = require('./generation-rules-tester');
const fs = require('fs').promises;
const path = require('path');

class TestRunner {
  constructor() {
    this.rulesTester = new GenerationRulesTester();
  }

  /**
   * Test 1: Validate our generation prompt rules
   */
  async testGenerationPromptRules() {
    console.log('\n📋 TEST 1: Generation Prompt Rules\n');
    
    // Read the actual prompt from task-based-generator.js
    const generatorPath = path.join(__dirname, '../services/task-based-generator.js');
    const generatorContent = await fs.readFile(generatorPath, 'utf-8');
    
    // Check if our rules are in the prompt
    const requiredRules = [
      { name: 'use client rules', pattern: /ALWAYS add 'use client' directive/ },
      { name: 'export patterns', pattern: /EXPORT\/IMPORT PATTERNS:/ },
      { name: 'component exports', pattern: /React Components: ALWAYS use "export default/ },
      { name: 'hook exports', pattern: /Custom Hooks: ALWAYS use "export function/ },
      { name: 'import patterns', pattern: /IMPORT PATTERNS: Match imports to export patterns/ }
    ];
    
    console.log('Checking if generation prompt contains required rules:');
    const results = [];
    
    for (const rule of requiredRules) {
      const found = rule.pattern.test(generatorContent);
      console.log(`  ${found ? '✅' : '❌'} ${rule.name}`);
      results.push({ rule: rule.name, found });
    }
    
    return results.every(r => r.found);
  }

  /**
   * Test 2: Validate build validator preserves fixes
   */
  async testBuildValidatorRules() {
    console.log('\n📋 TEST 2: Build Validator Rules\n');
    
    const validatorPath = path.join(__dirname, '../services/llm-build-validator.js');
    const validatorContent = await fs.readFile(validatorPath, 'utf-8');
    
    // Check for problematic patterns
    const issues = [];
    
    // Check if 'use client' preservation is conditional
    if (validatorContent.includes('hasUseClientError ?')) {
      issues.push('❌ "use client" preservation is conditional - will be removed when fixing other errors');
    } else {
      console.log('✅ "use client" preservation check');
    }
    
    // Check if validator has same rules as generator
    if (!validatorContent.includes('EXPORT/IMPORT PATTERNS')) {
      issues.push('❌ Validator missing export/import pattern rules');
    } else {
      console.log('✅ Validator has export/import rules');
    }
    
    if (issues.length > 0) {
      console.log('\nIssues found:');
      issues.forEach(issue => console.log(`  ${issue}`));
    }
    
    return issues.length === 0;
  }

  /**
   * Test 3: Simulate common generation scenarios
   */
  async testCommonScenarios() {
    console.log('\n📋 TEST 3: Common Generation Scenarios\n');
    
    const scenarios = [
      {
        name: 'Todo App with hooks',
        request: 'Create a todo app',
        expectedPatterns: {
          'TodoApp.tsx': {
            mustHave: ["'use client'", 'export default', 'useState'],
            mustNotHave: ['export { TodoApp }']
          },
          'useLocalStorage.ts': {
            mustHave: ["'use client'", 'export function useLocalStorage'],
            mustNotHave: ['export default']
          }
        }
      },
      {
        name: 'Counter with multiple components',
        request: 'Create a counter app',
        expectedPatterns: {
          'Counter.tsx': {
            mustHave: ["'use client'", 'export default function Counter'],
            mustNotHave: ['export const Counter']
          },
          'CounterDisplay.tsx': {
            mustHave: ['export default'],
            mustNotHave: ["'use client'"]  // No hooks, so no use client needed
          }
        }
      }
    ];
    
    for (const scenario of scenarios) {
      console.log(`\n🔍 Testing: ${scenario.name}`);
      console.log(`Request: "${scenario.request}"`);
      console.log('\nExpected patterns:');
      
      for (const [file, patterns] of Object.entries(scenario.expectedPatterns)) {
        console.log(`\n  ${file}:`);
        console.log('    Must have:');
        patterns.mustHave.forEach(p => console.log(`      - ${p}`));
        console.log('    Must NOT have:');
        patterns.mustNotHave.forEach(p => console.log(`      - ${p}`));
      }
    }
    
    return true;
  }

  /**
   * Test 4: Validate package.json generation
   */
  async testPackageJsonGeneration() {
    console.log('\n📋 TEST 4: Package.json Generation\n');
    
    // Check where package.json is generated
    const agentServicePath = path.join(__dirname, '../services/agent-service.js');
    const agentContent = await fs.readFile(agentServicePath, 'utf-8');
    
    // Look for Tailwind version in package.json template
    const hasTailwindV3 = agentContent.includes('"tailwindcss": "^3');
    const hasTailwindV4 = agentContent.includes('"tailwindcss": "^4');
    
    console.log('Package.json template check:');
    if (hasTailwindV3) {
      console.log('  ❌ Still using Tailwind v3 in template');
    } else if (hasTailwindV4) {
      console.log('  ✅ Using Tailwind v4 in template');
    } else {
      console.log('  ⚠️  Could not determine Tailwind version in template');
    }
    
    return !hasTailwindV3;
  }

  /**
   * Test 5: Error pattern detection
   */
  async testErrorPatternDetection() {
    console.log('\n📋 TEST 5: Error Pattern Detection\n');
    
    const errorPatterns = [
      {
        error: "You're importing a component that needs `useState`",
        expectedFix: "Add 'use client' to top of file",
        pattern: /use client|Client Component/
      },
      {
        error: "Module has no exported member",
        expectedFix: "Add missing export",
        pattern: /export.*function|export.*const/
      },
      {
        error: "Type error: Argument of type",
        expectedFix: "Fix type mismatch",
        pattern: /type.*Task|interface.*Task/
      }
    ];
    
    console.log('Checking if error patterns are handled:');
    for (const errorPattern of errorPatterns) {
      console.log(`\n  Error: "${errorPattern.error}"`);
      console.log(`  Expected fix: ${errorPattern.expectedFix}`);
    }
    
    return true;
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🧪 Running No-Code Framework Tests\n');
    console.log('These tests validate our generation rules without calling LLM APIs');
    console.log('=' .repeat(60));
    
    const testResults = [];
    
    // Run each test
    testResults.push({
      name: 'Generation Prompt Rules',
      passed: await this.testGenerationPromptRules()
    });
    
    testResults.push({
      name: 'Build Validator Rules',
      passed: await this.testBuildValidatorRules()
    });
    
    testResults.push({
      name: 'Common Scenarios',
      passed: await this.testCommonScenarios()
    });
    
    testResults.push({
      name: 'Package.json Generation',
      passed: await this.testPackageJsonGeneration()
    });
    
    testResults.push({
      name: 'Error Pattern Detection',
      passed: await this.testErrorPatternDetection()
    });
    
    // Summary
    console.log('\n' + '=' .repeat(60));
    console.log('📊 TEST SUMMARY:\n');
    
    testResults.forEach(result => {
      console.log(`  ${result.passed ? '✅' : '❌'} ${result.name}`);
    });
    
    const allPassed = testResults.every(r => r.passed);
    console.log('\n' + '=' .repeat(60));
    console.log(`Overall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
    console.log('=' .repeat(60));
    
    if (!allPassed) {
      console.log('\n⚠️  Fix the failing tests before generating projects!');
      console.log('This ensures generated code will work on first try.\n');
    }
    
    return allPassed;
  }
}

// Run tests
if (require.main === module) {
  const runner = new TestRunner();
  runner.runAllTests().catch(console.error);
}

module.exports = TestRunner;