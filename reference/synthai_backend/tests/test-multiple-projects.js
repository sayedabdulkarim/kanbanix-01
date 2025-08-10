/**
 * Test multiple project types to ensure all fixes work correctly
 */

const path = require('path');
const fs = require('fs').promises;

// Mock API key for testing
process.env.OPENROUTER_API_KEY = 'mock-api-key-for-testing';

async function testMultipleProjects() {
  console.log('\n' + '='.repeat(60));
  console.log('🔄 TESTING MULTIPLE PROJECT TYPES');
  console.log('='.repeat(60));
  
  try {
    // Clear require cache
    delete require.cache[require.resolve('../services/agent-service')];
    delete require.cache[require.resolve('../services/task-based-generator')];
    
    const { AgentService } = require('../services/agent-service');
    const service = new AgentService();
    
    // Define test projects
    const testProjects = [
      {
        name: 'Counter App',
        requirement: 'Create a counter application with increment, decrement and reset buttons',
        expectedFiles: [
          { path: '/src/components/Counter.tsx', mustContain: ["'use client'", 'export default'] },
          { path: '/src/app/page.tsx', mustContain: ["'use client'", 'import Counter'] }
        ]
      },
      {
        name: 'Todo App',
        requirement: 'Build a todo list app where users can add, complete and delete tasks',
        expectedFiles: [
          { path: '/src/components/TodoList.tsx', mustContain: ["'use client'", 'export default'] },
          { path: '/src/components/TodoItem.tsx', mustContain: ["'use client'", 'export default'] }
        ]
      },
      {
        name: 'Blog App',
        requirement: 'Create a simple blog with posts and categories',
        expectedFiles: [
          { path: '/src/components/PostList.tsx', mustContain: ["'use client'", 'export default'] },
          { path: '/src/app/page.tsx', mustContain: ["'use client'"] }
        ]
      }
    ];
    
    // Mock the task generator
    service.taskGenerator = {
      generatePRD: async (requirement) => {
        return `# Product Requirements Document\n\n## Project: ${requirement}\n\n### Requirements\n${requirement}`;
      },
      
      generateProject: async (prd, projectPath, projectName) => {
        // Determine which test project based on requirement
        let files = {};
        
        if (prd.includes('counter')) {
          files = {
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
  
  return (
    <div className="p-8 rounded-lg bg-white shadow-lg">
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(count + 1)}>Increment</button>
      <button onClick={() => setCount(count - 1)}>Decrement</button>
      <button onClick={() => setCount(0)}>Reset</button>
    </div>
  );
}`
          };
        } else if (prd.includes('todo')) {
          files = {
            'src/app/page.tsx': `'use client';

import TodoList from '@/components/TodoList';

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <TodoList />
    </main>
  );
}`,
            'src/components/TodoList.tsx': `'use client';

import { useState } from 'react';
import TodoItem from './TodoItem';

export default function TodoList() {
  const [todos, setTodos] = useState([]);
  
  return (
    <div className="max-w-2xl mx-auto">
      <h1>Todo List</h1>
      {todos.map(todo => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </div>
  );
}`,
            'src/components/TodoItem.tsx': `'use client';

export default function TodoItem({ todo }) {
  return (
    <div className="p-4 border rounded">
      {todo.text}
    </div>
  );
}`
          };
        } else if (prd.includes('blog')) {
          files = {
            'src/app/page.tsx': `'use client';

import PostList from '@/components/PostList';

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1>My Blog</h1>
      <PostList />
    </main>
  );
}`,
            'src/components/PostList.tsx': `'use client';

import { useState } from 'react';

export default function PostList() {
  const [posts, setPosts] = useState([]);
  
  return (
    <div className="grid gap-4">
      {posts.map(post => (
        <article key={post.id} className="p-6 border rounded">
          <h2>{post.title}</h2>
          <p>{post.content}</p>
        </article>
      ))}
    </div>
  );
}`
          };
        }
        
        // Add common config files
        files['tailwind.config.js'] = `module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
}`;
        
        files['postcss.config.js'] = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`;
        
        // Create directory structure and files
        for (const [filePath, content] of Object.entries(files)) {
          const fullPath = path.join(projectPath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content);
        }
        
        return {
          tasks: [{ name: 'Generate project', completed: true }],
          summary: 'Project generated successfully',
          generatedFiles: Object.keys(files).map(p => ({ path: p }))
        };
      }
    };
    
    // Test each project type
    const results = [];
    
    for (const testProject of testProjects) {
      console.log(`\n📋 Testing: ${testProject.name}`);
      console.log('─'.repeat(40));
      
      try {
        const result = await service.processRequirement(testProject.requirement);
        
        // Validate expected files
        let allFilesValid = true;
        const fileChecks = [];
        
        for (const expectedFile of testProject.expectedFiles) {
          const fileContent = result.files[expectedFile.path];
          const exists = !!fileContent;
          const validContent = exists && expectedFile.mustContain.every(str => fileContent.includes(str));
          
          fileChecks.push({
            path: expectedFile.path,
            exists,
            validContent,
            passed: exists && validContent
          });
          
          allFilesValid = allFilesValid && exists && validContent;
        }
        
        // Check common requirements
        const hasPostCSS = !!result.files['/postcss.config.js'];
        const hasTailwind = !!result.files['/tailwind.config.js'];
        const noPackageJson = !result.files['/package.json'];
        
        // Display results
        fileChecks.forEach(check => {
          console.log(`${check.passed ? '✅' : '❌'} ${check.path}`);
          if (!check.exists) console.log('   File not found');
          if (check.exists && !check.validContent) console.log('   Missing required content');
        });
        
        console.log(`${hasPostCSS ? '✅' : '❌'} PostCSS config present`);
        console.log(`${hasTailwind ? '✅' : '❌'} Tailwind config present`);
        console.log(`${noPackageJson ? '✅' : '❌'} No package.json (as expected)`);
        
        const projectPassed = allFilesValid && hasPostCSS && hasTailwind && noPackageJson;
        
        results.push({
          name: testProject.name,
          passed: projectPassed,
          details: {
            filesValid: allFilesValid,
            hasPostCSS,
            hasTailwind,
            noPackageJson
          }
        });
        
      } catch (error) {
        console.error(`❌ Error testing ${testProject.name}:`, error.message);
        results.push({
          name: testProject.name,
          passed: false,
          error: error.message
        });
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const totalPassed = results.filter(r => r.passed).length;
    const totalTests = results.length;
    
    results.forEach(result => {
      console.log(`${result.passed ? '✅' : '❌'} ${result.name}`);
      if (result.error) console.log(`   Error: ${result.error}`);
    });
    
    console.log(`\nTotal: ${totalPassed}/${totalTests} project types passed`);
    
    const allPassed = totalPassed === totalTests;
    
    console.log('\n' + '='.repeat(60));
    console.log(`Multiple Projects Test: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);
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
testMultipleProjects()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });