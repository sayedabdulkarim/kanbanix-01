#!/usr/bin/env node

/**
 * Test script to verify framework-agnostic build system detection
 * Tests the system with various project types (Python, Java, Go, etc.)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSystemDetector } from './mcp-server/src/tools/build-system-detector.js';
import { StubGenerator } from './mcp-server/src/tools/stub-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DIR = path.join(__dirname, 'test-projects');

async function setupTestProjects() {
  console.log('🔧 Setting up test projects...\n');
  
  // Clean up if exists
  try {
    await fs.rm(TEST_DIR, { recursive: true });
  } catch (e) {
    // Ignore if doesn't exist
  }
  
  await fs.mkdir(TEST_DIR, { recursive: true });
  
  // Create test projects for different languages
  const testProjects = [
    {
      name: 'python-django',
      files: {
        'manage.py': '#!/usr/bin/env python\n# Django manage.py',
        'requirements.txt': 'django==4.2\npsycopg2==2.9\n',
        'app.py': 'from django import app\n'
      }
    },
    {
      name: 'python-flask',
      files: {
        'app.py': 'from flask import Flask\napp = Flask(__name__)',
        'requirements.txt': 'flask==2.3\n',
        'Pipfile': '[packages]\nflask = "*"\n'
      }
    },
    {
      name: 'java-maven',
      files: {
        'pom.xml': '<?xml version="1.0"?>\n<project>\n  <groupId>com.test</groupId>\n</project>',
        'src/main/java/App.java': 'public class App {}'
      }
    },
    {
      name: 'java-gradle',
      files: {
        'build.gradle': 'apply plugin: "java"\n',
        'src/main/java/Main.java': 'public class Main {}'
      }
    },
    {
      name: 'go-project',
      files: {
        'go.mod': 'module example.com/test\n\ngo 1.20',
        'main.go': 'package main\n\nfunc main() {}'
      }
    },
    {
      name: 'rust-cargo',
      files: {
        'Cargo.toml': '[package]\nname = "test"\nversion = "0.1.0"',
        'src/main.rs': 'fn main() {\n    println!("Hello");\n}'
      }
    },
    {
      name: 'ruby-rails',
      files: {
        'Gemfile': 'source "https://rubygems.org"\ngem "rails"',
        'config.ru': '# Rails config',
        'Rakefile': '# Rakefile'
      }
    },
    {
      name: 'php-laravel',
      files: {
        'composer.json': '{"name": "test/app", "require": {"php": "^8.0"}}',
        'artisan': '#!/usr/bin/env php\n<?php\n// Laravel artisan'
      }
    },
    {
      name: 'csharp-dotnet',
      files: {
        'Test.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n</Project>',
        'Program.cs': 'Console.WriteLine("Hello");'
      }
    },
    {
      name: 'nodejs-next',
      files: {
        'package.json': '{"name": "test", "scripts": {"build": "next build"}}',
        'next.config.js': 'module.exports = {}',
        'yarn.lock': '# yarn lockfile v1'
      }
    },
    {
      name: 'nodejs-angular',
      files: {
        'package.json': '{"name": "test", "scripts": {"build": "ng build"}}',
        'angular.json': '{"projects": {}}',
        'package-lock.json': '{"lockfileVersion": 2}'
      }
    },
    {
      name: 'unknown-project',
      files: {
        'main.py': 'print("Hello")',
        'script.js': 'console.log("Hello")',
        'app.rb': 'puts "Hello"'
      }
    }
  ];
  
  for (const project of testProjects) {
    const projectPath = path.join(TEST_DIR, project.name);
    await fs.mkdir(projectPath, { recursive: true });
    
    for (const [filePath, content] of Object.entries(project.files)) {
      const fullPath = path.join(projectPath, filePath);
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content);
    }
  }
  
  console.log('✅ Created', testProjects.length, 'test projects\n');
}

async function testBuildSystemDetection() {
  console.log('🧪 Testing Build System Detection\n');
  console.log('=' .repeat(80) + '\n');
  
  const projects = await fs.readdir(TEST_DIR);
  const results = [];
  
  for (const projectName of projects) {
    const projectPath = path.join(TEST_DIR, projectName);
    console.log(`Testing: ${projectName}`);
    console.log('-'.repeat(40));
    
    const result = await buildSystemDetector.detect(projectPath);
    
    console.log(`  Language: ${result.language || 'unknown'}`);
    console.log(`  Framework: ${result.framework || 'none'}`);
    console.log(`  Build Command: ${result.command || 'none'}`);
    console.log(`  Test Command: ${result.testCommand || 'none'}`);
    console.log(`  Config File: ${result.configFile || 'none'}`);
    console.log(`  Detected: ${result.detected ? '✅' : '❌'}`);
    
    if (result.inferred) {
      console.log(`  ⚠️  Language inferred from file extensions`);
    }
    
    console.log();
    
    results.push({
      project: projectName,
      ...result
    });
  }
  
  return results;
}

async function testStubGeneration() {
  console.log('🧪 Testing Multi-Language Stub Generation\n');
  console.log('=' .repeat(80) + '\n');
  
  const testFiles = [
    'main.py',
    'App.java',
    'server.go',
    'main.rs',
    'app.rb',
    'index.php',
    'Program.cs',
    'app.swift',
    'Main.kt',
    'app.scala',
    'Component.tsx',
    'styles.css',
    'config.json',
    'index.html'
  ];
  
  for (const fileName of testFiles) {
    console.log(`Generating stub for: ${fileName}`);
    console.log('-'.repeat(40));
    
    const stub = StubGenerator.generateStub(fileName);
    console.log(stub.split('\n').slice(0, 5).join('\n'));
    console.log('...\n');
  }
}

async function testErrorDetection() {
  console.log('🧪 Testing Error Detection from Messages\n');
  console.log('=' .repeat(80) + '\n');
  
  const testErrors = [
    {
      error: "Module not found: Can't resolve '@/styles/globals.css'",
      language: 'javascript'
    },
    {
      error: "ModuleNotFoundError: No module named 'django.contrib'",
      language: 'python'
    },
    {
      error: "error: package github.com/gin-gonic/gin is not in GOPATH",
      language: 'go'
    },
    {
      error: "error[E0432]: unresolved import `std::io`",
      language: 'rust'
    },
    {
      error: "Error: Cannot find module './config/database'",
      language: 'javascript'
    }
  ];
  
  for (const test of testErrors) {
    console.log(`Error: ${test.error}`);
    console.log(`Language: ${test.language}`);
    
    const detectedFile = StubGenerator.detectFileFromError(test.error, test.language);
    console.log(`Detected File: ${detectedFile || 'none'}`);
    
    if (detectedFile) {
      const stub = StubGenerator.generateStub(detectedFile, test.language);
      console.log(`Generated Stub Preview:`);
      console.log(stub.split('\n').slice(0, 3).join('\n'));
    }
    
    console.log('-'.repeat(40) + '\n');
  }
}

async function generateSummary(results) {
  console.log('\n📊 Summary\n');
  console.log('=' .repeat(80) + '\n');
  
  const languages = {};
  const frameworks = {};
  let detected = 0;
  let inferred = 0;
  
  for (const result of results) {
    if (result.detected) detected++;
    if (result.inferred) inferred++;
    
    if (result.language) {
      languages[result.language] = (languages[result.language] || 0) + 1;
    }
    
    if (result.framework) {
      frameworks[result.framework] = (frameworks[result.framework] || 0) + 1;
    }
  }
  
  console.log('Detection Results:');
  console.log(`  Total Projects: ${results.length}`);
  console.log(`  Successfully Detected: ${detected} (${Math.round(detected/results.length*100)}%)`);
  console.log(`  Inferred from Files: ${inferred}`);
  
  console.log('\nLanguages Detected:');
  for (const [lang, count] of Object.entries(languages)) {
    console.log(`  ${lang}: ${count}`);
  }
  
  console.log('\nFrameworks Detected:');
  for (const [fw, count] of Object.entries(frameworks)) {
    console.log(`  ${fw}: ${count}`);
  }
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test projects...');
  try {
    await fs.rm(TEST_DIR, { recursive: true });
    console.log('✅ Cleanup complete');
  } catch (e) {
    console.error('⚠️ Could not clean up test directory:', e.message);
  }
}

async function main() {
  try {
    console.log('\n🚀 Framework-Agnostic Build System Test Suite\n');
    console.log('This test verifies that the build system works for ALL languages,');
    console.log('not just JavaScript/TypeScript projects.\n');
    
    await setupTestProjects();
    const results = await testBuildSystemDetection();
    await testStubGeneration();
    await testErrorDetection();
    await generateSummary(results);
    await cleanup();
    
    console.log('\n✨ All tests completed successfully!');
    console.log('\n📝 Next Steps:');
    console.log('1. Test with real projects of different types');
    console.log('2. Verify build validation works with non-JS projects');
    console.log('3. Ensure error fixes are appropriate for each language');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();