import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load project context from database
async function loadProjectContext(projectId) {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({
      datasourceUrl: `file:${path.join(__dirname, '../../../client/prisma/prisma/dev.db')}`
    });
    
    const context = await prisma.projectContext.findUnique({
      where: { projectId }
    });
    
    await prisma.$disconnect();
    return context;
  } catch (error) {
    console.log('Could not load project context:', error.message);
    return null;
  }
}

// Build enhanced prompt with context
function buildContextAwarePrompt(task, projectContext, existingFiles) {
  let contextSection = '';
  
  if (projectContext) {
    // Parse context data
    const taskHistory = projectContext.taskHistory ? JSON.parse(projectContext.taskHistory) : [];
    const dependencies = projectContext.dependencies ? JSON.parse(projectContext.dependencies) : {};
    const backendFiles = projectContext.backendFiles ? JSON.parse(projectContext.backendFiles) : [];
    
    contextSection = `
## Project Context (From Previous Tasks):
- **Project Type**: ${projectContext.projectType || 'Unknown'}
- **Backend Type**: ${projectContext.backendType || 'None detected'}
- **Database/ORM**: ${projectContext.ormType || 'None detected'}
- **Last Updated**: ${projectContext.updatedAt}

## Previous Tasks Completed:
${taskHistory.slice(-5).map(t => `- ${t.title} (${t.filesCreated?.length || 0} files created, ${t.filesModified?.length || 0} files modified)`).join('\n')}

## Key Dependencies:
${Object.entries(dependencies).slice(0, 10).map(([name, version]) => `- ${name}: ${version}`).join('\n')}

## Backend Infrastructure:
${projectContext.backendType ? `
- Backend Type: ${projectContext.backendType}
- Backend Files: ${backendFiles.slice(0, 5).join(', ')}
- API Pattern: ${projectContext.backendType === 'nextjs-api' ? 'App Router API routes in app/api/' : 
                  projectContext.backendType === 'express' ? 'Express routes in routes/' : 
                  'Custom backend structure'}
` : '- No backend detected yet'}

## CRITICAL INSTRUCTIONS BASED ON CONTEXT:
${projectContext.projectType === 'nextjs' ? `
- This is a Next.js project - use App Router patterns
- Put API routes in app/api/ directory
- Use 'use client' for interactive components
- Follow existing file structure patterns
` : ''}
${projectContext.backendType ? `
- IMPORTANT: Backend already exists (${projectContext.backendType})
- DO NOT create a new backend - use the existing one
- Add new endpoints to the existing backend structure
- Follow the existing API patterns
` : ''}
${projectContext.ormType ? `
- Database ORM already set up: ${projectContext.ormType}
- Use existing database models and patterns
- Add new models to existing schema file
` : ''}
`;
  }
  
  return contextSection;
}

export const contextEnhancedGenerator = [
  {
    name: 'generate_code_with_context',
    description: 'Generate code with full project context awareness',
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
        project_id: {
          type: 'string',
          description: 'Project ID for context lookup',
        },
        workspace_path: {
          type: 'string',
          description: 'Path to the workspace',
        },
      },
      required: ['task_title', 'workspace_path'],
    },
    handler: async ({ task_title, task_description, project_id, workspace_path }) => {
      console.log(`[Context-Enhanced] Generating code for: "${task_title}"`);
      
      // Load project context
      const projectContext = project_id ? await loadProjectContext(project_id) : null;
      
      if (projectContext) {
        console.log(`[Context-Enhanced] Loaded context for ${projectContext.projectType} project`);
      } else {
        console.log('[Context-Enhanced] No context available, proceeding without history');
      }
      
      // Initialize Anthropic client
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      });
      
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not configured');
      }
      
      // Scan existing files
      const projectFiles = await scanProjectFiles(workspace_path);
      console.log(`Found ${projectFiles.length} existing files`);
      
      // Load package.json if exists
      let packageJson = null;
      try {
        const packagePath = path.join(workspace_path, 'package.json');
        packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
      } catch (e) {
        // No package.json
      }
      
      // Build context-aware prompt
      const contextSection = buildContextAwarePrompt(
        { title: task_title, description: task_description },
        projectContext,
        projectFiles
      );
      
      // Detect what files might be affected
      const affectedFiles = await detectAffectedFiles(task_title, projectFiles, projectContext);
      console.log(`Detected ${affectedFiles.length} potentially affected files`);
      
      // Load content of affected files
      const affectedFilesContent = {};
      for (const file of affectedFiles.slice(0, 5)) {
        try {
          const content = await fs.readFile(path.join(workspace_path, file), 'utf-8');
          affectedFilesContent[file] = {
            exists: true,
            content: content.slice(0, 2000), // Limit content for context
            lines: content.split('\n').length
          };
        } catch (e) {
          // File doesn't exist yet
        }
      }
      
      // Create the enhanced prompt
      const prompt = `Task: ${task_title}
Description: ${task_description || 'No additional description'}

${contextSection}

## Current Project State:
- Total files: ${projectFiles.length}
- Main directories: ${[...new Set(projectFiles.map(f => f.split('/')[0]))].slice(0, 10).join(', ')}
- Package.json dependencies: ${packageJson ? Object.keys(packageJson.dependencies || {}).slice(0, 15).join(', ') : 'No package.json'}

${Object.keys(affectedFilesContent).length > 0 ? `
## Existing Files to Modify:
${Object.entries(affectedFilesContent).map(([filePath, fileData]) => `
File: ${filePath} (${fileData.lines} lines)
Preview: ${fileData.content.slice(0, 500)}...
`).join('\n')}

IMPORTANT: These files exist - MODIFY them, don't create duplicates
` : ''}

## Code Generation Requirements:
1. ${projectContext?.backendType ? 'USE EXISTING BACKEND - Do not create new backend infrastructure' : 'Create backend if needed for this task'}
2. ${projectContext?.projectType ? `Follow ${projectContext.projectType} patterns and conventions` : 'Detect and follow project patterns'}
3. ${projectContext?.ormType ? `Use existing ${projectContext.ormType} for database operations` : 'Set up database if needed'}
4. Preserve ALL existing functionality
5. Build incrementally on previous work

Output Format:
Return a valid JSON object with:
{
  "framework": "detected framework",
  "files": {
    "path/to/file": "file content with proper escaping"
  },
  "summary": "what was done",
  "dependencies": ["new dependencies if any"],
  "context_used": {
    "existing_backend": true/false,
    "modified_existing": true/false,
    "followed_patterns": true/false
  }
}

Return ONLY valid JSON, no markdown or explanations.`;

      console.log('[Context-Enhanced] Calling Claude API with enhanced context...');
      
      // Retry logic for handling overload
      let message;
      let retries = 3;
      let delay = 2000; // Start with 2 second delay
      
      while (retries > 0) {
        try {
          message = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-latest',  // This should map to Sonnet 4
            max_tokens: 4096,
            temperature: 0.7,
            messages: [{
              role: 'user',
              content: prompt
            }]
          });
          break; // Success, exit loop
        } catch (error) {
          if (error.status === 529 && retries > 1) {
            console.log(`[Context-Enhanced] API overloaded, retrying in ${delay}ms... (${retries - 1} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff (2s, 4s, 8s)
            retries--;
          } else {
            throw error; // Re-throw if not overload or no retries left
          }
        }
      }
      
      if (!message) {
        throw new Error('Failed to get response from Claude after retries');
      }
      
      // Parse response
      const responseText = message.content[0].text;
      let generatedCode;
      
      try {
        generatedCode = JSON.parse(responseText);
        console.log('[Context-Enhanced] Successfully parsed Claude response');
      } catch (error) {
        console.log('[Context-Enhanced] Failed to parse response, attempting cleanup...');
        // Try to extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            generatedCode = JSON.parse(jsonMatch[0]);
          } catch (e) {
            throw new Error('Could not parse Claude response as JSON');
          }
        } else {
          throw new Error('No JSON found in Claude response');
        }
      }
      
      // Write files to disk
      const changes = [];
      if (generatedCode.files && workspace_path) {
        console.log(`[Context-Enhanced] Writing ${Object.keys(generatedCode.files).length} files to disk...`);
        
        for (const [filePath, content] of Object.entries(generatedCode.files)) {
          const fullPath = path.join(workspace_path, filePath);
          const dir = path.dirname(fullPath);
          
          // Create directory if it doesn't exist
          await fs.mkdir(dir, { recursive: true });
          
          // Check if file exists
          const exists = await fs.access(fullPath).then(() => true).catch(() => false);
          
          // Write the file
          await fs.writeFile(fullPath, content, 'utf-8');
          console.log(`[Context-Enhanced] Wrote file: ${filePath}`);
          
          changes.push({
            path: filePath,
            type: exists ? 'modified' : 'created'
          });
        }
      }
      
      // Install dependencies if needed
      if (generatedCode.dependencies && generatedCode.dependencies.length > 0 && workspace_path) {
        console.log(`[Context-Enhanced] Installing dependencies: ${generatedCode.dependencies.join(', ')}`);
        const { execSync } = await import('child_process');
        
        try {
          // Check if yarn.lock exists
          const useYarn = await fs.access(path.join(workspace_path, 'yarn.lock')).then(() => true).catch(() => false);
          const cmd = useYarn ? 'yarn add' : 'npm install';
          
          execSync(`${cmd} ${generatedCode.dependencies.join(' ')}`, {
            cwd: workspace_path,
            stdio: 'inherit'
          });
          
          console.log('[Context-Enhanced] Dependencies installed successfully');
        } catch (error) {
          console.error('[Context-Enhanced] Failed to install dependencies:', error.message);
        }
      }
      
      // Update project context with this task
      if (project_id && generatedCode) {
        await updateProjectContextAfterTask(project_id, {
          taskId: `task_${Date.now()}`,
          title: task_title,
          filesCreated: Object.keys(generatedCode.files || {}).filter(f => !affectedFiles.includes(f)),
          filesModified: Object.keys(generatedCode.files || {}).filter(f => affectedFiles.includes(f)),
          summary: generatedCode.summary
        });
      }
      
      return {
        success: true,
        ...generatedCode,
        changes: changes,
        context_aware: true,
        context_used: {
          project_type: projectContext?.projectType,
          backend_type: projectContext?.backendType,
          task_history_available: !!projectContext?.taskHistory
        }
      };
    }
  }
];

// Helper functions
async function scanProjectFiles(workspacePath) {
  const files = [];
  
  async function scan(dir, base) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) {
          continue;
        }
        
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(base, fullPath);
        
        if (entry.isDirectory()) {
          await scan(fullPath, base);
        } else {
          files.push(relativePath);
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }
  
  await scan(workspacePath, workspacePath);
  return files;
}

async function detectAffectedFiles(taskTitle, projectFiles, context) {
  const affected = [];
  const taskLower = taskTitle.toLowerCase();
  
  // Use context to better detect affected files
  if (context?.backendType && (taskLower.includes('todo') || taskLower.includes('api'))) {
    // For backend tasks, prioritize backend files
    const backendFiles = context.backendFiles ? JSON.parse(context.backendFiles) : [];
    affected.push(...backendFiles);
  }
  
  // Pattern matching for common file types
  for (const file of projectFiles) {
    const fileLower = file.toLowerCase();
    
    if (taskLower.includes('todo') && fileLower.includes('todo')) {
      affected.push(file);
    } else if (taskLower.includes('counter') && fileLower.includes('counter')) {
      affected.push(file);
    } else if (taskLower.includes('auth') && (fileLower.includes('auth') || fileLower.includes('login'))) {
      affected.push(file);
    }
  }
  
  return [...new Set(affected)];
}

async function updateProjectContextAfterTask(projectId, taskResult) {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const dbPath = path.join(__dirname, '../../../client/prisma/dev.db');
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: `file:${dbPath}`
        }
      }
    });
    
    // Get existing context
    const existing = await prisma.projectContext.findUnique({
      where: { projectId }
    });
    
    // Update task history
    const taskHistory = existing?.taskHistory ? JSON.parse(existing.taskHistory) : [];
    taskHistory.push({
      ...taskResult,
      timestamp: new Date()
    });
    
    // Keep only last 20 tasks
    if (taskHistory.length > 20) {
      taskHistory.shift();
    }
    
    await prisma.projectContext.update({
      where: { projectId },
      data: {
        taskHistory: JSON.stringify(taskHistory),
        updatedAt: new Date()
      }
    });
    
    await prisma.$disconnect();
    console.log('[Context-Enhanced] Updated project context with task results');
  } catch (error) {
    console.error('Error updating context:', error);
  }
}