/**
 * Comprehensive test of code generation with all fixes
 */

const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

// Mock API key for testing
process.env.OPENROUTER_API_KEY = 'mock-api-key-for-testing';

async function runBuildTest(projectPath) {
  return new Promise((resolve) => {
    console.log('\n🔨 Running build test...');
    const build = spawn('npm', ['run', 'build'], {
      cwd: projectPath,
      shell: true,
      stdio: 'pipe'
    });
    
    let output = '';
    let errorOutput = '';
    
    build.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    build.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    build.on('close', (code) => {
      resolve({
        success: code === 0,
        output,
        errorOutput
      });
    });
  });
}

async function testCompleteGeneration() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 COMPREHENSIVE CODE GENERATION TEST');
  console.log('='.repeat(60));
  
  try {
    const { AgentService } = require('../services/agent-service');
    const service = new AgentService();
    
    // Create a comprehensive test project
    service.taskGenerator = {
      generatePRD: async () => `# Product Requirements Document

## Counter Application with History

A counter application that tracks increment/decrement history.

### Features:
- Display current count
- Increment button (+1)
- Decrement button (-1)  
- Reset button
- Show last 5 operations
- Prevent negative numbers

### Technical:
- Use React hooks for state
- Use Context for history
- Tailwind for styling`,
      
      generateProject: async (prd, projectPath) => {
        const files = {
          // Layout file - REQUIRED
          'src/app/layout.tsx': `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Counter App",
  description: "A counter with history tracking",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-100">
        {children}
      </body>
    </html>
  );
}`,
          
          // Main page with proper imports
          'src/app/page.tsx': `'use client';

import Counter from '@/components/Counter';
import { HistoryProvider } from '@/context/HistoryContext';

export default function Home() {
  return (
    <HistoryProvider>
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">
            Counter App
          </h1>
          <Counter />
        </div>
      </main>
    </HistoryProvider>
  );
}`,
          
          // Counter component using only React hooks
          'src/components/Counter.tsx': `'use client';

import { useState } from 'react';
import { useHistory } from '@/context/HistoryContext';
import HistoryList from './HistoryList';

export default function Counter() {
  const [count, setCount] = useState(0);
  const { addToHistory } = useHistory();
  
  const handleIncrement = () => {
    setCount(prev => prev + 1);
    addToHistory('increment', count + 1);
  };
  
  const handleDecrement = () => {
    if (count > 0) {
      setCount(prev => prev - 1);
      addToHistory('decrement', count - 1);
    }
  };
  
  const handleReset = () => {
    setCount(0);
    addToHistory('reset', 0);
  };
  
  return (
    <div className="bg-white rounded-lg shadow-lg p-8">
      <div className="text-center mb-8">
        <h2 className="text-5xl font-bold text-gray-800">{count}</h2>
        <p className="text-gray-600 mt-2">Current Count</p>
      </div>
      
      <div className="flex gap-4 justify-center mb-8">
        <button
          onClick={handleIncrement}
          className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-semibold"
        >
          +1
        </button>
        <button
          onClick={handleDecrement}
          disabled={count === 0}
          className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          -1
        </button>
        <button
          onClick={handleReset}
          className="px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-semibold"
        >
          Reset
        </button>
      </div>
      
      <HistoryList />
    </div>
  );
}`,
          
          // History display component
          'src/components/HistoryList.tsx': `'use client';

import { useHistory } from '@/context/HistoryContext';

export default function HistoryList() {
  const { history } = useHistory();
  
  if (history.length === 0) {
    return (
      <div className="text-center text-gray-500">
        <p>No operations yet</p>
      </div>
    );
  }
  
  return (
    <div className="border-t pt-4">
      <h3 className="text-lg font-semibold mb-3 text-gray-700">Recent Operations</h3>
      <ul className="space-y-2">
        {history.map((item) => (
          <li
            key={item.id}
            className="flex justify-between items-center text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded"
          >
            <span className="capitalize">{item.operation}</span>
            <span className="font-mono">→ {item.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}`,
          
          // Context using only React Context API
          'src/context/HistoryContext.tsx': `'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface HistoryItem {
  id: string;
  operation: string;
  value: number;
  timestamp: Date;
}

interface HistoryContextType {
  history: HistoryItem[];
  addToHistory: (operation: string, value: number) => void;
}

export const HistoryContext = createContext<HistoryContextType | undefined>(undefined);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  const addToHistory = (operation: string, value: number) => {
    const newItem: HistoryItem = {
      id: Date.now().toString(),
      operation,
      value,
      timestamp: new Date()
    };
    
    setHistory(prev => [newItem, ...prev].slice(0, 5));
  };
  
  return (
    <HistoryContext.Provider value={{ history, addToHistory }}>
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const context = useContext(HistoryContext);
  if (!context) {
    throw new Error('useHistory must be used within HistoryProvider');
  }
  return context;
}`,
          
          // CSS with Tailwind directives
          'src/app/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;`,
          
          // Configs
          'tailwind.config.js': `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
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

module.exports = nextConfig`,
          
          'tsconfig.json': `{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}`,
          
          'package.json': JSON.stringify({
            name: 'counter-app',
            version: '0.1.0',
            private: true,
            scripts: {
              dev: 'next dev',
              build: 'next build',
              start: 'next start',
              lint: 'next lint'
            },
            dependencies: {
              'next': '^14.0.0',
              'react': '^18.0.0',
              'react-dom': '^18.0.0'
            },
            devDependencies: {
              '@types/node': '^20.0.0',
              '@types/react': '^18.0.0',
              '@types/react-dom': '^18.0.0',
              'autoprefixer': '^10.0.0',
              'postcss': '^8.0.0',
              'tailwindcss': '^3.0.0',
              'typescript': '^5.0.0'
            }
          }, null, 2)
        };
        
        // Write files
        for (const [filePath, content] of Object.entries(files)) {
          const fullPath = path.join(projectPath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content);
        }
        
        return {
          tasks: [
            { name: 'Create project structure', completed: true },
            { name: 'Generate Counter component', completed: true },
            { name: 'Setup History Context', completed: true },
            { name: 'Configure Tailwind', completed: true }
          ],
          summary: 'Counter app with history generated successfully',
          generatedFiles: Object.keys(files).map(p => ({ path: p }))
        };
      }
    };
    
    console.log('📦 Generating project...');
    const result = await service.processRequirement('Create a counter app with history tracking');
    
    // Validation checks
    console.log('\n📋 Validation Results:');
    console.log('─'.repeat(40));
    
    const checks = {
      hasAllFiles: [
        '/src/app/layout.tsx',
        '/src/app/page.tsx',
        '/src/app/globals.css',
        '/src/components/Counter.tsx',
        '/src/components/HistoryList.tsx',
        '/src/context/HistoryContext.tsx',
        '/package.json',
        '/tailwind.config.js',
        '/postcss.config.js',
        '/next.config.js',
        '/tsconfig.json'
      ].every(f => !!result.files[f]),
      
      noExternalDeps: !JSON.stringify(result.files).includes('zustand') && 
                      !JSON.stringify(result.files).includes('redux') &&
                      !JSON.stringify(result.files).includes('axios'),
      
      hasUseClient: Object.entries(result.files)
        .filter(([path]) => path.endsWith('.tsx') && path.includes('components'))
        .every(([_, content]) => content.startsWith("'use client'")),
      
      noTailwindImports: !JSON.stringify(result.files).includes("import 'tailwindcss'") &&
                         !JSON.stringify(result.files).includes('import "tailwindcss"'),
      
      hasLayoutFile: !!result.files['/src/app/layout.tsx'],
      
      validImports: !result.feedback || !result.feedback.includes('Import')
    };
    
    console.log(`${checks.hasAllFiles ? '✅' : '❌'} All required files present`);
    console.log(`${checks.noExternalDeps ? '✅' : '❌'} No external dependencies (zustand, redux, etc.)`);
    console.log(`${checks.hasUseClient ? '✅' : '❌'} All components have 'use client' directive`);
    console.log(`${checks.noTailwindImports ? '✅' : '❌'} No direct Tailwind imports`);
    console.log(`${checks.hasLayoutFile ? '✅' : '❌'} Has layout.tsx file`);
    console.log(`${checks.validImports ? '✅' : '❌'} All imports are valid`);
    
    if (result.feedback) {
      console.log('\n⚠️  Validation Feedback:');
      console.log(result.feedback);
    }
    
    // Write project to temp directory for build test
    const testDir = path.join(__dirname, 'temp-test-project');
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(testDir, { recursive: true });
    
    console.log('\n📁 Writing files to test directory...');
    for (const [filePath, content] of Object.entries(result.files)) {
      const fullPath = path.join(testDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }
    
    // Install dependencies
    console.log('\n📦 Installing dependencies...');
    const install = spawn('npm', ['install'], {
      cwd: testDir,
      shell: true,
      stdio: 'inherit'
    });
    
    await new Promise((resolve) => install.on('close', resolve));
    
    // Run build test
    const buildResult = await runBuildTest(testDir);
    
    console.log('\n🏗️  Build Test Results:');
    console.log('─'.repeat(40));
    console.log(`Build ${buildResult.success ? '✅ PASSED' : '❌ FAILED'}`);
    
    if (!buildResult.success) {
      console.log('\nBuild errors:');
      console.log(buildResult.errorOutput || buildResult.output);
    }
    
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    
    // Final summary
    const allChecksPassed = Object.values(checks).every(v => v);
    const finalResult = allChecksPassed && buildResult.success;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL RESULTS');
    console.log('='.repeat(60));
    console.log(`Code Generation: ${allChecksPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Build Test: ${buildResult.success ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`\nComplete Generation Test: ${finalResult ? '✅ PASSED' : '❌ FAILED'}`);
    console.log('='.repeat(60));
    
    // Clean up
    delete process.env.OPENROUTER_API_KEY;
    
    return finalResult;
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    delete process.env.OPENROUTER_API_KEY;
    return false;
  }
}

// Run test
console.log('Note: This test will install dependencies and run a build. It may take a minute...\n');

testCompleteGeneration()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });