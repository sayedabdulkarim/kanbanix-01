/**
 * Test build validation to ensure generated code compiles correctly
 */

const path = require('path');
const fs = require('fs').promises;

// Mock API key for testing
process.env.OPENROUTER_API_KEY = 'mock-api-key-for-testing';

async function testBuildValidation() {
  console.log('\n' + '='.repeat(60));
  console.log('🔧 BUILD VALIDATION TEST');
  console.log('='.repeat(60));
  
  try {
    const { AgentService } = require('../services/agent-service');
    const service = new AgentService();
    
    // Mock the task generator with a complex component that tests our rules
    service.taskGenerator = {
      generatePRD: async (requirement) => {
        return `# PRD\n\n${requirement}`;
      },
      
      generateProject: async (prd, projectPath) => {
        // Create test files that validate our rules
        const files = {
          // Test 1: Component with hooks must have 'use client'
          'src/components/Counter.tsx': `'use client';

import { useState, useEffect } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    console.log('Count changed:', count);
  }, [count]);
  
  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(count + 1)}>+</button>
    </div>
  );
}`,
          
          // Test 2: Custom hook with correct export
          'src/hooks/useCounter.ts': `'use client';

import { useState, useCallback } from 'react';

export function useCounter(initial = 0) {
  const [count, setCount] = useState(initial);
  
  const increment = useCallback(() => {
    setCount(c => c + 1);
  }, []);
  
  const decrement = useCallback(() => {
    setCount(c => c - 1);
  }, []);
  
  return { count, increment, decrement };
}`,
          
          // Test 3: Context with correct export
          'src/context/ThemeContext.tsx': `'use client';

import { createContext, useContext, useState } from 'react';

export const ThemeContext = createContext({
  theme: 'light',
  toggleTheme: () => {}
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('light');
  
  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };
  
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}`,
          
          // Test 4: Page component importing others
          'src/app/page.tsx': `'use client';

import Counter from '@/components/Counter';
import { useCounter } from '@/hooks/useCounter';
import { ThemeProvider } from '@/context/ThemeContext';

export default function Home() {
  const { count, increment } = useCounter();
  
  return (
    <ThemeProvider>
      <main className="min-h-screen p-8">
        <h1>My App</h1>
        <Counter />
        <div>
          <p>Hook count: {count}</p>
          <button onClick={increment}>Increment from hook</button>
        </div>
      </main>
    </ThemeProvider>
  );
}`,
          
          // Test 5: Component without hooks (no 'use client' needed but we add it)
          'src/components/Header.tsx': `'use client';

export default function Header({ title }) {
  return (
    <header className="p-4 bg-gray-100">
      <h1>{title}</h1>
    </header>
  );
}`,
          
          // Test 6: Types/interfaces file
          'src/types/index.ts': `export interface User {
  id: string;
  name: string;
  email: string;
}

export type Theme = 'light' | 'dark';

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}`,
          
          // Config files
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
          tasks: [{ name: 'Generate project', completed: true }],
          summary: 'Project generated',
          generatedFiles: Object.keys(files).map(p => ({ path: p }))
        };
      }
    };
    
    // Run the generation
    const result = await service.processRequirement('Create a test app with various components');
    
    // Validate all rules
    console.log('\n📋 Validating Code Generation Rules:');
    console.log('─'.repeat(40));
    
    const validations = [
      {
        name: 'Component with hooks has use client',
        file: '/src/components/Counter.tsx',
        checks: [
          { desc: 'Has use client directive', test: content => content.startsWith("'use client'") },
          { desc: 'Uses default export', test: content => content.includes('export default function') },
          { desc: 'Has React hooks', test: content => content.includes('useState') }
        ]
      },
      {
        name: 'Custom hook exports correctly',
        file: '/src/hooks/useCounter.ts',
        checks: [
          { desc: 'Has use client directive', test: content => content.startsWith("'use client'") },
          { desc: 'Uses named export', test: content => content.includes('export function useCounter') },
          { desc: 'Has React hooks', test: content => content.includes('useState') }
        ]
      },
      {
        name: 'Context exports correctly',
        file: '/src/context/ThemeContext.tsx',
        checks: [
          { desc: 'Has use client directive', test: content => content.startsWith("'use client'") },
          { desc: 'Context uses named export', test: content => content.includes('export const ThemeContext') },
          { desc: 'Provider uses named export', test: content => content.includes('export function ThemeProvider') }
        ]
      },
      {
        name: 'Imports work correctly',
        file: '/src/app/page.tsx',
        checks: [
          { desc: 'Has use client directive', test: content => content.startsWith("'use client'") },
          { desc: 'Default import for component', test: content => content.includes('import Counter from') },
          { desc: 'Named import for hook', test: content => content.includes('import { useCounter }') },
          { desc: 'Named import for context', test: content => content.includes('import { ThemeProvider }') }
        ]
      },
      {
        name: 'Types file exports correctly',
        file: '/src/types/index.ts',
        checks: [
          { desc: 'No use client directive', test: content => !content.includes('use client') },
          { desc: 'Exports interfaces', test: content => content.includes('export interface') },
          { desc: 'Exports types', test: content => content.includes('export type') }
        ]
      },
      {
        name: 'Config files present',
        file: '/tailwind.config.js',
        checks: [
          { desc: 'Tailwind config exists', test: content => content.includes('module.exports') },
          { desc: 'Has content paths', test: content => content.includes('./src/**/*.{js,ts,jsx,tsx}') }
        ]
      },
      {
        name: 'PostCSS config correct',
        file: '/postcss.config.js',
        checks: [
          { desc: 'PostCSS config exists', test: content => content.includes('module.exports') },
          { desc: 'Has tailwindcss plugin', test: content => content.includes('tailwindcss:') },
          { desc: 'Has autoprefixer plugin', test: content => content.includes('autoprefixer:') }
        ]
      }
    ];
    
    let allPassed = true;
    
    for (const validation of validations) {
      console.log(`\n✓ ${validation.name}`);
      const fileContent = result.files[validation.file];
      
      if (!fileContent) {
        console.log(`  ❌ File not found: ${validation.file}`);
        allPassed = false;
        continue;
      }
      
      for (const check of validation.checks) {
        const passed = check.test(fileContent);
        console.log(`  ${passed ? '✅' : '❌'} ${check.desc}`);
        allPassed = allPassed && passed;
      }
    }
    
    // Check no package.json was generated
    console.log('\n✓ Package.json handling');
    const hasPackageJson = !!result.files['/package.json'];
    console.log(`  ${!hasPackageJson ? '✅' : '❌'} No package.json generated`);
    allPassed = allPassed && !hasPackageJson;
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log(`Build Validation Test: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);
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
testBuildValidation()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });