import fs from 'fs/promises';
import path from 'path';
import { spawn, exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { getBoilerplateFiles, detectFramework } from '../templates/boilerplate-templates.js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import BuildValidator from '../utils/build-validator.js';
import TailwindVersionDetector from '../utils/tailwind-version-detector.js';

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
          
          // Check if project uses Tailwind (has it in package.json)
          const hasTailwindPackage = packageJson?.dependencies?.tailwindcss || packageJson?.devDependencies?.tailwindcss;
          
          // Only check for configs if project actually uses Tailwind
          let hasTailwindConfig = false;
          let hasPostCSSConfig = false;
          
          if (hasTailwindPackage) {
            hasTailwindConfig = await fs.access(path.join(workspacePath, 'tailwind.config.js')).then(() => true).catch(() => false);
            hasPostCSSConfig = await fs.access(path.join(workspacePath, 'postcss.config.js')).then(() => true).catch(() => false);
            
            if (!hasTailwindConfig || !hasPostCSSConfig) {
              console.log('Project uses Tailwind but configuration files are missing, will add them...');
            }
          } else {
            console.log('Project does not use Tailwind, will use existing CSS framework');
          }
          
          // Use MCP tools to understand project structure and find relevant files
          console.log('Using MCP tools to analyze project and find relevant files...');
          
          // Import the MCP tools
          const { fileTools } = await import('./file-tools.js');
          const { codeTools } = await import('./code-tools.js');
          
          const listTool = fileTools.find(t => t.name === 'list_files');
          const readTool = fileTools.find(t => t.name === 'read_file');
          const searchTool = fileTools.find(t => t.name === 'search_files');
          const analyzeStructureTool = codeTools.find(t => t.name === 'analyze_code_structure');
          
          // First, check project structure to understand what we're working with
          let projectStructure = {};
          try {
            projectStructure = await analyzeStructureTool.handler({ path: workspacePath });
            console.log('Project structure:', projectStructure);
          } catch (e) {
            console.log('Could not determine project structure');
          }
          
          // List all project files to understand what exists
          let allFiles = [];
          try {
            const listResult = await listTool.handler({ path: workspacePath });
            allFiles = listResult.files || [];
            console.log(`Found ${allFiles.length} files in project`);
          } catch (e) {
            console.log('Could not list project files');
          }
          
          // Use search_files to find files related to the task
          let relevantFiles = [];
          try {
            // Search for the task title directly in the code
            const searchResult = await searchTool.handler({
              query: task_title,
              path: workspacePath,
              extension: '.js'
            });
            
            // Also search for .jsx, .ts, .tsx files
            for (const ext of ['.jsx', '.ts', '.tsx']) {
              try {
                const moreResults = await searchTool.handler({
                  query: task_title,
                  path: workspacePath,
                  extension: ext
                });
                if (moreResults && typeof moreResults === 'string' && moreResults.includes(':')) {
                  // Parse the file paths from the results
                  const lines = moreResults.split('\n');
                  for (const line of lines) {
                    if (line.includes(':') && !line.startsWith('  Line')) {
                      const filePath = line.split(':')[0];
                      if (!relevantFiles.includes(filePath)) {
                        relevantFiles.push(filePath);
                      }
                    }
                  }
                }
              } catch (e) {
                // Continue with other extensions
              }
            }
            
            console.log(`Found ${relevantFiles.length} files related to task`);
          } catch (e) {
            console.log('Initial search found no direct matches');
          }
          
          // If no files found, try a broader search based on existing components
          if (relevantFiles.length === 0) {
            // Look for component files that might need modification
            const componentFiles = allFiles.filter(f => 
              (f.includes('/components/') || f.includes('/app/')) && 
              (f.endsWith('.js') || f.endsWith('.jsx') || f.endsWith('.ts') || f.endsWith('.tsx'))
            );
            
            // Read and check each component file to see if it's relevant
            for (const file of componentFiles.slice(0, 10)) { // Check up to 10 component files
              try {
                const fullPath = path.join(workspacePath, file);
                const content = await readTool.handler({
                  path: fullPath
                });
                
                // Let Claude decide if this file is relevant by including it
                if (content && typeof content === 'string') {
                  relevantFiles.push(file);
                }
              } catch (e) {
                // Skip files that can't be read
              }
            }
          }
          
          console.log(`Total files to provide as context: ${relevantFiles.length}`);
          
          // Read the content of relevant files
          let affectedFilesContent = {};
          for (const filePath of relevantFiles) {
            try {
              const fullPath = filePath.startsWith('/') ? filePath : path.join(workspacePath, filePath);
              const readResult = await readTool.handler({
                path: fullPath
              });
              
              if (readResult && typeof readResult === 'string') {
                affectedFilesContent[filePath] = {
                  content: readResult,
                  exists: true,
                  lines: readResult.split('\n').length
                };
                console.log(`Read file: ${filePath} (${affectedFilesContent[filePath].lines} lines)`);
              }
            } catch (e) {
              console.log(`Failed to read ${filePath}:`, e.message);
            }
          }
          
          // Also read main files for general context (but just preview)
          const mainFilesToCheck = ['src/app/page.tsx', 'src/app/page.js', 'pages/index.js', 'pages/index.tsx'];
          for (const file of mainFilesToCheck) {
            // Skip if already in affected files
            if (affectedFilesContent[file]) continue;
            
            try {
              const content = await fs.readFile(path.join(workspacePath, file), 'utf-8');
              mainFiles.push({ path: file, content: content.substring(0, 300) }); // Just 300 chars for context
            } catch (e) {
              // File doesn't exist
            }
          }
          
          // Ask Claude to generate/modify code for the existing project
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
- CSS Framework: ${hasTailwindPackage ? 'Tailwind CSS' : packageJson?.dependencies?.bootstrap ? 'Bootstrap' : packageJson?.dependencies?.['@mui/material'] ? 'Material UI' : 'Default/Unknown'}

${Object.keys(affectedFilesContent).length > 0 ? `
🔴 IMPORTANT: The following files already exist and MUST be MODIFIED, not replaced:
${Object.entries(affectedFilesContent).map(([filePath, fileData]) => {
  if (fileData.exists && fileData.content) {
    return `
=====================================
File: ${filePath} (${fileData.lines} lines)
Current Content:
${fileData.content}
=====================================`;
  }
  return '';
}).join('\n')}

CRITICAL INSTRUCTIONS:
- For files listed above, you MUST MODIFY the existing code, not create new files
- Add the requested feature to the existing implementation
- Preserve ALL existing functionality
- Return the COMPLETE modified file content, not just the changes
- Do NOT create a new file if one already exists - modify the existing one
` : ''}

${mainFiles.length > 0 ? `Additional context from main files:
${mainFiles.map(f => `${f.path}: ${f.content}`).join('\n\n')}` : ''}

Please ${Object.keys(affectedFilesContent).length > 0 ? 'MODIFY the existing files to add' : 'generate the code for'} the requested feature.
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
- IMPORTANT: Use the CSS framework that's already in the project (Tailwind, Bootstrap, Material UI, etc.)
- If project uses Tailwind, use Tailwind classes. If Bootstrap, use Bootstrap classes. Match the existing style approach.
- For Next.js App Router, put components in src/app or src/components
- For Next.js Pages Router, put components in pages or components
- Include all necessary imports and exports
- Make the code production-ready
- Use 'use client' directive for interactive components in Next.js`
            }]
          });
          
          // Parse Claude's response using SynthAI's robust approach
          const responseText = message.content[0].text;
          console.log('Claude response received, parsing...');
          
          // Debug: Log raw response for troubleshooting
          if (responseText.length < 1000) {
            console.log('Raw response:', responseText);
          } else {
            console.log('Raw response length:', responseText.length);
          }
          
          let generatedCode;
          try {
            // Try direct parsing first (from SynthAI's task-based-generator.js)
            generatedCode = JSON.parse(responseText);
            console.log('Direct JSON parse successful');
          } catch (error) {
            console.log('Direct parse failed, trying cleanup methods...');
            
            // Try removing markdown formatting
            const cleaned = responseText.replace(/```(json)?/g, "").trim();
            
            // Find JSON object in the content
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              throw new Error("No valid JSON found in response");
            }
            
            try {
              generatedCode = JSON.parse(jsonMatch[0]);
              console.log('Cleaned JSON parse successful');
            } catch (parseError) {
              console.log('Cleaned parse failed, attempting advanced sanitization...');
              
              // Advanced sanitization from SynthAI
              try {
                // First attempt: Fix common JSON issues
                let sanitized = jsonMatch[0]
                  .replace(/\\\\/g, "\\\\\\\\")  // Fix backslashes
                  .replace(/\\n/g, "\\\\n")      // Fix newlines
                  .replace(/\\r/g, "\\\\r")      // Fix carriage returns
                  .replace(/\\t/g, "\\\\t");     // Fix tabs
                
                generatedCode = JSON.parse(sanitized);
                console.log('Advanced sanitization successful');
              } catch (sanitizeError) {
                console.log('Advanced sanitization failed, using manual extraction...');
                
                // Manual extraction as last resort
                generatedCode = {
                  framework: 'nextjs',
                  files: {},
                  summary: 'Generated code for: ' + task_title,
                  dependencies: []
                };
                
                // Extract framework
                const frameworkMatch = responseText.match(/"framework":\s*"([^"]+)"/);
                if (frameworkMatch) {
                  generatedCode.framework = frameworkMatch[1];
                }
                
                // Extract summary
                const summaryMatch = responseText.match(/"summary":\s*"([^"]+)"/);
                if (summaryMatch) {
                  generatedCode.summary = summaryMatch[1];
                }
                
                // Try to extract files with better patterns
                // Pattern 1: Standard JSON format with proper escaping
                const fileRegex = /"(\/[^"]+\.[^"]+)":\s*"((?:[^"\\]|\\.)*)"/g;
                let fileMatch;
                
                while ((fileMatch = fileRegex.exec(responseText)) !== null) {
                  const filePath = fileMatch[1];
                  let content = fileMatch[2];
                  
                  // Properly unescape the content
                  content = content
                    .replace(/\\n/g, '\n')
                    .replace(/\\t/g, '\t')
                    .replace(/\\r/g, '\r')
                    .replace(/\\"/g, '"')
                    .replace(/\\'/g, "'")
                    .replace(/\\\\/g, '\\');
                  
                  generatedCode.files[filePath] = content;
                  console.log(`Extracted file: ${filePath}`);
                }
                
                // If no files found, try code block extraction
                if (Object.keys(generatedCode.files).length === 0) {
                  console.log('No files in JSON, trying code block extraction...');
                  
                  // Look for code blocks in the response
                  const codeBlockRegex = /```(?:typescript|tsx|javascript|jsx|js|ts)\n([\s\S]*?)```/g;
                  let blockMatch;
                  let blockIndex = 0;
                  
                  while ((blockMatch = codeBlockRegex.exec(responseText)) !== null) {
                    const code = blockMatch[1];
                    let fileName;
                    
                    // Determine file name based on content
                    if (code.includes('export default function Counter') || 
                        code.includes('function Counter') || 
                        code.includes('const Counter')) {
                      // Check if it's TypeScript or JavaScript
                      const isTypeScript = code.includes(': React.FC') || 
                                         code.includes('interface') || 
                                         code.includes(': number') ||
                                         code.includes(': string');
                      fileName = isTypeScript ? '/src/components/Counter.tsx' : '/src/components/Counter.js';
                    } else if (code.includes('Counter') && code.includes('page')) {
                      fileName = '/src/app/counter/page.js';
                    } else {
                      fileName = `/src/components/Component${blockIndex}.js`;
                    }
                    
                    generatedCode.files[fileName] = code;
                    console.log(`Extracted code block as: ${fileName}`);
                    blockIndex++;
                  }
                }
              }
            }
          }
          
          // Validate and fix the generated code structure (from SynthAI)
          if (generatedCode.files && typeof generatedCode.files === 'object') {
            // Ensure all file contents are strings
            for (const [path, content] of Object.entries(generatedCode.files)) {
              if (typeof content !== 'string') {
                console.warn(`Converting non-string content for ${path}`);
                generatedCode.files[path] = JSON.stringify(content, null, 2);
              }
              
              // Validate content is not truncated
              if (content && content.endsWith('\\')) {
                console.error(`WARNING: File ${path} appears truncated!`);
                // Try to fix common truncation issues
                if (content.includes('className=\\')) {
                  console.log('Attempting to fix truncated className...');
                  // This is a critical error - the content is incomplete
                  throw new Error(`File content truncated at className. Response may be too long.`);
                }
              }
            }
          } else {
            console.log('No files object found, creating from extracted data...');
            if (!generatedCode.files) {
              generatedCode.files = {};
            }
          }
          
          console.log(`Parsed ${Object.keys(generatedCode.files || {}).length} files from Claude response`);
          
          // Write the generated files to disk
          const createdFiles = [];
          for (const [filePath, content] of Object.entries(generatedCode.files)) {
            const fullPath = path.join(workspacePath, filePath.startsWith('/') ? filePath.slice(1) : filePath);
            
            // Check if file already exists (to track if we're updating or creating)
            let fileExists = false;
            let oldLineCount = 0;
            try {
              const existingContent = await fs.readFile(fullPath, 'utf-8');
              fileExists = true;
              oldLineCount = existingContent.split('\n').length;
              
              // Check if the file was in our affected files list
              const normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
              if (affectedFilesContent[normalizedPath]?.exists) {
                console.log(`Updating existing file: ${filePath} (was ${oldLineCount} lines)`);
              }
            } catch (e) {
              // File doesn't exist, we'll create it
              console.log(`Creating new file: ${filePath}`);
            }
            
            // Create directory if needed
            const dir = path.dirname(fullPath);
            await fs.mkdir(dir, { recursive: true });
            
            // Write file
            await fs.writeFile(fullPath, content, 'utf-8');
            
            const newLineCount = content.split('\n').length;
            createdFiles.push({
              path: filePath,
              type: fileExists ? 'updated' : 'created',
              diff: { 
                added: fileExists ? Math.max(0, newLineCount - oldLineCount) : newLineCount, 
                removed: fileExists ? Math.max(0, oldLineCount - newLineCount) : 0, 
                hunks: [] 
              }
            });
            
            console.log(`${fileExists ? 'Updated' : 'Created'}: ${filePath} (${newLineCount} lines)`);
          }
          
          // Only setup Tailwind configuration if project already uses Tailwind
          if (hasTailwindPackage) {
            // Use TailwindVersionDetector to handle v3 vs v4 differences
            const tailwindDetector = new TailwindVersionDetector();
            
            // Detect version and create appropriate PostCSS config
            const tailwindInfo = await tailwindDetector.detectAndConfigurePostCSS(workspacePath);
            console.log(`Detected Tailwind v${tailwindInfo.version}`);
            
            if (tailwindInfo.configCreated) {
              createdFiles.push({
                path: '/postcss.config.js',
                type: 'created',
                diff: { added: 6, removed: 0, hunks: [] }
              });
            }
            
            // Install required packages based on Tailwind version
            const missingDeps = [];
            for (const pkg of tailwindInfo.requiredPackages) {
              const hasPkg = packageJson?.dependencies?.[pkg] || packageJson?.devDependencies?.[pkg];
              if (!hasPkg) {
                missingDeps.push(pkg);
                console.log(`${pkg} package missing, will install...`);
              }
            }
            
            // Install missing dependencies if needed
            if (missingDeps.length > 0) {
              console.log(`Installing missing Tailwind peer dependencies: ${missingDeps.join(', ')}`);
              const installer = packageJson?.packageManager?.includes('yarn') ? 'yarn' : 'npm';
              const installCmd = installer === 'yarn' ? 'add --dev' : 'install --save-dev';
              
              try {
                await exec(`${installer} ${installCmd} ${missingDeps.join(' ')}`, {
                  cwd: workspacePath
                });
                console.log('Tailwind peer dependencies installed successfully');
              } catch (installError) {
                console.warn('Failed to install Tailwind peer dependencies:', installError.message);
                console.warn('You may need to manually install:', missingDeps.join(', '));
              }
            }
            
            // Create tailwind.config.js if missing
            if (!hasTailwindConfig) {
              console.log('Creating tailwind.config.js...');
              const tailwindConfig = tailwindDetector.getTailwindConfig(tailwindInfo.version);
              await fs.writeFile(path.join(workspacePath, 'tailwind.config.js'), tailwindConfig, 'utf-8');
              createdFiles.push({
                path: '/tailwind.config.js',
                type: 'created',
                diff: { added: tailwindConfig.split('\n').length, removed: 0, hunks: [] }
              });
            }
            
            // Check if globals.css has Tailwind directives
            const globalsPath = path.join(workspacePath, 'src/app/globals.css');
            try {
              const globalsContent = await fs.readFile(globalsPath, 'utf-8');
              if (!globalsContent.includes('@tailwind base')) {
                console.log('Adding Tailwind directives to globals.css...');
                const tailwindDirectives = `@tailwind base;
@tailwind components;
@tailwind utilities;

`;
                await fs.writeFile(globalsPath, tailwindDirectives + globalsContent, 'utf-8');
                console.log('Added Tailwind directives to globals.css');
              }
            } catch (e) {
              console.log('Could not update globals.css:', e.message);
            }
          }
          
          // No automatic Tailwind installation - respect project's CSS choice
          // If they want Tailwind, they should have it in package.json already
          // Or explicitly add it as a dependency in the task
          
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
          
          // Smart build validation decision (from SynthAI's update-project-v2.js)
          const analyzeIfBuildNeeded = () => {
            // Analyze the generated files to determine if build validation is needed
            const analysis = {
              filesCount: 0,
              totalLinesChanged: 0,
              hasEventHandlers: false,
              hasStateManagement: false,
              hasStructuralChanges: false,
              isSimpleChange: true
            };
            
            // Count files and analyze content
            for (const [filePath, content] of Object.entries(generatedCode.files || {})) {
              analysis.filesCount++;
              analysis.totalLinesChanged += (content.split('\n').length || 0);
              
              // Check for complexity indicators
              // Event handlers
              if (/on(Click|Change|Submit|KeyDown|KeyUp|MouseOver|Focus|Blur)\s*[=:]/i.test(content)) {
                analysis.hasEventHandlers = true;
                analysis.isSimpleChange = false;
              }
              
              // State management
              if (/use(State|Reducer|Effect|Callback|Memo|Context)\s*\(/i.test(content)) {
                analysis.hasStateManagement = true;
                analysis.isSimpleChange = false;
              }
              
              // Structural changes (new components)
              if (/function\s+[A-Z]\w+\s*\(/.test(content) || /const\s+[A-Z]\w+\s*=\s*[\(\{]/.test(content)) {
                analysis.hasStructuralChanges = true;
                analysis.isSimpleChange = false;
              }
              
              // New imports/exports
              if (/^export\s+(default\s+)?/m.test(content) || /^import\s+/m.test(content)) {
                analysis.isSimpleChange = false;
              }
            }
            
            // Check task title for simple changes
            const taskLower = task_title.toLowerCase();
            if (taskLower.includes('style') || taskLower.includes('color') || 
                taskLower.includes('text') || taskLower.includes('content') ||
                taskLower.includes('typo') || taskLower.includes('spacing')) {
              analysis.isSimpleChange = true;
            }
            
            // Determine if build is needed
            const needsBuild = 
              analysis.hasStructuralChanges ||
              analysis.hasEventHandlers ||
              analysis.hasStateManagement ||
              analysis.filesCount > 2 ||
              analysis.totalLinesChanged > 100;
            
            // Calculate confidence
            let confidence = 0.9;
            if (analysis.isSimpleChange) {
              confidence = 0.95;
            } else if (analysis.filesCount === 1 && analysis.totalLinesChanged < 20) {
              confidence = 0.95;
            } else if (analysis.filesCount > 3 || analysis.totalLinesChanged > 200) {
              confidence = 0.95;
            } else {
              confidence = 0.7;
            }
            
            console.log('Build decision analysis:', {
              filesCount: analysis.filesCount,
              linesChanged: analysis.totalLinesChanged,
              hasComplexity: analysis.hasEventHandlers || analysis.hasStateManagement || analysis.hasStructuralChanges,
              needsBuild,
              confidence,
              decision: !needsBuild && confidence >= 0.7 ? 'SKIP_BUILD' : 'RUN_BUILD'
            });
            
            return { needsBuild, confidence, analysis };
          };
          
          // Run build validation and auto-fix if needed (smart decision from SynthAI)
          const enableBuildValidation = process.env.ENABLE_BUILD_VALIDATION === 'true';
          let buildValidationResult = null;
          
          if (enableBuildValidation && process.env.ANTHROPIC_API_KEY) {
            const buildDecision = analyzeIfBuildNeeded();
            
            // Skip build for simple changes with high confidence
            if (!buildDecision.needsBuild && buildDecision.confidence >= 0.7) {
              console.log('Build validation skipped - detected simple change with high confidence');
              buildValidationResult = {
                success: true,
                skipped: true,
                reason: 'Simple change detected',
                confidence: buildDecision.confidence
              };
            } else {
              console.log('Running build validation and auto-fix...');
              const buildValidator = new BuildValidator();
              
              try {
                buildValidationResult = await buildValidator.validateAndFix(
                  workspacePath,
                  task_title + (task_description ? ': ' + task_description : ''),
                  process.env.ANTHROPIC_API_KEY
                );
                
                if (buildValidationResult.success) {
                  console.log('Build validation passed!');
                } else {
                  console.warn('Build validation failed after', buildValidationResult.attempts, 'attempts');
                }
              } catch (validationError) {
                console.error('Build validation error:', validationError.message);
              }
            }
          } else {
            console.log('Build validation disabled or no API key');
          }
          
          return JSON.stringify({
            success: true,
            summary: generatedCode.summary || `Added ${task_title} to existing ${generatedCode.framework} project`,
            changes: createdFiles,
            message: `Successfully added feature to existing project`,
            framework: generatedCode.framework,
            filesCreated: Object.keys(generatedCode.files).length,
            dependencies: generatedCode.dependencies || [],
            buildValidation: buildValidationResult
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