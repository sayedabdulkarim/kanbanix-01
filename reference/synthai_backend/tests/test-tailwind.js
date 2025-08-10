/**
 * Test Tailwind CSS configuration and usage
 */

const path = require('path');
const fs = require('fs').promises;

// Mock API key for testing
process.env.OPENROUTER_API_KEY = 'mock-api-key-for-testing';

async function testTailwindConfiguration() {
  console.log('\n' + '='.repeat(60));
  console.log('🎨 TESTING TAILWIND CSS CONFIGURATION');
  console.log('='.repeat(60));
  
  try {
    const { AgentService } = require('../services/agent-service');
    const service = new AgentService();
    
    // Mock project with various Tailwind patterns (good and bad)
    service.taskGenerator = {
      generatePRD: async () => 'PRD for styled app',
      generateProject: async (prd, projectPath) => {
        const files = {
          // CORRECT: Tailwind directives only in globals.css
          'src/app/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom styles */
.custom-button {
  @apply px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600;
}`,
          
          // CORRECT: Component using Tailwind classes
          'src/components/Button.tsx': `'use client';

export default function Button({ children, onClick }) {
  return (
    <button 
      onClick={onClick}
      className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
    >
      {children}
    </button>
  );
}`,
          
          // CORRECT: No import of tailwindcss
          'src/components/Card.tsx': `'use client';

export default function Card({ title, content }) {
  return (
    <div className="p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-2">{title}</h2>
      <p className="text-gray-700">{content}</p>
    </div>
  );
}`,
          
          // CORRECT: Using Tailwind animation classes
          'src/components/Spinner.tsx': `'use client';

export default function Spinner() {
  return (
    <div className="flex justify-center items-center p-4">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>
  );
}`,
          
          // CORRECT: Complex layout with Tailwind
          'src/app/page.tsx': `'use client';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Spinner from '@/components/Spinner';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-center mb-8">Tailwind Test App</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card title="Card 1" content="This is a test card" />
          <Card title="Card 2" content="Using Tailwind classes" />
          <Card title="Card 3" content="No CSS imports needed" />
        </div>
        
        <div className="mt-8 flex justify-center gap-4">
          <Button onClick={() => console.log('clicked')}>Click Me</Button>
          <Spinner />
        </div>
      </div>
    </main>
  );
}`,
          
          // CORRECT: Layout without Tailwind imports
          'src/app/layout.tsx': `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tailwind Test App",
  description: "Testing Tailwind configuration",
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
          
          // CORRECT: Tailwind config
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
          
          // CORRECT: PostCSS config for Tailwind v3
          'postcss.config.js': `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`,
          
          // Required files
          'package.json': JSON.stringify({
            name: 'tailwind-test',
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
            },
            devDependencies: {
              tailwindcss: '^3.0.0',
              autoprefixer: '^10.0.0',
              postcss: '^8.0.0',
              typescript: '^5.0.0'
            }
          }, null, 2),
          
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
          tasks: [{ name: 'Generate with Tailwind', completed: true }],
          summary: 'Generated with proper Tailwind setup',
          generatedFiles: Object.keys(files).map(p => ({ path: p }))
        };
      }
    };
    
    const result = await service.processRequirement('Create styled app with Tailwind');
    
    console.log('\n📋 Validating Tailwind Configuration:');
    console.log('─'.repeat(40));
    
    // Check for anti-patterns
    const antiPatterns = [];
    
    for (const [filePath, content] of Object.entries(result.files)) {
      // Check for direct tailwindcss imports
      if (content.includes("import 'tailwindcss'") || 
          content.includes('import "tailwindcss"') ||
          content.includes("require('tailwindcss')") ||
          content.includes('require("tailwindcss")')) {
        antiPatterns.push({
          file: filePath,
          issue: 'Direct import of tailwindcss',
          found: true
        });
      }
      
      // Check for @tailwind directives in wrong files
      if (filePath !== '/src/app/globals.css' && 
          (content.includes('@tailwind base') ||
           content.includes('@tailwind components') ||
           content.includes('@tailwind utilities'))) {
        antiPatterns.push({
          file: filePath,
          issue: '@tailwind directives outside globals.css',
          found: true
        });
      }
      
      // Check for CSS-in-JS
      if (content.includes('styled-components') ||
          content.includes('@emotion/styled') ||
          content.includes('styled.')) {
        antiPatterns.push({
          file: filePath,
          issue: 'CSS-in-JS library usage',
          found: true
        });
      }
    }
    
    // Positive checks
    const checks = {
      hasGlobalsCss: !!result.files['/src/app/globals.css'],
      globalsCssHasTailwind: result.files['/src/app/globals.css']?.includes('@tailwind base'),
      hasTailwindConfig: !!result.files['/tailwind.config.js'],
      hasPostCSSConfig: !!result.files['/postcss.config.js'],
      tailwindInDevDeps: result.files['/package.json']?.includes('"tailwindcss"'),
      noDirectImports: antiPatterns.filter(p => p.issue.includes('Direct import')).length === 0,
      tailwindOnlyInGlobals: antiPatterns.filter(p => p.issue.includes('outside globals.css')).length === 0,
      noCSSinJS: antiPatterns.filter(p => p.issue.includes('CSS-in-JS')).length === 0,
      componentsUseTailwindClasses: result.files['/src/components/Button.tsx']?.includes('className=')
    };
    
    console.log(`${checks.hasGlobalsCss ? '✅' : '❌'} Has globals.css file`);
    console.log(`${checks.globalsCssHasTailwind ? '✅' : '❌'} globals.css contains @tailwind directives`);
    console.log(`${checks.hasTailwindConfig ? '✅' : '❌'} Has tailwind.config.js`);
    console.log(`${checks.hasPostCSSConfig ? '✅' : '❌'} Has postcss.config.js`);
    console.log(`${checks.tailwindInDevDeps ? '✅' : '❌'} Tailwind in devDependencies`);
    console.log(`${checks.noDirectImports ? '✅' : '❌'} No direct tailwindcss imports`);
    console.log(`${checks.tailwindOnlyInGlobals ? '✅' : '❌'} @tailwind only in globals.css`);
    console.log(`${checks.noCSSinJS ? '✅' : '❌'} No CSS-in-JS libraries`);
    console.log(`${checks.componentsUseTailwindClasses ? '✅' : '❌'} Components use Tailwind classes`);
    
    if (antiPatterns.length > 0) {
      console.log('\n❌ Anti-patterns found:');
      antiPatterns.forEach(p => {
        console.log(`   - ${p.file}: ${p.issue}`);
      });
    }
    
    // Check PostCSS config format
    console.log('\n📋 PostCSS Configuration:');
    const postcssContent = result.files['/postcss.config.js'];
    if (postcssContent) {
      const isV3Format = postcssContent.includes('tailwindcss: {}');
      const isV4Format = postcssContent.includes("'@tailwindcss/postcss'");
      console.log(`${isV3Format ? '✅' : '⚠️'} Using Tailwind v3 PostCSS format`);
      if (isV4Format) {
        console.log('⚠️  Note: Using Tailwind v4 format (requires @tailwindcss/postcss)');
      }
    }
    
    const allPassed = Object.values(checks).every(v => v) && antiPatterns.length === 0;
    
    console.log('\n' + '='.repeat(60));
    console.log(`Tailwind Test: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);
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
testTailwindConfiguration()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });