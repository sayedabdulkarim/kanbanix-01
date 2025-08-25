/**
 * Test that 'use client' directives are properly added
 */

const path = require('path');
const fs = require('fs').promises;

// Mock API key for testing
process.env.OPENROUTER_API_KEY = 'mock-api-key-for-testing';

async function testUseClientDirectives() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 TESTING USE CLIENT DIRECTIVES');
  console.log('='.repeat(60));
  
  try {
    const { AgentService } = require('../services/agent-service');
    const service = new AgentService();
    
    // Mock various component types
    service.taskGenerator = {
      generatePRD: async () => 'PRD for test app',
      generateProject: async (prd, projectPath) => {
        const files = {
          // Component with state - MUST have 'use client'
          'src/components/Counter.tsx': `'use client';

import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
}`,
          
          // Component with event handlers - MUST have 'use client'
          'src/components/Button.tsx': `'use client';

export default function Button({ onClick, children }) {
  return (
    <button 
      onClick={onClick}
      className="px-4 py-2 bg-blue-500 text-white rounded"
    >
      {children}
    </button>
  );
}`,
          
          // Component using useEffect - MUST have 'use client'
          'src/components/Timer.tsx': `'use client';

import { useState, useEffect } from 'react';

export default function Timer() {
  const [seconds, setSeconds] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  return <div>Seconds: {seconds}</div>;
}`,
          
          // Page with interactivity - MUST have 'use client'
          'src/app/page.tsx': `'use client';

import Counter from '@/components/Counter';
import Button from '@/components/Button';
import Timer from '@/components/Timer';

export default function Home() {
  const handleClick = () => {
    console.log('Clicked!');
  };
  
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-4">Test App</h1>
      <Counter />
      <Button onClick={handleClick}>Click me</Button>
      <Timer />
    </main>
  );
}`,
          
          // Dashboard page with state - MUST have 'use client'
          'src/app/dashboard/page.tsx': `'use client';

import { useState } from 'react';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  
  return (
    <div>
      <nav>
        <button onClick={() => setActiveTab('overview')}>Overview</button>
        <button onClick={() => setActiveTab('analytics')}>Analytics</button>
      </nav>
      <div>Active tab: {activeTab}</div>
    </div>
  );
}`,
          
          // Layout without interactivity - should NOT have 'use client'
          'src/app/layout.tsx': `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Test App",
  description: "Testing use client directives",
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
          
          // Type definitions - should NOT have 'use client'
          'src/types/index.ts': `export interface User {
  id: string;
  name: string;
}

export type Status = 'active' | 'inactive';`,
          
          // Utility functions - should NOT have 'use client'
          'src/utils/helpers.ts': `export function formatDate(date: Date): string {
  return date.toLocaleDateString();
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}`,
          
          // Required files
          'src/app/globals.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;',
          'package.json': JSON.stringify({
            name: 'test-app',
            version: '0.1.0',
            scripts: {
              dev: 'next dev',
              build: 'next build',
              start: 'next start'
            },
            dependencies: {
              next: '^14.0.0',
              react: '^18.0.0',
              'react-dom': '^18.0.0'
            }
          }, null, 2),
          'tailwind.config.js': 'module.exports = { content: ["./src/**/*.{js,ts,jsx,tsx}"] }',
          'postcss.config.js': 'module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }',
          'next.config.js': 'module.exports = { reactStrictMode: true }'
        };
        
        // Write files
        for (const [filePath, content] of Object.entries(files)) {
          const fullPath = path.join(projectPath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content);
        }
        
        return {
          tasks: [{ name: 'Generate with use client', completed: true }],
          summary: 'Generated with use client directives',
          generatedFiles: Object.keys(files).map(p => ({ path: p }))
        };
      }
    };
    
    const result = await service.processRequirement('Create app with various components');
    
    console.log('\n📋 Validating use client directives:');
    console.log('─'.repeat(40));
    
    const validations = [
      {
        file: '/src/components/Counter.tsx',
        shouldHave: true,
        reason: 'Uses useState'
      },
      {
        file: '/src/components/Button.tsx', 
        shouldHave: true,
        reason: 'Has onClick handler'
      },
      {
        file: '/src/components/Timer.tsx',
        shouldHave: true,
        reason: 'Uses useEffect'
      },
      {
        file: '/src/app/page.tsx',
        shouldHave: true,
        reason: 'Has event handlers and imports client components'
      },
      {
        file: '/src/app/dashboard/page.tsx',
        shouldHave: true,
        reason: 'Uses useState'
      },
      {
        file: '/src/app/layout.tsx',
        shouldHave: false,
        reason: 'No interactivity, just layout'
      },
      {
        file: '/src/types/index.ts',
        shouldHave: false,
        reason: 'Type definitions only'
      },
      {
        file: '/src/utils/helpers.ts',
        shouldHave: false,
        reason: 'Pure utility functions'
      }
    ];
    
    let allCorrect = true;
    
    for (const validation of validations) {
      const content = result.files[validation.file];
      if (!content) {
        console.log(`❌ ${validation.file} - File missing`);
        allCorrect = false;
        continue;
      }
      
      const hasUseClient = content.trim().startsWith("'use client'");
      const isCorrect = hasUseClient === validation.shouldHave;
      
      console.log(`${isCorrect ? '✅' : '❌'} ${validation.file}`);
      console.log(`   Should have 'use client': ${validation.shouldHave ? 'YES' : 'NO'}`);
      console.log(`   Actually has 'use client': ${hasUseClient ? 'YES' : 'NO'}`);
      console.log(`   Reason: ${validation.reason}`);
      
      if (!isCorrect) allCorrect = false;
    }
    
    // Additional checks
    console.log('\n📋 Additional validation:');
    
    // Check format is exactly correct
    const counterContent = result.files['/src/components/Counter.tsx'];
    const startsCorrectly = counterContent && counterContent.startsWith("'use client';\n");
    console.log(`${startsCorrectly ? '✅' : '❌'} 'use client' format is correct (with semicolon, before imports)`);
    
    // Check that client components import other client components correctly
    const pageContent = result.files['/src/app/page.tsx'];
    const hasCorrectImports = pageContent && 
                            pageContent.includes("import Counter from '@/components/Counter'") &&
                            pageContent.includes("import Button from '@/components/Button'");
    console.log(`${hasCorrectImports ? '✅' : '❌'} Client components import correctly`);
    
    const finalResult = allCorrect && startsCorrectly && hasCorrectImports;
    
    console.log('\n' + '='.repeat(60));
    console.log(`Use Client Test: ${finalResult ? '✅ PASSED' : '❌ FAILED'}`);
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
testUseClientDirectives()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });