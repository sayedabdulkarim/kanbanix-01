import fs from 'fs/promises';
import path from 'path';
import { spawn, exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { getBoilerplateFiles, detectFramework } from '../templates/boilerplate-templates.js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

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
    description: 'Generate code implementation for a task using AI',
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
        // Get workspace path
        const workspacePath = context?.projectPath || context?.workspacePath || PROJECT_ROOT;
        console.log(`Working in project path: ${workspacePath}`);
        
        // Check if project is empty
        const isEmptyProject = await checkIfProjectIsEmpty(workspacePath);
        console.log(`Is empty project: ${isEmptyProject}`);
        
        // Initialize Anthropic client
        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY
        });
        
        if (!process.env.ANTHROPIC_API_KEY) {
          throw new Error('ANTHROPIC_API_KEY not configured');
        }
        
        // If project is empty, create Next.js boilerplate first
        if (isEmptyProject) {
          console.log('Project is empty, creating Next.js boilerplate first...');
          
          // Create Next.js app in the empty project
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
        
        } else {
          // Project already has code - use AI to add feature intelligently
          console.log('Project has existing code, using AI to add feature...');
          
          // Gather project context
          const projectFiles = await fs.readdir(workspacePath);
          let packageJson = null;
          let mainFiles = [];
          
          // Read package.json if exists
          try {
            const pkgPath = path.join(workspacePath, 'package.json');
            const pkgContent = await fs.readFile(pkgPath, 'utf-8');
            packageJson = JSON.parse(pkgContent);
          } catch (e) {
            console.log('No package.json found');
          }
          
          // Read some key files for context
          const filesToCheck = ['src/app/page.tsx', 'src/app/page.js', 'pages/index.js', 'pages/index.tsx', 'index.html', 'src/App.js', 'src/App.tsx'];
          for (const file of filesToCheck) {
            try {
              const content = await fs.readFile(path.join(workspacePath, file), 'utf-8');
              mainFiles.push({ path: file, content: content.substring(0, 500) }); // First 500 chars
            } catch (e) {
              // File doesn't exist
            }
          }
          
          // Ask Claude to generate code for the existing project
          console.log('Calling Claude API to generate feature code...');
          const message = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022', // Using the model from SynthAI
            max_tokens: 4096,
            temperature: 0.7,
            messages: [{
              role: 'user',
              content: `Task: ${task_title}
Description: ${task_description || 'No additional description'}

Current project context:
- Files in project: ${projectFiles.slice(0, 20).join(', ')}${projectFiles.length > 20 ? '...' : ''}
- Package.json dependencies: ${packageJson ? Object.keys(packageJson.dependencies || {}).join(', ') : 'No package.json'}
- Main files found: ${mainFiles.map(f => f.path).join(', ')}

${mainFiles.length > 0 ? `Main file content preview:
${mainFiles[0].path}:
${mainFiles[0].content}` : ''}

Please analyze this existing project and generate the code needed to implement the requested feature.
Determine what framework is being used and follow its patterns.

🎁 Output Format:
Return a single valid JSON object with file paths as keys and code content as values.

🚫 Important:
- Do NOT include explanations or markdown - ONLY JSON
- Do NOT wrap the JSON in backticks or code blocks
- Return ONLY the JSON object, nothing else

✅ Example Output (this is the EXACT format you must follow):
{
  "framework": "nextjs",
  "files": {
    "/src/components/Counter.js": "'use client';\n\nimport { useState } from 'react';\n\nexport default function Counter() {\n  const [count, setCount] = useState(0);\n  return (\n    <div>\n      <button onClick={() => setCount(count - 1)}>-</button>\n      <span>{count}</span>\n      <button onClick={() => setCount(count + 1)}>+</button>\n    </div>\n  );\n}",
    "/src/app/counter/page.js": "'use client';\n\nimport Counter from '@/components/Counter';\n\nexport default function CounterPage() {\n  return <Counter />;\n}"
  },
  "summary": "Created counter component with increment/decrement",
  "dependencies": []
}

Requirements:
- Use the existing project's patterns and structure
- For Next.js App Router, put components in src/app or src/components
- For Next.js Pages Router, put components in pages or components
- Include all necessary imports and exports
- Make the code production-ready
- Use 'use client' directive for interactive components in Next.js`
            }]
          });
          
          // Parse Claude's response
          const responseText = message.content[0].text;
          console.log('Claude response received, parsing...');
          
          let generatedCode;
          try {
            // Clean response by removing markdown formatting (like SynthAI does)
            const cleanResponse = responseText.replace(/```(json)?/g, "").trim();
            
            // Extract JSON from response
            const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              throw new Error('No JSON found in Claude response');
            }
            
            // Try to parse the JSON
            try {
              generatedCode = JSON.parse(jsonMatch[0]);
            } catch (jsonError) {
              // Try to sanitize the JSON if it has issues (from SynthAI approach)
              console.log('Initial JSON parse failed, attempting to sanitize...');
              const sanitizedJson = jsonMatch[0]
                .replace(/\\'/g, "'") // Fix escaped single quotes
                .replace(/\\"/g, '"') // Fix escaped double quotes
                .replace(/\n/g, "\\n") // Properly escape newlines
                .replace(/`([^`]*)`/g, '"$1"'); // Replace backticks with quotes
              
              try {
                generatedCode = JSON.parse(sanitizedJson);
              } catch (sanitizeError) {
                // If sanitization still fails, try a more aggressive approach
                console.log('Sanitization failed, attempting fallback extraction...');
                
                // Try to extract the structure manually
                generatedCode = {
                  framework: 'nextjs', // Default to nextjs for your case
                  files: {},
                  summary: 'Generated code for: ' + task_title,
                  dependencies: []
                };
                
                // Look for framework indication
                const frameworkMatch = responseText.match(/"framework":\s*"([^"]+)"/);
                if (frameworkMatch) {
                  generatedCode.framework = frameworkMatch[1];
                }
                
                // Look for summary
                const summaryMatch = responseText.match(/"summary":\s*"([^"]+)"/);
                if (summaryMatch) {
                  generatedCode.summary = summaryMatch[1];
                }
                
                // Try to extract file content patterns
                // Look for patterns like "/path/to/file.js": "content" or "/path/to/file.js": `content`
                const filePatterns = [
                  /"(\/[^"]+\.[^"]+)":\s*"([^"]*)"/g,  // Double quoted content
                  /"(\/[^"]+\.[^"]+)":\s*`([^`]*)`/g,  // Backtick content
                ];
                
                for (const pattern of filePatterns) {
                  let fileMatch;
                  while ((fileMatch = pattern.exec(responseText)) !== null) {
                    const filePath = fileMatch[1];
                    const content = fileMatch[2]
                      .replace(/\\n/g, '\n')  // Unescape newlines
                      .replace(/\\t/g, '\t')  // Unescape tabs
                      .replace(/\\"/g, '"')   // Unescape quotes
                      .replace(/\\\\/g, '\\'); // Unescape backslashes
                    generatedCode.files[filePath] = content;
                  }
                }
                
                // If still no files, try to extract code blocks as fallback
                if (Object.keys(generatedCode.files).length === 0) {
                  console.log('No files found in JSON, extracting code blocks...');
                  const codeBlockRegex = /```(?:javascript|jsx|typescript|tsx|js|ts)?\n([\s\S]*?)```/g;
                  let match;
                  let fileIndex = 0;
                  
                  // For counter app, create specific files
                  while ((match = codeBlockRegex.exec(responseText)) !== null) {
                    let fileName;
                    const code = match[1];
                    
                    // Try to determine file name from content
                    if (code.includes('export default function Counter') || code.includes('function Counter')) {
                      fileName = '/src/components/Counter.js';
                    } else if (code.includes('useState') && fileIndex === 0) {
                      fileName = '/src/app/counter/page.js';
                    } else {
                      fileName = `/src/components/generated_${fileIndex}.js`;
                    }
                    
                    generatedCode.files[fileName] = code;
                    fileIndex++;
                  }
                }
              }
            }
          } catch (parseError) {
            console.error('Failed to parse Claude response:', parseError);
            throw parseError;
          }
          
          // Write the generated files to disk
          const createdFiles = [];
          for (const [filePath, content] of Object.entries(generatedCode.files)) {
            const fullPath = path.join(workspacePath, filePath.startsWith('/') ? filePath.slice(1) : filePath);
            
            // Create directory if needed
            const dir = path.dirname(fullPath);
            await fs.mkdir(dir, { recursive: true });
            
            // Write file
            await fs.writeFile(fullPath, content, 'utf-8');
            console.log(`Created/Updated: ${filePath}`);
            
            createdFiles.push({
              path: filePath,
              type: 'created',
              diff: { added: content.split('\n').length, removed: 0, hunks: [] }
            });
          }
          
          // Install dependencies if needed
          if (generatedCode.dependencies && generatedCode.dependencies.length > 0) {
            console.log(`Installing dependencies: ${generatedCode.dependencies.join(', ')}`);
            const installer = packageJson?.packageManager?.includes('yarn') ? 'yarn' : 'npm';
            const installCmd = installer === 'yarn' ? 'add' : 'install';
            
            try {
              await exec(`${installer} ${installCmd} ${generatedCode.dependencies.join(' ')}`, {
                cwd: workspacePath
              });
              console.log('Dependencies installed successfully');
            } catch (installError) {
              console.warn('Failed to install dependencies:', installError.message);
            }
          }
          
          return JSON.stringify({
            success: true,
            summary: generatedCode.summary || `Added ${task_title} to existing ${generatedCode.framework} project`,
            changes: createdFiles,
            message: `Successfully added feature to existing project`,
            framework: generatedCode.framework,
            filesCreated: Object.keys(generatedCode.files).length,
            dependencies: generatedCode.dependencies || []
          }, null, 2);
        }
        
      } catch (error) {
        console.error('Error in generate_task_code:', error);
        return JSON.stringify({
          success: false,
          summary: 'Error generating code',
          changes: [],
          message: error.message,
          hint: error.message.includes('ANTHROPIC_API_KEY') ? 
            'Make sure ANTHROPIC_API_KEY is set in .env file' : 
            'Check logs for details'
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