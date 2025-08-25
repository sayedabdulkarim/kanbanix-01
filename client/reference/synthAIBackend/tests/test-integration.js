/**
 * Integration test to validate the complete generation flow
 */

const path = require('path');
const fs = require('fs').promises;

// Mock API key for testing
process.env.OPENROUTER_API_KEY = 'mock-api-key-for-testing';

async function runIntegrationTest() {
  console.log('\n' + '='.repeat(50));
  console.log('🔄 INTEGRATION TEST: Agent Service → Task-Based Generator');
  console.log('='.repeat(50));
  
  try {
    // Clear require cache
    delete require.cache[require.resolve('../services/agent-service')];
    delete require.cache[require.resolve('../services/task-based-generator')];
    
    const { AgentService } = require('../services/agent-service');
    const service = new AgentService();
    
    // Mock the task generator with realistic responses
    service.taskGenerator = {
      generatePRD: async (requirement) => {
        console.log('\n✅ Step 1: PRD Generation');
        console.log(`   Input: "${requirement}"`);
        return `# Product Requirements Document

## Project: Counter Application

### Overview
A simple counter application with increment, decrement, and reset functionality.

### Requirements
- Display current count
- Increment button (+1)
- Decrement button (-1)
- Reset button (set to 0)
- Prevent negative numbers

### Technical Stack
- Next.js 14+ with App Router
- TypeScript
- Tailwind CSS`;
      },
      
      generateProject: async (prd, projectPath) => {
        console.log('\n✅ Step 2: Project Generation');
        console.log(`   Output path: ${projectPath}`);
        
        // Create mock project structure
        const files = {
          'src/app/page.tsx': `'use client';

import Counter from '@/components/Counter';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <Counter />
    </main>
  );
}`,
          'src/components/Counter.tsx': `'use client';

import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  
  const increment = () => setCount(prev => prev + 1);
  const decrement = () => setCount(prev => Math.max(0, prev - 1));
  const reset = () => setCount(0);
  
  return (
    <div className="p-8 rounded-lg bg-white shadow-lg">
      <h1 className="text-2xl font-bold mb-4">Counter: {count}</h1>
      <div className="flex gap-4">
        <button onClick={increment} className="px-4 py-2 bg-green-500 text-white rounded">+</button>
        <button onClick={decrement} className="px-4 py-2 bg-red-500 text-white rounded">-</button>
        <button onClick={reset} className="px-4 py-2 bg-gray-500 text-white rounded">Reset</button>
      </div>
    </div>
  );
}`,
          'src/app/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;`,
          'tailwind.config.js': `module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
}`,
          'postcss.config.js': `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`
        };
        
        // Create directory structure and files
        for (const [filePath, content] of Object.entries(files)) {
          const fullPath = path.join(projectPath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content);
        }
        
        return {
          tasks: [
            { name: 'Create project structure', completed: true },
            { name: 'Generate Counter component', completed: true },
            { name: 'Setup Tailwind CSS', completed: true }
          ],
          summary: 'Counter application generated successfully',
          generatedFiles: Object.keys(files).map(p => ({ path: p }))
        };
      }
    };
    
    // Test the complete flow
    console.log('\n🚀 Running processRequirement flow...');
    const result = await service.processRequirement('Create a counter application');
    
    // Validate results
    console.log('\n📊 Validating Results:');
    
    const checks = {
      hasFiles: !!result.files && Object.keys(result.files).length > 0,
      hasAnalysis: !!result.analysis,
      hasPlan: !!result.plan,
      correctProjectType: result.analysis?.type === 'counter-app',
      hasGeneratedCode: result.files?.['/src/components/Counter.tsx']?.includes('export default'),
      hasUseClient: result.files?.['/src/components/Counter.tsx']?.startsWith("'use client'"),
      hasTailwindConfig: !!result.files?.['/tailwind.config.js'],
      hasPostCSSConfig: !!result.files?.['/postcss.config.js']
    };
    
    console.log(`${checks.hasFiles ? '✅' : '❌'} Files generated (${Object.keys(result.files || {}).length} files)`);
    console.log(`${checks.hasAnalysis ? '✅' : '❌'} Analysis created`);
    console.log(`${checks.hasPlan ? '✅' : '❌'} Plan created`);
    console.log(`${checks.correctProjectType ? '✅' : '❌'} Correct project type: ${result.analysis?.type}`);
    console.log(`${checks.hasGeneratedCode ? '✅' : '❌'} Component has correct export pattern`);
    console.log(`${checks.hasUseClient ? '✅' : '❌'} Component has 'use client' directive`);
    console.log(`${checks.hasTailwindConfig ? '✅' : '❌'} Tailwind config present`);
    console.log(`${checks.hasPostCSSConfig ? '✅' : '❌'} PostCSS config present`);
    
    // Check file structure
    console.log('\n📁 Generated Files:');
    Object.keys(result.files || {}).forEach(file => {
      console.log(`   ${file}`);
    });
    
    const allPassed = Object.values(checks).every(v => v);
    
    console.log('\n' + '='.repeat(50));
    console.log(`Integration Test: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log('='.repeat(50));
    
    // Clean up
    delete process.env.OPENROUTER_API_KEY;
    
    return allPassed;
    
  } catch (error) {
    console.error('\n❌ Integration test failed:', error);
    delete process.env.OPENROUTER_API_KEY;
    return false;
  }
}

// Run test
runIntegrationTest()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });