/**
 * Test that import/export validation is integrated into agent-service
 */

const path = require('path');
const fs = require('fs').promises;

// Mock API key for testing
process.env.OPENROUTER_API_KEY = 'mock-api-key-for-testing';

async function testValidationIntegration() {
  console.log('\n' + '='.repeat(60));
  console.log('🔗 TESTING VALIDATION INTEGRATION');
  console.log('='.repeat(60));
  
  try {
    const { AgentService } = require('../services/agent-service');
    const service = new AgentService();
    
    // Test Case 1: Valid project (should pass validation)
    console.log('\n📋 Test 1: Valid Project - No Import Errors');
    
    service.taskGenerator = {
      generatePRD: async () => 'PRD for valid app',
      generateProject: async (prd, projectPath) => {
        const files = {
          'src/components/Button.tsx': `'use client';

export default function Button({ label }) {
  return <button>{label}</button>;
}`,
          
          'src/app/page.tsx': `'use client';

import Button from '@/components/Button';

export default function Home() {
  return <Button label="Click me" />;
}`,
          
          'src/app/layout.tsx': `import './globals.css';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}`,
          
          'src/app/globals.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;',
          'package.json': '{ "name": "test" }',
          'tailwind.config.js': 'module.exports = {}',
          'postcss.config.js': 'module.exports = {}'
        };
        
        // Write files
        for (const [filePath, content] of Object.entries(files)) {
          const fullPath = path.join(projectPath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content);
        }
        
        return {
          tasks: [{ name: 'Generate valid project', completed: true }],
          summary: 'Valid project generated',
          generatedFiles: Object.keys(files).map(p => ({ path: p }))
        };
      }
    };
    
    const result1 = await service.processRequirement('Create a button component');
    
    console.log('✓ Project generated');
    console.log(`Has feedback: ${result1.feedback ? 'YES' : 'NO'}`);
    if (result1.feedback) {
      console.log('Unexpected feedback:', result1.feedback);
    }
    
    // Test Case 2: Project with import errors (should get feedback)
    console.log('\n📋 Test 2: Project with Import Errors');
    
    service.taskGenerator = {
      generatePRD: async () => 'PRD for app with errors',
      generateProject: async (prd, projectPath) => {
        const files = {
          'src/components/Card.tsx': `'use client';

// Missing default export!
export function CardHeader() {
  return <div>Header</div>;
}`,
          
          'src/utils/helpers.ts': `
export function formatDate(date) {
  return date.toLocaleDateString();
}
// formatPrice is not exported`,
          
          'src/app/page.tsx': `'use client';

import Card from '@/components/Card'; // Error: no default export
import { formatDate, formatPrice } from '@/utils/helpers'; // Error: formatPrice not exported

export default function Home() {
  return (
    <div>
      <Card />
      <p>{formatDate(new Date())}</p>
      <p>{formatPrice(100)}</p>
    </div>
  );
}`,
          
          'src/app/layout.tsx': `import './globals.css';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}`,
          
          'src/app/globals.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;',
          'package.json': '{ "name": "test" }',
          'tailwind.config.js': 'module.exports = {}',
          'postcss.config.js': 'module.exports = {}'
        };
        
        // Write files
        for (const [filePath, content] of Object.entries(files)) {
          const fullPath = path.join(projectPath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content);
        }
        
        return {
          tasks: [{ name: 'Generate project with errors', completed: true }],
          summary: 'Project generated with import errors',
          generatedFiles: Object.keys(files).map(p => ({ path: p }))
        };
      }
    };
    
    const result2 = await service.processRequirement('Create app with import errors');
    
    console.log('✓ Project generated');
    console.log(`Has feedback: ${result2.feedback ? 'YES' : 'NO'}`);
    
    if (result2.feedback) {
      console.log('\nValidation feedback received:');
      console.log(result2.feedback);
      
      // Check that feedback contains expected errors
      const hasDefaultExportError = result2.feedback.includes('no default export');
      const hasNamedExportError = result2.feedback.includes("doesn't export 'formatPrice'");
      
      console.log(`\n${hasDefaultExportError ? '✅' : '❌'} Detected missing default export`);
      console.log(`${hasNamedExportError ? '✅' : '❌'} Detected missing named export`);
    } else {
      console.log('❌ Expected validation feedback but got none');
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    const test1Passed = !result1.feedback;
    const test2Passed = result2.feedback && 
                       result2.feedback.includes('no default export') &&
                       result2.feedback.includes("doesn't export");
    
    console.log('📊 INTEGRATION TEST SUMMARY');
    console.log(`${test1Passed ? '✅' : '❌'} Valid project passes without feedback`);
    console.log(`${test2Passed ? '✅' : '❌'} Invalid imports generate feedback`);
    
    const allPassed = test1Passed && test2Passed;
    console.log(`\nValidation Integration: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log('='.repeat(60));
    
    // Clean up
    delete process.env.OPENROUTER_API_KEY;
    
    return allPassed;
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    delete process.env.OPENROUTER_API_KEY;
    return false;
  }
}

// Run test
testValidationIntegration()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });