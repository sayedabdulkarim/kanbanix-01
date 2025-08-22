import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

// Get project root - use the workspace path from environment or fallback
const PROJECT_ROOT = process.env.WORKSPACE_PATH || path.resolve(process.cwd(), '..');

// Security: Only allow access within project
function validatePath(filePath) {
  const resolvedPath = path.resolve(PROJECT_ROOT, filePath);
  if (!resolvedPath.startsWith(PROJECT_ROOT)) {
    throw new Error('Access denied: Path outside project directory');
  }
  return resolvedPath;
}

export const fileTools = [
  {
    name: 'read_file',
    description: 'Read contents of a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file relative to project root',
        },
      },
      required: ['path'],
    },
    handler: async ({ path: filePath }) => {
      try {
        const fullPath = validatePath(filePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        return content;
      } catch (error) {
        if (error.code === 'ENOENT') {
          return `File not found: ${filePath}`;
        }
        throw error;
      }
    },
  },

  {
    name: 'write_file',
    description: 'Write content to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file relative to project root',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
    handler: async ({ path: filePath, content }) => {
      const fullPath = validatePath(filePath);
      
      // Create directory if it doesn't exist
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(fullPath, content, 'utf-8');
      return `File written successfully: ${filePath}`;
    },
  },

  {
    name: 'list_files',
    description: 'List files in a directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to project root',
          default: '.',
        },
        pattern: {
          type: 'string',
          description: 'Glob pattern to filter files (optional)',
          default: '*',
        },
      },
    },
    handler: async ({ path: dirPath = '.', pattern = '*' }) => {
      const fullPath = validatePath(dirPath);
      const searchPattern = path.join(fullPath, pattern);
      
      const files = await glob(searchPattern, {
        nodir: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      });
      
      // Return relative paths
      const relativePaths = files.map(f => path.relative(PROJECT_ROOT, f));
      return relativePaths.join('\n');
    },
  },

  {
    name: 'search_files',
    description: 'Search for files containing specific text',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text to search for',
        },
        path: {
          type: 'string',
          description: 'Directory to search in',
          default: '.',
        },
        extension: {
          type: 'string',
          description: 'File extension to filter (e.g., .js, .tsx)',
        },
      },
      required: ['query'],
    },
    handler: async ({ query, path: searchPath = '.', extension }) => {
      const fullPath = validatePath(searchPath);
      const pattern = extension ? `**/*${extension}` : '**/*';
      const searchPattern = path.join(fullPath, pattern);
      
      const files = await glob(searchPattern, {
        nodir: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      });
      
      const results = [];
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes(query)) {
            const relativePath = path.relative(PROJECT_ROOT, file);
            
            // Find line numbers containing the query
            const lines = content.split('\n');
            const matches = [];
            lines.forEach((line, index) => {
              if (line.includes(query)) {
                matches.push(`  Line ${index + 1}: ${line.trim()}`);
              }
            });
            
            if (matches.length > 0) {
              results.push(`${relativePath}:\n${matches.slice(0, 3).join('\n')}`);
            }
          }
        } catch (error) {
          // Skip files that can't be read
        }
      }
      
      return results.length > 0 
        ? results.join('\n\n')
        : `No files found containing "${query}"`;
    },
  },

  {
    name: 'file_exists',
    description: 'Check if a file exists',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to check',
        },
      },
      required: ['path'],
    },
    handler: async ({ path: filePath }) => {
      try {
        const fullPath = validatePath(filePath);
        await fs.access(fullPath);
        return `true`;
      } catch {
        return `false`;
      }
    },
  },

  {
    name: 'create_directory',
    description: 'Create a directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to create',
        },
      },
      required: ['path'],
    },
    handler: async ({ path: dirPath }) => {
      const fullPath = validatePath(dirPath);
      await fs.mkdir(fullPath, { recursive: true });
      return `Directory created: ${dirPath}`;
    },
  },
];