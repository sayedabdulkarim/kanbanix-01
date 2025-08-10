/**
 * Test for complex app patterns that use Context API and multi-component state sharing
 * This reproduces the TODO app issue and tests for similar patterns
 */

const { AgentService } = require('../services/agent-service');
const fs = require('fs').promises;
const path = require('path');

// ANSI color codes for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

async function testComplexPatterns() {
  console.log(`${colors.blue}=== TESTING COMPLEX APP PATTERNS ===${colors.reset}\n`);
  
  const testCases = [
    {
      name: "TODO App with Context",
      requirement: "Create a TODO app where users can add, complete, and delete tasks",
      expectedPatterns: {
        contextExports: ['Context', 'use', 'Provider'],
        fileStructure: [
          '/src/context/TodoContext.tsx',
          '/src/components/TodoList.tsx',
          '/src/components/TodoItem.tsx',
          '/src/components/TodoInput.tsx'
        ],
        importPatterns: [
          { file: 'TodoList', imports: ['TodoContext', 'useTodoContext'] },
          { file: 'TodoItem', imports: ['TodoContext', 'useTodoContext'] }
        ]
      }
    },
    {
      name: "Shopping Cart with Context",
      requirement: "Create a shopping cart where users can add items, update quantities, and remove items",
      expectedPatterns: {
        contextExports: ['Context', 'use', 'Provider'],
        fileStructure: [
          '/src/context/CartContext.tsx',
          '/src/components/CartList.tsx',
          '/src/components/CartItem.tsx',
          '/src/components/AddToCart.tsx'
        ],
        importPatterns: [
          { file: 'CartList', imports: ['CartContext', 'useCartContext'] },
          { file: 'CartItem', imports: ['CartContext', 'useCartContext'] }
        ]
      }
    }
  ];
  
  const agentService = new AgentService();
  const results = [];
  
  for (const testCase of testCases) {
    console.log(`${colors.yellow}Testing: ${testCase.name}${colors.reset}`);
    console.log(`Requirement: "${testCase.requirement}"\n`);
    
    try {
      // Process the requirement
      const result = await agentService.processRequirement(testCase.requirement);
      
      const testResult = {
        name: testCase.name,
        passed: true,
        errors: []
      };
      
      // Check if files were generated
      if (!result.files || Object.keys(result.files).length === 0) {
        testResult.passed = false;
        testResult.errors.push('No files generated');
      }
      
      // Find context file
      const contextFile = Object.keys(result.files).find(f => 
        f.toLowerCase().includes('context') && 
        (f.endsWith('.tsx') || f.endsWith('.ts'))
      );
      
      if (!contextFile) {
        testResult.passed = false;
        testResult.errors.push('No context file found');
      } else {
        const contextContent = result.files[contextFile];
        console.log(`\nFound context file: ${contextFile}`);
        
        // Check for required exports in context
        const contextName = contextFile.includes('Todo') ? 'Todo' : 
                           contextFile.includes('Cart') ? 'Cart' : 'Unknown';
        
        // Check for Context export
        const hasContextExport = contextContent.includes(`export const ${contextName}Context`) ||
                                contextContent.includes(`export { ${contextName}Context`);
        
        // Check for useContext hook export
        const hasUseHook = contextContent.includes(`export function use${contextName}Context`) ||
                          contextContent.includes(`export const use${contextName}Context`) ||
                          contextContent.includes(`export { use${contextName}Context`);
        
        // Check for Provider export
        const hasProvider = contextContent.includes(`export function ${contextName}Provider`) ||
                           contextContent.includes(`export const ${contextName}Provider`) ||
                           contextContent.includes(`Provider`);
        
        console.log(`  Context exports:`);
        console.log(`    - ${contextName}Context: ${hasContextExport ? '✓' : '✗'}`);
        console.log(`    - use${contextName}Context: ${hasUseHook ? '✓' : '✗'}`);
        console.log(`    - Provider: ${hasProvider ? '✓' : '✗'}`);
        
        if (!hasContextExport) {
          testResult.passed = false;
          testResult.errors.push(`Missing ${contextName}Context export`);
        }
        if (!hasUseHook) {
          testResult.passed = false;
          testResult.errors.push(`Missing use${contextName}Context export`);
        }
        if (!hasProvider) {
          testResult.passed = false;
          testResult.errors.push('Missing Provider export');
        }
      }
      
      // Check component imports
      console.log('\n  Component imports:');
      const componentFiles = Object.keys(result.files).filter(f => 
        f.includes('/components/') && 
        (f.endsWith('.tsx') || f.endsWith('.jsx'))
      );
      
      for (const compFile of componentFiles) {
        const content = result.files[compFile];
        const fileName = path.basename(compFile, path.extname(compFile));
        
        // Check if component imports from context
        const importsContext = content.includes('from \'@/context/') || 
                              content.includes('from "@/context/') ||
                              content.includes('from \'../context/') ||
                              content.includes('from "../context/');
        
        if (importsContext) {
          // Check what's being imported
          const importMatch = content.match(/import\s*{([^}]+)}\s*from\s*['"].*context/i);
          if (importMatch) {
            const imports = importMatch[1].split(',').map(i => i.trim());
            console.log(`    ${fileName}: imports [${imports.join(', ')}]`);
            
            // Check if imports match exports
            if (contextFile && result.files[contextFile]) {
              for (const imp of imports) {
                const exportExists = result.files[contextFile].includes(`export const ${imp}`) ||
                                   result.files[contextFile].includes(`export function ${imp}`) ||
                                   result.files[contextFile].includes(`export { ${imp}`);
                
                if (!exportExists) {
                  testResult.passed = false;
                  testResult.errors.push(`${fileName} imports '${imp}' but it's not exported from context`);
                }
              }
            }
          }
        }
      }
      
      // Check for 'use client' directives
      console.log('\n  Use client directives:');
      let missingUseClient = 0;
      for (const [file, content] of Object.entries(result.files)) {
        if ((file.includes('/components/') || file.includes('/context/')) && 
            (file.endsWith('.tsx') || file.endsWith('.jsx'))) {
          const hasUseClient = content.trim().startsWith("'use client'");
          if (!hasUseClient) {
            console.log(`    ${path.basename(file)}: ${colors.red}✗ Missing${colors.reset}`);
            missingUseClient++;
          }
        }
      }
      
      if (missingUseClient > 0) {
        testResult.passed = false;
        testResult.errors.push(`${missingUseClient} files missing 'use client' directive`);
      } else {
        console.log(`    ${colors.green}✓ All components have 'use client'${colors.reset}`);
      }
      
      // Check for validation errors
      if (result.feedback) {
        console.log(`\n  ${colors.yellow}Validation feedback:${colors.reset}`);
        console.log(`    ${result.feedback.replace(/\n/g, '\n    ')}`);
        testResult.passed = false;
        testResult.errors.push('Validation errors present');
      }
      
      results.push(testResult);
      
      // Summary for this test
      console.log(`\n  ${testResult.passed ? colors.green + '✓ PASSED' : colors.red + '✗ FAILED'}${colors.reset}`);
      if (!testResult.passed) {
        console.log(`  Errors:`);
        testResult.errors.forEach(err => console.log(`    - ${err}`));
      }
      
    } catch (error) {
      console.log(`  ${colors.red}✗ ERROR: ${error.message}${colors.reset}`);
      results.push({
        name: testCase.name,
        passed: false,
        errors: [`Exception: ${error.message}`]
      });
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
  }
  
  // Final summary
  console.log(`${colors.blue}=== TEST SUMMARY ===${colors.reset}\n`);
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`Total tests: ${results.length}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  
  if (failed > 0) {
    console.log(`\n${colors.red}Failed tests:${colors.reset}`);
    results.filter(r => !r.passed).forEach(r => {
      console.log(`\n  ${r.name}:`);
      r.errors.forEach(err => console.log(`    - ${err}`));
    });
  }
  
  // Write detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: { total: results.length, passed, failed },
    results: results
  };
  
  await fs.writeFile(
    path.join(__dirname, 'complex-patterns-report.json'),
    JSON.stringify(report, null, 2)
  );
  
  console.log(`\nDetailed report saved to: tests/complex-patterns-report.json`);
  
  return failed === 0;
}

// Run the test
if (require.main === module) {
  console.log('Starting complex pattern tests...\n');
  testComplexPatterns()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}

module.exports = { testComplexPatterns };