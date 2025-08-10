import fs from 'fs/promises';
import path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');

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
];