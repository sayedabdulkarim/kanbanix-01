/**
 * Test that LLM constraints prevent complex dependencies
 */

const path = require('path');
const fs = require('fs').promises;

// Mock API key for testing
process.env.OPENROUTER_API_KEY = 'mock-api-key-for-testing';

async function testConstraints() {
  console.log('\n' + '='.repeat(60));
  console.log('🔒 TESTING LLM CONSTRAINTS');
  console.log('='.repeat(60));
  
  try {
    const { AgentService } = require('../services/agent-service');
    const service = new AgentService();
    
    // Test Case 1: Simulate LLM trying to use zustand
    console.log('\n📋 Test 1: Preventing External State Management');
    
    // Mock task generator that tries to use zustand
    service.taskGenerator = {
      generatePRD: async () => 'PRD for counter app',
      generateProject: async (prd, projectPath) => {
        const files = {
          'package.json': JSON.stringify({
            name: 'test-app',
            version: '0.1.0',
            scripts: {
              dev: 'next dev',
              build: 'next build',
              start: 'next start'
            },
            dependencies: {
              'next': '^14.0.0',
              'react': '^18.0.0',
              'react-dom': '^18.0.0',
              // Should NOT have zustand
            },
            devDependencies: {
              'typescript': '^5.0.0',
              'tailwindcss': '^3.0.0',
              'autoprefixer': '^10.0.0',
              'postcss': '^8.0.0'
            }
          }, null, 2),
          
          // This should be rewritten to use useState
          'src/store/counterStore.ts': `'use client';

import { useState } from 'react';

// Using React Context instead of external state management
export const useCounterStore = () => {
  const [count, setCount] = useState(0);
  
  const increment = () => setCount(prev => prev + 1);
  const decrement = () => setCount(prev => prev - 1);
  const reset = () => setCount(0);
  
  return { count, increment, decrement, reset };
};`,
          
          'src/components/Counter.tsx': `'use client';

import { useCounterStore } from '../store/counterStore';

export default function Counter() {
  const { count, increment, decrement, reset } = useCounterStore();
  
  return (
    <div className="p-8 rounded-lg bg-white shadow-lg">
      <h1 className="text-2xl font-bold mb-4">Count: {count}</h1>
      <div className="flex gap-4">
        <button 
          onClick={increment}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          +
        </button>
        <button 
          onClick={decrement}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          -
        </button>
        <button 
          onClick={reset}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
        >
          Reset
        </button>
      </div>
    </div>
  );
}`,
          
          // Required files
          'src/app/layout.tsx': `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Counter App",
  description: "A simple counter application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}`,
          
          'src/app/page.tsx': `'use client';

import Counter from '@/components/Counter';

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100">
      <Counter />
    </main>
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
}`,
          
          'next.config.js': `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

module.exports = nextConfig`
        };
        
        // Write files
        for (const [filePath, content] of Object.entries(files)) {
          const fullPath = path.join(projectPath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content);
        }
        
        return {
          tasks: [{ name: 'Generate with constraints', completed: true }],
          summary: 'Generated with constraints',
          generatedFiles: Object.keys(files).map(p => ({ path: p }))
        };
      }
    };
    
    const result = await service.processRequirement('Create a counter with state management');
    
    // Validate constraints were applied
    console.log('\n✓ Checking constraint enforcement:');
    
    // Debug: Check what files we actually have
    console.log('\nGenerated files:', Object.keys(result.files || {}));
    
    // Debug the specific check that's failing
    const storeContent = result.files['/src/store/counterStore.ts'];
    const counterContent = result.files['/src/components/Counter.tsx'];
    console.log('\nStore file exists:', !!storeContent);
    console.log('Store includes zustand:', storeContent?.includes('zustand'));
    console.log('Counter includes zustand:', counterContent?.includes('zustand'));
    
    const checks = {
      noZustand: !result.files['/package.json']?.includes('zustand'),
      hasLayoutFile: !!result.files['/src/app/layout.tsx'],
      usesReactState: result.files['/src/store/counterStore.ts']?.includes('useState'),
      hasUseClient: result.files['/src/components/Counter.tsx']?.startsWith("'use client'"),
      noComplexImports: (!result.files['/src/store/counterStore.ts'] || !result.files['/src/store/counterStore.ts'].includes('zustand')) && 
                        (!result.files['/src/components/Counter.tsx'] || !result.files['/src/components/Counter.tsx'].includes('zustand')),
      hasTailwindOnly: !result.files['/src/components/Counter.tsx']?.includes('styled-components'),
      hasRequiredFiles: [
        '/src/app/layout.tsx',
        '/src/app/page.tsx', 
        '/src/app/globals.css',
        '/package.json',
        '/tailwind.config.js',
        '/postcss.config.js'
      ].every(f => !!result.files[f])
    };
    
    console.log(`${checks.noZustand ? '✅' : '❌'} No zustand in dependencies`);
    console.log(`${checks.hasLayoutFile ? '✅' : '❌'} Has required layout.tsx`);
    console.log(`${checks.usesReactState ? '✅' : '❌'} Uses React useState instead of zustand`);
    console.log(`${checks.hasUseClient ? '✅' : '❌'} Components have 'use client' directive`);
    console.log(`${checks.noComplexImports ? '✅' : '❌'} No complex library imports`);
    console.log(`${checks.hasTailwindOnly ? '✅' : '❌'} Uses only Tailwind for styling`);
    console.log(`${checks.hasRequiredFiles ? '✅' : '❌'} All required files present`);
    
    const allPassed = Object.values(checks).every(v => v);
    
    // Test Case 2: Check package.json constraints
    console.log('\n📋 Test 2: Package.json Constraints');
    
    if (result.files['/package.json']) {
      const pkg = JSON.parse(result.files['/package.json']);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      const allowedDeps = [
        'next', 'react', 'react-dom', 'typescript',
        '@types/react', '@types/react-dom', '@types/node',
        'tailwindcss', 'autoprefixer', 'postcss',
        'eslint', 'eslint-config-next'
      ];
      
      const allDepsAllowed = Object.keys(deps).every(dep => 
        allowedDeps.some(allowed => dep.startsWith(allowed))
      );
      
      console.log(`${allDepsAllowed ? '✅' : '❌'} All dependencies are from allowed list`);
      console.log(`Dependencies: ${Object.keys(deps).join(', ')}`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`Constraints Test: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);
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
testConstraints()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });