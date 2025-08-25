/**
 * Test script to verify boilerplate template integration
 * This tests that all required files are included when generating a project
 */

const { AgentService } = require('./services/agent-service');
const { getRequiredFiles } = require('./services/boilerplate-templates');

async function testBoilerplateIntegration() {
  console.log('Testing boilerplate template integration...\n');
  
  const agentService = new AgentService();
  
  // Test with a simple requirement
  const requirement = "Create a simple counter app with increment and decrement buttons";
  
  try {
    console.log('Processing requirement:', requirement);
    console.log('---');
    
    // Mock the LLM responses
    const originalGenerateText = agentService.llmService.generateText;
    const originalCallLLM = agentService.taskGenerator.callLLM;
    
    // Mock responses
    agentService.llmService.generateText = async (prompt) => {
      console.log('Mocking LLM response...');
      return 'Mocked analysis response';
    };
    
    // Mock PRD generation
    agentService.prdService.generatePRD = async (req) => {
      return `# Counter App PRD
      
## Overview
A simple counter application with increment and decrement functionality.

## Features
1. Display current count
2. Increment button to increase count
3. Decrement button to decrease count
4. Reset button to set count to 0

## Technical Requirements
- Next.js with App Router
- TypeScript
- Tailwind CSS for styling
- React state management`;
    };
    
    // Mock task creation
    agentService.taskGenerator.callLLM = async (prompt) => {
      if (prompt.includes('Create a detailed task list')) {
        return JSON.stringify({
          tasks: [
            {
              id: "task-1",
              name: "Create counter component",
              description: "Create the main counter component with state management",
              dependencies: [],
              files: ["src/components/Counter.tsx"],
              priority: 1
            },
            {
              id: "task-2",
              name: "Update home page",
              description: "Update the home page to use the counter component",
              dependencies: ["task-1"],
              files: ["src/app/page.tsx"],
              priority: 2
            }
          ]
        });
      } else if (prompt.includes('Generate code for this specific task')) {
        if (prompt.includes('Create counter component')) {
          return JSON.stringify({
            files: [
              {
                path: "src/components/Counter.tsx",
                content: `'use client';

import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="flex flex-col items-center space-y-4 p-8">
      <h1 className="text-4xl font-bold">Counter: {count}</h1>
      <div className="flex space-x-4">
        <button
          onClick={() => setCount(count + 1)}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Increment
        </button>
        <button
          onClick={() => setCount(count - 1)}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Decrement
        </button>
        <button
          onClick={() => setCount(0)}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
        >
          Reset
        </button>
      </div>
    </div>
  );
}`,
                action: "create"
              }
            ],
            description: "Created counter component with increment, decrement, and reset functionality"
          });
        } else {
          return JSON.stringify({
            files: [
              {
                path: "src/app/page.tsx",
                content: `'use client';

import Counter from '@/components/Counter';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <Counter />
    </main>
  );
}`,
                action: "create"
              }
            ],
            description: "Updated home page to use counter component"
          });
        }
      }
      return 'Mocked response';
    };
    
    // Process the requirement
    const result = await agentService.processRequirement(requirement);
    
    console.log('\nGenerated files:');
    const generatedPaths = Object.keys(result.files).sort();
    generatedPaths.forEach(path => {
      console.log(`  - ${path}`);
    });
    
    // Check for required boilerplate files
    console.log('\nChecking for required boilerplate files:');
    const requiredFiles = getRequiredFiles();
    const missingFiles = [];
    
    requiredFiles.forEach(file => {
      if (result.files[file]) {
        console.log(`  ✓ ${file}`);
      } else {
        console.log(`  ✗ ${file} (MISSING)`);
        missingFiles.push(file);
      }
    });
    
    // Check for generated component files
    console.log('\nChecking for generated component files:');
    const componentFiles = ['/src/components/Counter.tsx', '/src/app/page.tsx'];
    componentFiles.forEach(file => {
      if (result.files[file]) {
        console.log(`  ✓ ${file}`);
      } else {
        console.log(`  ✗ ${file} (MISSING)`);
      }
    });
    
    // Verify critical files have correct content
    console.log('\nVerifying critical file content:');
    
    // Check layout.tsx
    if (result.files['/src/app/layout.tsx']) {
      const layoutContent = result.files['/src/app/layout.tsx'];
      console.log('  ✓ layout.tsx exists');
      console.log(`    - Has metadata: ${layoutContent.includes('export const metadata')}`);
      console.log(`    - Has RootLayout: ${layoutContent.includes('export default function RootLayout')}`);
      console.log(`    - Imports globals.css: ${layoutContent.includes('./globals.css')}`);
    }
    
    // Check package.json
    if (result.files['/package.json']) {
      const packageJson = JSON.parse(result.files['/package.json']);
      console.log('  ✓ package.json exists');
      console.log(`    - Has next dependency: ${!!packageJson.dependencies?.next}`);
      console.log(`    - Has react dependency: ${!!packageJson.dependencies?.react}`);
      console.log(`    - Has scripts: ${!!packageJson.scripts}`);
    }
    
    // Summary
    console.log('\n--- SUMMARY ---');
    console.log(`Total files generated: ${generatedPaths.length}`);
    console.log(`Required boilerplate files: ${requiredFiles.length}`);
    console.log(`Missing boilerplate files: ${missingFiles.length}`);
    
    if (missingFiles.length === 0) {
      console.log('\n✅ SUCCESS: All required boilerplate files are included!');
    } else {
      console.log('\n❌ FAILURE: Some boilerplate files are missing');
      console.log('Missing files:', missingFiles);
    }
    
    // Restore original functions
    agentService.llmService.generateText = originalGenerateText;
    agentService.taskGenerator.callLLM = originalCallLLM;
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
  }
}

// Run the test
testBoilerplateIntegration().catch(console.error);