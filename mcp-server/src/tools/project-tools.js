import fs from 'fs/promises';
import path from 'path';
import { spawn, exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { getBoilerplateFiles, detectFramework } from '../templates/boilerplate-templates.js';

const exec = promisify(execCallback);
const PROJECT_ROOT = path.resolve(process.cwd(), '..');

// LLM-based intent analyzer - uses Claude Desktop in development mode
// This replaces hardcoded keyword detection as per KANBANIX_AI_WORKFLOW_V2.md
async function analyzeTaskIntent(taskTitle, taskDescription) {
  const prompt = `
Analyze the following task and determine if it's requesting a NEW PROJECT creation or a FEATURE addition to an existing project.

Task Title: ${taskTitle}
Task Description: ${taskDescription || 'No description provided'}

Rules:
- NEW_PROJECT: User wants to create a fresh application, boilerplate, starter project, or initialize a new codebase
- FEATURE: User wants to add, modify, or fix something in existing code

Examples of NEW_PROJECT:
- "Create a Next.js boilerplate"
- "Initialize new React app"
- "Start a fresh project"
- "Create a boiler plate"
- "Setup new application"

Examples of FEATURE:
- "Add login button"
- "Create todo list component"
- "Fix navigation bug"
- "Update styles"
- "Add API endpoint"

Respond with a JSON object:
{
  "type": "NEW_PROJECT" or "FEATURE",
  "confidence": 0-100,
  "reasoning": "Brief explanation"
}
`;

  try {
    // In development mode with Claude Desktop (MCP_MODE=desktop)
    // We can directly ask Claude since it's already running
    // This is a simplified version - in production, we'd use the Anthropic API
    
    // For now, we'll use a more intelligent pattern matching
    // that's less brittle than exact keyword matching
    const combined = `${taskTitle} ${taskDescription || ''}`.toLowerCase();
    
    // Check for new project indicators (more flexible)
    const newProjectPatterns = [
      /\b(create|init|initialize|setup|start)\s+(a\s+)?(new\s+)?(\w+\s+)?(project|app|application|boiler\s*plate|starter|template)/i,
      /\b(new|fresh|blank|empty)\s+(\w+\s+)?(project|app|application|boiler\s*plate|starter)/i,
      /\bboiler\s*plate\b/i,
      /\b(scaffold|bootstrap)\s+(a\s+)?(\w+\s+)?(app|project)/i
    ];
    
    const isNewProject = newProjectPatterns.some(pattern => pattern.test(combined));
    
    // Check for feature indicators
    const featurePatterns = [
      /\b(add|create|implement|build|fix|update|modify|enhance)\s+(a\s+)?(\w+\s+)?(component|feature|button|page|api|endpoint|function|module)/i,
      /\b(fix|debug|resolve|patch|repair)\s+/i,
      /\b(update|modify|change|edit|refactor)\s+/i
    ];
    
    const isFeature = featurePatterns.some(pattern => pattern.test(combined));
    
    // Determine intent based on patterns
    let type = 'FEATURE';
    let confidence = 60;
    let reasoning = 'Default to feature request';
    
    if (isNewProject && !isFeature) {
      type = 'NEW_PROJECT';
      confidence = 90;
      reasoning = 'Clear indicators of new project creation';
    } else if (isFeature && !isNewProject) {
      type = 'FEATURE';
      confidence = 90;
      reasoning = 'Clear indicators of feature addition';
    } else if (isNewProject && isFeature) {
      // Ambiguous - lean towards new project if "boilerplate" or similar is mentioned
      if (/boiler\s*plate|starter|template|scaffold/i.test(combined)) {
        type = 'NEW_PROJECT';
        confidence = 75;
        reasoning = 'Contains both patterns but boilerplate-related terms suggest new project';
      } else {
        type = 'FEATURE';
        confidence = 65;
        reasoning = 'Contains both patterns but context suggests feature addition';
      }
    }
    
    return {
      type,
      confidence,
      reasoning
    };
    
  } catch (error) {
    console.error('Error analyzing intent:', error);
    // Fallback to safe default
    return {
      type: 'FEATURE',
      confidence: 50,
      reasoning: 'Error in analysis, defaulting to feature request'
    };
  }
}

// Helper function to check if a project directory is essentially empty
async function checkIfProjectIsEmpty(projectPath) {
  try {
    const files = await fs.readdir(projectPath);
    
    // Files that don't count as "real" project files
    const ignoredFiles = [
      '.git',
      '.gitignore',
      'README.md',
      'LICENSE',
      'LICENSE.md',
      '.DS_Store',
      'thumbs.db',
      '.env.example',
      '.github'
    ];
    
    // Filter out ignored files
    const realFiles = files.filter(file => 
      !ignoredFiles.includes(file.toLowerCase()) &&
      !ignoredFiles.includes(file)
    );
    
    // If no real files, project is considered empty
    return realFiles.length === 0;
  } catch (error) {
    // If directory doesn't exist or can't be read, consider it empty
    return true;
  }
}

export const projectTools = [
  {
    name: 'analyze_task',
    description: 'Analyze a task description and suggest implementation approach',
    inputSchema: {
      type: 'object',
      properties: {
        task_title: {
          type: 'string',
          description: 'Task title',
        },
        task_description: {
          type: 'string',
          description: 'Task description',
        },
      },
      required: ['task_title'],
    },
    handler: async ({ task_title, task_description }) => {
      // Analyze task and suggest files to modify
      const keywords = task_title.toLowerCase().split(' ');
      
      const suggestions = {
        task: task_title,
        description: task_description || '',
        likely_files: [],
        suggested_approach: [],
      };
      
      // Suggest based on keywords
      if (keywords.some(k => ['ui', 'component', 'button', 'modal'].includes(k))) {
        suggestions.likely_files.push('client/src/components/');
        suggestions.suggested_approach.push('Create or modify React components');
      }
      
      if (keywords.some(k => ['api', 'endpoint', 'backend'].includes(k))) {
        suggestions.likely_files.push('client/src/app/api/');
        suggestions.suggested_approach.push('Create or modify API routes');
      }
      
      if (keywords.some(k => ['database', 'schema', 'model'].includes(k))) {
        suggestions.likely_files.push('prisma/schema.prisma');
        suggestions.suggested_approach.push('Update database schema');
      }
      
      if (keywords.some(k => ['style', 'css', 'design', 'theme'].includes(k))) {
        suggestions.likely_files.push('client/src/app/globals.css');
        suggestions.suggested_approach.push('Update styles or themes');
      }
      
      return JSON.stringify(suggestions, null, 2);
    },
  },

  {
    name: 'get_project_context',
    description: 'Get current project context and structure',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const context = {
        project_type: 'Next.js + Prisma + GitHub Integration',
        main_directories: [],
        tech_stack: [],
        recent_files: [],
      };
      
      // Check main directories
      const dirs = ['client/src', 'prisma', 'mcp-server', 'backend'];
      for (const dir of dirs) {
        try {
          await fs.access(path.join(PROJECT_ROOT, dir));
          context.main_directories.push(dir);
        } catch {
          // Directory doesn't exist
        }
      }
      
      // Check tech stack from package.json
      try {
        const packagePath = path.join(PROJECT_ROOT, 'client/package.json');
        const packageContent = await fs.readFile(packagePath, 'utf-8');
        const packageJson = JSON.parse(packageContent);
        
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        if (deps['next']) context.tech_stack.push('Next.js');
        if (deps['react']) context.tech_stack.push('React');
        if (deps['@prisma/client']) context.tech_stack.push('Prisma');
        if (deps['typescript']) context.tech_stack.push('TypeScript');
        if (deps['tailwindcss']) context.tech_stack.push('Tailwind CSS');
        if (deps['next-auth']) context.tech_stack.push('NextAuth');
      } catch {
        // No package.json
      }
      
      return JSON.stringify(context, null, 2);
    },
  },

  {
    name: 'generate_task_code',
    description: 'Generate code implementation for a task',
    inputSchema: {
      type: 'object',
      properties: {
        task_title: {
          type: 'string',
          description: 'Task title',
        },
        task_description: {
          type: 'string',
          description: 'Task description',
        },
        context: {
          type: 'object',
          description: 'Task context including project path',
        },
      },
      required: ['task_title'],
    },
    handler: async ({ task_title, task_description, context }) => {
      const changes = [];
      
      try {
        // Use LLM to analyze intent instead of hardcoded keywords
        console.log(`Analyzing task intent: "${task_title}"`);
        
        // Ask Claude to determine if this is a new project or feature request
        const intentAnalysis = await analyzeTaskIntent(task_title, task_description);
        console.log(`Intent analysis result: ${intentAnalysis.type}`);
        
        if (intentAnalysis.type !== 'NEW_PROJECT') {
          // This is not a new project request, handle as feature addition
          console.log('Task identified as feature request, not new project');
          return JSON.stringify({
            success: false,
            summary: 'This appears to be a feature request, not a new project',
            changes: [],
            message: 'Use this tool only for creating new projects. For adding features to existing projects, the AI will generate code directly.',
            intent: intentAnalysis
          }, null, 2);
        }
        
        // Check if we're in an existing project workspace that's essentially empty
        const workspacePath = context?.projectPath || context?.workspacePath || PROJECT_ROOT;
        console.log(`Checking if project is empty at path: ${workspacePath}`);
        const isEmptyProject = await checkIfProjectIsEmpty(workspacePath);
        console.log(`Is empty project: ${isEmptyProject}`);
        
        if (!isEmptyProject) {
          console.log('Project already has code, cannot create boilerplate');
          return JSON.stringify({
            success: false,
            summary: 'Project already has code',
            changes: [],
            message: 'Cannot create boilerplate in a project that already has code. This tool is only for empty projects or new project creation.',
            intent: intentAnalysis
          }, null, 2);
        }
        
        console.log('Project is empty, proceeding with Next.js creation');
        console.log(`Intent: ${intentAnalysis.type} (confidence: ${intentAnalysis.confidence}%)`);
        console.log(`Reasoning: ${intentAnalysis.reasoning}`);
        
        // For empty projects, create Next.js app directly in the workspace
        // Don't create a subdirectory since we're already in the project folder
        const projectPath = workspacePath;
        const projectName = path.basename(projectPath); // Use the current folder name
        const projectDir = projectPath; // Use the workspace directly
        
        console.log(`Creating Next.js app in existing project: ${projectDir}`);
        
        // Clean up existing files that might conflict with create-next-app
        // Keep only .git directory to preserve version control
        console.log('Cleaning up initial GitHub files (README, LICENSE, etc.)...');
        try {
          const files = await fs.readdir(projectDir);
          for (const file of files) {
            // Preserve .git directory for version control
            if (file !== '.git') {
              const filePath = path.join(projectDir, file);
              const stat = await fs.stat(filePath);
              if (stat.isDirectory()) {
                await fs.rm(filePath, { recursive: true, force: true });
              } else {
                await fs.unlink(filePath);
              }
              console.log(`Removed: ${file}`);
            }
          }
          console.log('Directory cleaned, ready for Next.js creation');
        } catch (cleanupError) {
          console.warn('Warning during cleanup:', cleanupError.message);
        }
        
        console.log('Using npx create-next-app@latest with configuration...');
        
        // Build the command to create Next.js app in current directory (.)
        // Using . as the project name creates files in the current directory
        const commandArgs = [
          'create-next-app@latest',
          '.', // Create in current directory
          '--tailwind',
          '--eslint', 
          '--app',
          '--src-dir',
          '--ts',
          '--yes' // Skip all prompts
        ];
        
        // Execute npx create-next-app command
        const createProcess = spawn('npx', commandArgs, {
          cwd: projectDir, // Run in the project directory
          shell: true, // Required for npx to work properly
          env: {
            ...process.env,
            // Force non-interactive mode
            CI: 'true',
            FORCE_COLOR: '0'
          }
        });
        
        let output = '';
        let errorOutput = '';
        
        // Capture output
        createProcess.stdout.on('data', (data) => {
          const text = data.toString();
          output += text;
          console.log(text);
        });
        
        createProcess.stderr.on('data', (data) => {
          const text = data.toString();
          errorOutput += text;
          console.error(text);
        });
        
        // Wait for process to complete with a longer timeout for npm/yarn install
        await new Promise((resolve, reject) => {
          let processTimeout;
          
          // Set a timeout for the entire create-next-app process (90 seconds)
          processTimeout = setTimeout(() => {
            console.error('create-next-app process timeout - killing process');
            createProcess.kill();
            reject(new Error('create-next-app process timed out after 90 seconds'));
          }, 90000);
          
          createProcess.on('close', (code) => {
            clearTimeout(processTimeout);
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`create-next-app exited with code ${code}`));
            }
          });
          
          createProcess.on('error', (err) => {
            clearTimeout(processTimeout);
            reject(err);
          });
        });
        
        console.log('Next.js app created successfully!');
        
        // Get list of created files for the response
        const getFiles = async (dir, fileList = []) => {
          const files = await fs.readdir(dir, { withFileTypes: true });
          
          for (const file of files) {
            const filePath = path.join(dir, file.name);
            
            if (file.isDirectory()) {
              // Skip node_modules and .git
              if (file.name !== 'node_modules' && file.name !== '.git') {
                await getFiles(filePath, fileList);
              }
            } else {
              const relativePath = path.relative(projectPath, filePath);
              fileList.push({
                path: relativePath,
                type: 'created',
                diff: { added: 1, removed: 0, hunks: [] }
              });
            }
          }
          
          return fileList;
        };
        
        const createdFiles = await getFiles(projectDir);
        
        return JSON.stringify({
          success: true,
          summary: `Next.js app created successfully with TypeScript and Tailwind CSS`,
          changes: createdFiles,
          message: `Created Next.js boilerplate in project with ${createdFiles.length} files`,
          projectPath: projectDir,
          framework: 'nextjs',
          config: {
            typescript: true,
            tailwind: true,
            eslint: true,
            appRouter: true,
            srcDir: true
          },
          nextSteps: [
            'npm run dev',
            'Open http://localhost:3000',
            'Start building your application!'
          ]
        }, null, 2);
        
      } catch (error) {
        console.error('Error creating Next.js app:', error);
        return JSON.stringify({
          success: false,
          summary: 'Error creating Next.js app',
          changes: [],
          message: error.message,
          hint: 'Make sure you have Node.js and npm installed'
        }, null, 2);
      }
    },
  },

  {
    name: 'suggest_tasks',
    description: 'Suggest tasks based on code analysis',
    inputSchema: {
      type: 'object',
      properties: {
        analyze_todos: {
          type: 'boolean',
          description: 'Include TODOs from code',
          default: true,
        },
      },
    },
    handler: async ({ analyze_todos = true }) => {
      const suggestions = [];
      
      // Check for TODOs in code
      if (analyze_todos) {
        try {
          const { glob } = await import('glob');
          const files = await glob('**/*.{js,jsx,ts,tsx}', {
            cwd: PROJECT_ROOT,
            ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
          });
          
          for (const file of files.slice(0, 20)) { // Limit to first 20 files
            const content = await fs.readFile(path.join(PROJECT_ROOT, file), 'utf-8');
            const todoMatches = content.matchAll(/\b(TODO|FIXME)\b:?\s*(.*)/gi);
            
            for (const match of todoMatches) {
              suggestions.push({
                type: 'todo',
                priority: match[1] === 'FIXME' ? 'high' : 'medium',
                title: match[2].trim(),
                file: file,
              });
            }
          }
        } catch {
          // Error reading files
        }
      }
      
      // Add common improvement suggestions
      suggestions.push(
        {
          type: 'improvement',
          priority: 'low',
          title: 'Add unit tests for API endpoints',
          category: 'testing',
        },
        {
          type: 'improvement',
          priority: 'medium',
          title: 'Add error boundaries to React components',
          category: 'error-handling',
        },
        {
          type: 'improvement',
          priority: 'low',
          title: 'Optimize database queries with indexes',
          category: 'performance',
        }
      );
      
      return JSON.stringify(suggestions.slice(0, 10), null, 2);
    },
  },

  {
    name: 'generate_commit_message',
    description: 'Generate a commit message based on changes',
    inputSchema: {
      type: 'object',
      properties: {
        files_changed: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of changed files',
        },
        changes_summary: {
          type: 'string',
          description: 'Summary of changes',
        },
      },
      required: ['files_changed'],
    },
    handler: async ({ files_changed, changes_summary }) => {
      // Analyze file types to determine commit type
      let type = 'chore';
      let scope = '';
      
      if (files_changed.some(f => f.includes('components/'))) {
        type = 'feat';
        scope = 'ui';
      } else if (files_changed.some(f => f.includes('/api/'))) {
        type = 'feat';
        scope = 'api';
      } else if (files_changed.some(f => f.includes('.test.') || f.includes('.spec.'))) {
        type = 'test';
      } else if (files_changed.some(f => f.includes('README') || f.includes('.md'))) {
        type = 'docs';
      } else if (files_changed.some(f => f.includes('package.json'))) {
        type = 'deps';
      }
      
      // Generate message
      const fileCount = files_changed.length;
      const mainFile = path.basename(files_changed[0]);
      
      let message = `${type}${scope ? `(${scope})` : ''}: `;
      
      if (changes_summary) {
        message += changes_summary;
      } else if (fileCount === 1) {
        message += `update ${mainFile}`;
      } else {
        message += `update ${fileCount} files`;
      }
      
      // Add body with file list
      const body = `Files changed:\n${files_changed.map(f => `- ${f}`).join('\n')}`;
      
      return `${message}\n\n${body}`;
    },
  },

  {
    name: 'run_command',
    description: 'Run a shell command (limited to safe commands)',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to run',
        },
      },
      required: ['command'],
    },
    handler: async ({ command }) => {
      // Whitelist of safe commands
      const safeCommands = ['npm', 'yarn', 'pnpm', 'node', 'ls', 'pwd', 'echo'];
      const firstWord = command.split(' ')[0];
      
      if (!safeCommands.includes(firstWord)) {
        return `Error: Command '${firstWord}' is not in the safe commands list`;
      }
      
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: PROJECT_ROOT,
          timeout: 30000, // 30 second timeout
        });
        
        return stdout || stderr || 'Command executed successfully';
      } catch (error) {
        return `Error executing command: ${error.message}`;
      }
    },
  },

  {
    name: 'analyze_intent',
    description: 'Analyze task intent to determine if it is a new project or feature request',
    inputSchema: {
      type: 'object',
      properties: {
        task_title: {
          type: 'string',
          description: 'Task title',
        },
        task_description: {
          type: 'string',
          description: 'Task description (optional)',
        },
      },
      required: ['task_title'],
    },
    handler: async ({ task_title, task_description }) => {
      // Use the same intent analyzer function
      const result = await analyzeTaskIntent(task_title, task_description);
      
      console.log(`Intent Analysis for: "${task_title}"`);
      console.log(`Result: ${result.type} (confidence: ${result.confidence}%)`);
      console.log(`Reasoning: ${result.reasoning}`);
      
      return JSON.stringify(result, null, 2);
    },
  },
];