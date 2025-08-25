/**
 * Complete test for TODO app generation with all fixes
 * This tests that:
 * 1. File content is always string (no object errors)
 * 2. Context patterns are correctly generated
 * 3. Import/export validation passes
 * 4. Build succeeds
 */

const { AgentService } = require('../services/agent-service');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

// ANSI colors
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

async function testTodoAppComplete() {
  console.log(`${colors.blue}=== COMPLETE TODO APP TEST ===${colors.reset}\n`);
  
  const agentService = new AgentService();
  const requirement = "Create a TODO app where users can add, complete, and delete tasks";
  
  console.log(`Testing with requirement: "${requirement}"\n`);
  
  try {
    // Step 1: Generate the app
    console.log(`${colors.yellow}Step 1: Generating TODO app...${colors.reset}`);
    const startTime = Date.now();
    const result = await agentService.processRequirement(requirement);
    const endTime = Date.now();
    
    console.log(`✓ Generated in ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    console.log(`✓ Generated ${Object.keys(result.files).length} files`);
    
    // Step 2: Check for validation feedback
    console.log(`\n${colors.yellow}Step 2: Checking validation...${colors.reset}`);
    if (result.feedback) {
      console.log(`${colors.red}⚠ Validation errors:${colors.reset}`);
      console.log(result.feedback);
    } else {
      console.log(`${colors.green}✓ No validation errors${colors.reset}`);
    }
    
    // Step 3: Analyze generated files
    console.log(`\n${colors.yellow}Step 3: Analyzing generated files...${colors.reset}`);
    
    // Find context file
    const contextFile = Object.keys(result.files).find(f => 
      f.toLowerCase().includes('context') && f.includes('todo')
    );
    
    if (contextFile) {
      console.log(`\n✓ Found context file: ${contextFile}`);
      const content = result.files[contextFile];
      
      // Check exports
      const checks = {
        'TodoContext export': content.includes('export const TodoContext'),
        'useTodoContext export': content.includes('export function useTodoContext'),
        'TodoProvider export': content.includes('export function TodoProvider') || 
                               content.includes('export const TodoProvider'),
        'use client directive': content.trim().startsWith("'use client'"),
        'createContext import': content.includes('createContext'),
        'useContext usage': content.includes('useContext(TodoContext)')
      };
      
      console.log('  Context file checks:');
      for (const [check, passed] of Object.entries(checks)) {
        console.log(`    ${check}: ${passed ? colors.green + '✓' : colors.red + '✗'}${colors.reset}`);
      }
    } else {
      console.log(`${colors.red}✗ No context file found${colors.reset}`);
    }
    
    // Check components
    const components = Object.keys(result.files).filter(f => 
      f.includes('/components/') && (f.endsWith('.tsx') || f.endsWith('.jsx'))
    );
    
    console.log(`\n✓ Found ${components.length} components`);
    
    let importIssues = 0;
    for (const comp of components) {
      const content = result.files[comp];
      const fileName = path.basename(comp);
      
      // Check if it imports from context
      if (content.includes('Context')) {
        const hasImport = content.includes("from '@/context/") || 
                         content.includes('from "../context/');
        const hasUseClient = content.trim().startsWith("'use client'");
        
        if (!hasImport) {
          console.log(`  ${fileName}: ${colors.red}Missing context import${colors.reset}`);
          importIssues++;
        }
        if (!hasUseClient) {
          console.log(`  ${fileName}: ${colors.red}Missing 'use client'${colors.reset}`);
          importIssues++;
        }
      }
    }
    
    if (importIssues === 0) {
      console.log(`  ${colors.green}✓ All component imports look good${colors.reset}`);
    }
    
    // Step 4: Write files to test directory
    console.log(`\n${colors.yellow}Step 4: Writing files to test directory...${colors.reset}`);
    const testDir = path.join(__dirname, 'test-todo-app-output');
    
    // Clean up if exists
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    
    // Create directory structure
    for (const [filePath, content] of Object.entries(result.files)) {
      const fullPath = path.join(testDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
    }
    
    console.log(`✓ Written ${Object.keys(result.files).length} files to ${testDir}`);
    
    // Step 5: Run build test
    console.log(`\n${colors.yellow}Step 5: Running build test...${colors.reset}`);
    
    const buildSuccess = await new Promise((resolve) => {
      const buildProcess = spawn('npm', ['run', 'build'], {
        cwd: testDir,
        shell: true
      });
      
      let output = '';
      buildProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      buildProcess.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      buildProcess.on('close', (code) => {
        if (code !== 0) {
          console.log(`${colors.red}Build failed with code ${code}${colors.reset}`);
          console.log('Build output:', output.slice(-1000)); // Last 1000 chars
        }
        resolve(code === 0);
      });
    });
    
    if (buildSuccess) {
      console.log(`${colors.green}✓ Build succeeded!${colors.reset}`);
    } else {
      console.log(`${colors.red}✗ Build failed${colors.reset}`);
    }
    
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
    
    // Final summary
    console.log(`\n${colors.blue}=== TEST SUMMARY ===${colors.reset}`);
    console.log(`Generation: ${colors.green}✓ Success${colors.reset}`);
    console.log(`Validation: ${result.feedback ? colors.yellow + '⚠ Warnings' : colors.green + '✓ Passed'}${colors.reset}`);
    console.log(`Context Pattern: ${contextFile ? colors.green + '✓ Found' : colors.red + '✗ Missing'}${colors.reset}`);
    console.log(`Build Test: ${buildSuccess ? colors.green + '✓ Passed' : colors.red + '✗ Failed'}${colors.reset}`);
    
    return buildSuccess && !result.feedback;
    
  } catch (error) {
    console.error(`\n${colors.red}Test failed with error:${colors.reset}`, error.message);
    return false;
  }
}

// Run test
if (require.main === module) {
  testTodoAppComplete()
    .then(success => {
      console.log(`\n${success ? colors.green + '✅ All tests passed!' : colors.red + '❌ Some tests failed'}${colors.reset}`);
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}

module.exports = { testTodoAppComplete };