/**
 * Test generation rules without calling LLM
 * This helps ensure our prompts will generate correct code
 */

class GenerationRulesTester {
  constructor() {
    this.rules = this.loadGenerationRules();
  }

  /**
   * Extract rules from our generation prompts
   */
  loadGenerationRules() {
    return {
      useClientRules: [
        { condition: 'uses useState', mustHave: "'use client' at top" },
        { condition: 'uses useEffect', mustHave: "'use client' at top" },
        { condition: 'has onClick handler', mustHave: "'use client' at top" },
        { condition: 'has onChange handler', mustHave: "'use client' at top" },
        { condition: 'uses any React hook', mustHave: "'use client' at top" },
      ],
      exportRules: [
        { fileType: 'component', pattern: 'export default function ComponentName' },
        { fileType: 'hook', pattern: 'export function useHookName' },
        { fileType: 'context', pattern: 'export const ContextName = createContext' },
        { fileType: 'type', pattern: 'export interface/type TypeName' },
        { fileType: 'util', pattern: 'export function functionName' },
      ],
      importRules: [
        { exportType: 'default', pattern: "import Component from './Component'" },
        { exportType: 'named', pattern: "import { function } from './utils'" },
      ],
      typeConsistency: [
        { rule: 'All Task interfaces must have same properties' },
        { rule: 'Use consistent property names (completed, not isCompleted)' },
        { rule: 'Use consistent ID types (string, not number)' },
      ]
    };
  }

  /**
   * Test if a code snippet follows our rules
   */
  testCodeSnippet(code, fileType, fileName) {
    const issues = [];
    const passes = [];

    // Test use client rules
    const needsUseClient = 
      code.includes('useState') ||
      code.includes('useEffect') ||
      code.includes('onClick') ||
      code.includes('onChange') ||
      /use[A-Z]\w+/.test(code);  // Any hook

    if (needsUseClient) {
      if (code.startsWith("'use client'") || code.startsWith('"use client"')) {
        passes.push("✓ Has 'use client' directive");
      } else {
        issues.push("✗ Missing 'use client' directive");
      }
    }

    // Test export patterns
    if (fileType === 'component') {
      if (/export default (function|const) \w+/.test(code)) {
        passes.push("✓ Component uses default export");
      } else {
        issues.push("✗ Component should use default export");
      }
    }

    if (fileType === 'hook' && fileName.startsWith('use')) {
      if (/export (function|const) use\w+/.test(code)) {
        passes.push("✓ Hook uses named export");
      } else {
        issues.push("✗ Hook should use named export");
      }
    }

    return { issues, passes };
  }

  /**
   * Simulate what our prompts should generate
   */
  generateMockCode(componentName, features = []) {
    let code = '';
    
    // Determine if needs use client
    const needsUseClient = features.some(f => 
      ['state', 'effect', 'event', 'hook'].includes(f)
    );

    if (needsUseClient) {
      code += "'use client';\n\n";
    }

    // Add imports based on features
    if (features.includes('state')) {
      code += "import { useState } from 'react';\n";
    }
    if (features.includes('effect')) {
      code += "import { useEffect } from 'react';\n";
    }
    if (features.includes('types')) {
      code += "import type { Task } from '@/types/Task';\n";
    }

    code += '\n';

    // Generate component
    code += `export default function ${componentName}() {\n`;
    
    if (features.includes('state')) {
      code += "  const [value, setValue] = useState('');\n\n";
    }

    code += "  return (\n";
    code += "    <div>\n";
    code += `      <h1>${componentName}</h1>\n`;
    
    if (features.includes('event')) {
      code += "      <button onClick={() => console.log('clicked')}>Click me</button>\n";
    }
    
    code += "    </div>\n";
    code += "  );\n";
    code += "}\n";

    return code;
  }

  /**
   * Test common scenarios
   */
  runScenarioTests() {
    console.log('🧪 Testing Generation Rules\n');

    const scenarios = [
      {
        name: 'Counter Component',
        component: 'Counter',
        features: ['state', 'event'],
        fileType: 'component'
      },
      {
        name: 'Static Display Component',
        component: 'Header',
        features: [],
        fileType: 'component'
      },
      {
        name: 'Custom Hook',
        component: 'useLocalStorage',
        features: ['state', 'effect'],
        fileType: 'hook'
      },
      {
        name: 'Todo List Component',
        component: 'TodoList',
        features: ['state', 'effect', 'event', 'types'],
        fileType: 'component'
      }
    ];

    const results = [];

    for (const scenario of scenarios) {
      console.log(`\n📋 ${scenario.name}:`);
      
      const mockCode = this.generateMockCode(scenario.component, scenario.features);
      const testResult = this.testCodeSnippet(mockCode, scenario.fileType, scenario.component);
      
      console.log('\nGenerated Code:');
      console.log('-'.repeat(40));
      console.log(mockCode);
      console.log('-'.repeat(40));
      
      console.log('\nValidation Results:');
      testResult.passes.forEach(p => console.log(`  ${p}`));
      testResult.issues.forEach(i => console.log(`  ${i}`));
      
      results.push({
        scenario: scenario.name,
        passed: testResult.issues.length === 0
      });
    }

    console.log('\n' + '='.repeat(50));
    console.log('Summary:');
    console.log(`Total scenarios: ${results.length}`);
    console.log(`Passed: ${results.filter(r => r.passed).length}`);
    console.log(`Failed: ${results.filter(r => !r.passed).length}`);
    console.log('='.repeat(50));

    return results;
  }

  /**
   * Generate test cases for prompt validation
   */
  generatePromptTestCases() {
    return {
      todoApp: {
        expectedFiles: [
          { path: 'src/components/TodoApp.tsx', needsUseClient: true },
          { path: 'src/types/Task.ts', needsUseClient: false },
          { path: 'src/lib/dateUtils.ts', needsUseClient: false },
          { path: 'src/hooks/useLocalStorage.ts', needsUseClient: true }
        ],
        expectedExports: {
          'TodoApp.tsx': 'default',
          'Task.ts': 'named',
          'dateUtils.ts': 'named',
          'useLocalStorage.ts': 'named'
        }
      },
      counterApp: {
        expectedFiles: [
          { path: 'src/components/Counter.tsx', needsUseClient: true },
          { path: 'src/components/CounterButtons.tsx', needsUseClient: true },
          { path: 'src/components/CounterDisplay.tsx', needsUseClient: false }
        ],
        expectedExports: {
          'Counter.tsx': 'default',
          'CounterButtons.tsx': 'default',
          'CounterDisplay.tsx': 'default'
        }
      }
    };
  }
}

// Export for use in other tests
module.exports = GenerationRulesTester;

// Run if called directly
if (require.main === module) {
  const tester = new GenerationRulesTester();
  tester.runScenarioTests();
  
  console.log('\n\n📝 Test Cases for Prompt Validation:');
  console.log(JSON.stringify(tester.generatePromptTestCases(), null, 2));
}