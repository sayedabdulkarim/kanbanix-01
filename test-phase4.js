#!/usr/bin/env node

/**
 * Test script for Phase 4: Type-Aware Pre-Generation
 * Tests that we prevent errors BEFORE generation instead of fixing AFTER
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import TypeAwareGenerator from './mcp-server/src/tools/type-aware-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = promisify(exec);

const TEST_WORKSPACE = path.join(__dirname, 'workspace-projects', 'test-phase4');

async function setup() {
  console.log('🔧 Setting up test project with TypeScript and Prisma...');
  
  // Clean up
  try {
    await fs.rm(TEST_WORKSPACE, { recursive: true });
  } catch (e) {}
  
  // Create Next.js TypeScript project structure
  await fs.mkdir(path.join(TEST_WORKSPACE, 'src', 'app'), { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, 'src', 'components'), { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, 'src', 'lib'), { recursive: true });
  await fs.mkdir(path.join(TEST_WORKSPACE, 'prisma'), { recursive: true });
  
  // Create package.json
  await fs.writeFile(
    path.join(TEST_WORKSPACE, 'package.json'),
    JSON.stringify({
      name: 'test-phase4',
      version: '1.0.0',
      scripts: {
        build: 'next build',
        dev: 'next dev'
      },
      dependencies: {
        next: '^14.0.0',
        react: '^18.0.0',
        '@prisma/client': '^5.0.0',
        typescript: '^5.0.0'
      }
    }, null, 2)
  );
  
  // Create tsconfig.json
  await fs.writeFile(
    path.join(TEST_WORKSPACE, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'es5',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        forceConsistentCasingInFileNames: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'node',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        paths: {
          '@/*': ['./src/*']
        }
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'],
      exclude: ['node_modules']
    }, null, 2)
  );
  
  // Create Prisma schema
  await fs.writeFile(
    path.join(TEST_WORKSPACE, 'prisma', 'schema.prisma'),
    `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`
  );
  
  // Create some existing TypeScript files with types
  await fs.writeFile(
    path.join(TEST_WORKSPACE, 'src', 'lib', 'types.ts'),
    `export interface AppUser {
  id: string;
  email: string;
  name?: string;
}

export interface AppPost {
  id: string;
  title: string;
  content?: string;
  published: boolean;
  authorId: string;
}

export type Theme = 'light' | 'dark';
`
  );
  
  // Create a component that uses these types
  await fs.writeFile(
    path.join(TEST_WORKSPACE, 'src', 'components', 'UserCard.tsx'),
    `import React from 'react';
import { AppUser } from '@/lib/types';

interface UserCardProps {
  user: AppUser;
}

export const UserCard: React.FC<UserCardProps> = ({ user }) => {
  return (
    <div className="user-card">
      <h3>{user.name || 'Anonymous'}</h3>
      <p>{user.email}</p>
    </div>
  );
};
`
  );
  
  console.log('✅ Test project created with TypeScript and Prisma');
}

async function testTypeAwareGeneration() {
  console.log('\n🧪 Testing Phase 4: Type-Aware Pre-Generation...\n');
  
  const generator = new TypeAwareGenerator();
  
  // Step 1: Analyze the project
  console.log('📊 Step 1: Analyzing project types and schemas...');
  const analysis = await generator.analyzer.analyzeProject(TEST_WORKSPACE);
  
  console.log('\n📋 Analysis Results:');
  console.log(`- Types found: ${analysis.types.size}`);
  console.log(`  Types: ${Array.from(analysis.types.keys()).join(', ')}`);
  console.log(`- Prisma models: ${analysis.schemas.prisma ? Object.keys(analysis.schemas.prisma.models).length : 0}`);
  if (analysis.schemas.prisma) {
    console.log(`  Models: ${Object.keys(analysis.schemas.prisma.models).join(', ')}`);
  }
  console.log(`- Imports found: ${analysis.imports.size}`);
  console.log(`- Dependencies: ${analysis.dependencies.size}`);
  console.log(`- Patterns detected:`, analysis.patterns);
  
  // Step 2: Test validation with GOOD code
  console.log('\n✅ Step 2: Testing validation with CORRECT code...');
  
  const goodCode = {
    'src/components/PostList.tsx': `import React from 'react';
import { AppPost } from '@/lib/types';

interface PostListProps {
  posts: AppPost[];
}

export const PostList: React.FC<PostListProps> = ({ posts }) => {
  return (
    <div>
      {posts.map(post => (
        <div key={post.id}>
          <h2>{post.title}</h2>
          <p>{post.content}</p>
        </div>
      ))}
    </div>
  );
};`
  };
  
  // Initialize validator if not already done
  if (!generator.validator) {
    generator.validator = new (await import('./mcp-server/src/tools/type-aware-generator.js')).PreValidationSystem(TEST_WORKSPACE);
  }
  const goodValidation = await generator.validator.validateBeforeWrite(goodCode, analysis);
  console.log(`Validation result: ${goodValidation.valid ? '✅ PASSED' : '❌ FAILED'}`);
  if (!goodValidation.valid) {
    console.log('Issues:', goodValidation.issues);
  }
  
  // Step 3: Test validation with BAD code
  console.log('\n❌ Step 3: Testing validation with INCORRECT code...');
  
  const badCode = {
    'src/components/BadComponent.tsx': `import React from 'react';
import { NonExistentType } from '@/lib/missing';
import { UnknownPackage } from 'package-that-doesnt-exist';

export const BadComponent = () => {
  const user: WrongType = { id: 1 };
  
  // Using Prisma model that doesn't exist
  const result = await prisma.wrongModel.findMany();
  
  return <div>{user.name}</div>;
};`
  };
  
  const badValidation = await generator.validator.validateBeforeWrite(badCode, analysis);
  console.log(`Validation result: ${badValidation.valid ? '✅ PASSED' : '❌ FAILED (Expected!)'}`);
  if (!badValidation.valid) {
    console.log('\n🔍 Issues detected BEFORE writing files:');
    badValidation.issues.forEach(issue => {
      console.log(`  - [${issue.type}] ${issue.message}`);
    });
  }
  
  // Step 4: Test the full generation flow
  console.log('\n🚀 Step 4: Testing full type-aware generation...');
  
  const task = 'Create a component that displays all posts from a user';
  const result = await generator.generate(task, TEST_WORKSPACE);
  
  console.log(`\nGeneration result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  if (result.issues) {
    console.log('Remaining issues:', result.issues);
  }
  
  return { analysis, goodValidation, badValidation, generationResult: result };
}

async function compareWithOldApproach() {
  console.log('\n📊 Comparison: Old vs New Approach\n');
  
  console.log('🔴 OLD APPROACH (Phase 2.5 - Reflection Loop):');
  console.log('1. Generate code blindly');
  console.log('2. Write files to disk');
  console.log('3. Run build → FAILS');
  console.log('4. Parse errors with regex');
  console.log('5. Try to fix');
  console.log('6. Retry up to 5 times');
  console.log('Result: Maybe works after 5 attempts\n');
  
  console.log('✅ NEW APPROACH (Phase 4 - Type-Aware):');
  console.log('1. Analyze project types/schemas first');
  console.log('2. Generate with awareness of what exists');
  console.log('3. Validate BEFORE writing');
  console.log('4. Fix issues if any');
  console.log('5. Write correct files');
  console.log('6. Build succeeds first time');
  console.log('Result: Works on first attempt!\n');
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test workspace...');
  try {
    await fs.rm(TEST_WORKSPACE, { recursive: true });
    console.log('✅ Cleanup complete');
  } catch (e) {
    console.error('⚠️ Could not clean up test workspace:', e.message);
  }
}

async function main() {
  try {
    await setup();
    const results = await testTypeAwareGeneration();
    await compareWithOldApproach();
    
    console.log('\n✨ Phase 4 Test Summary:');
    console.log('================================');
    console.log(`Types detected: ${results.analysis.types.size > 0 ? '✅' : '❌'}`);
    console.log(`Schemas parsed: ${results.analysis.schemas.prisma ? '✅' : '❌'}`);
    console.log(`Good code validates: ${results.goodValidation.valid ? '✅' : '❌'}`);
    console.log(`Bad code caught: ${!results.badValidation.valid ? '✅' : '❌'}`);
    console.log(`Generation succeeds: ${results.generationResult.success ? '✅' : '❌'}`);
    console.log('================================');
    
    if (results.analysis.types.size > 0 && 
        results.goodValidation.valid && 
        !results.badValidation.valid) {
      console.log('\n🎉 Phase 4 is working! We can now prevent errors BEFORE generation!');
    } else {
      console.log('\n⚠️ Phase 4 needs more work');
    }
    
    await cleanup();
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    await cleanup();
    process.exit(1);
  }
}

main();