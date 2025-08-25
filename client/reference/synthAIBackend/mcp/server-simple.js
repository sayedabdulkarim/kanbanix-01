#!/usr/bin/env node

/**
 * Simplified MCP Server for No-Code Framework
 * Provides tools for Claude to interact with project files
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Create server
const server = new Server(
  {
    name: 'no-code-framework-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper to get project base path
function getProjectPath(projectName) {
  return path.join(__dirname, '../../client/user-projects', projectName);
}

// Tool definitions
const tools = [
  {
    name: 'read_project_file',
    description: 'Read a file from a user project',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Name of the project (e.g., project-663d9257)',
        },
        filePath: {
          type: 'string',
          description: 'Path to the file within the project (e.g., src/app/page.tsx)',
        },
      },
      required: ['projectName', 'filePath'],
    },
  },
  {
    name: 'list_project_files',
    description: 'List all files in a project directory',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Name of the project',
        },
        directory: {
          type: 'string',
          description: 'Directory within the project (optional, defaults to root)',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'check_project_structure',
    description: 'Analyze project structure and configuration',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Name of the project',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'search_code',
    description: 'Search for code patterns in the project',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Name of the project',
        },
        pattern: {
          type: 'string',
          description: 'Search pattern or text to find',
        },
        fileType: {
          type: 'string',
          description: 'File extension to filter (optional, e.g., "tsx", "js")',
        },
      },
      required: ['projectName', 'pattern'],
    },
  },
];

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'read_project_file': {
        const projectPath = getProjectPath(args.projectName);
        const filePath = path.join(projectPath, args.filePath);
        
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          return {
            content: [
              {
                type: 'text',
                text: content,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error reading file: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      }

      case 'list_project_files': {
        const projectPath = getProjectPath(args.projectName);
        const targetDir = args.directory 
          ? path.join(projectPath, args.directory)
          : projectPath;
        
        try {
          const files = await listFiles(targetDir, projectPath);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(files, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error listing files: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      }

      case 'check_project_structure': {
        const projectPath = getProjectPath(args.projectName);
        const structure = await analyzeProjectStructure(projectPath);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(structure, null, 2),
            },
          ],
        };
      }

      case 'search_code': {
        const projectPath = getProjectPath(args.projectName);
        const { pattern, fileType } = args;
        
        try {
          const results = await searchInProject(projectPath, pattern, fileType);
          return {
            content: [
              {
                type: 'text',
                text: results,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error searching: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing tool: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Helper function to list files
async function listFiles(dir, baseDir) {
  const files = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      
      if (entry.isDirectory()) {
        files.push({ type: 'directory', path: relativePath });
        // Don't recurse too deep
        if (relativePath.split(path.sep).length < 3) {
          const subFiles = await listFiles(fullPath, baseDir);
          files.push(...subFiles);
        }
      } else {
        files.push({ type: 'file', path: relativePath });
      }
    }
  } catch (error) {
    console.error('Error listing files:', error);
  }
  
  return files;
}

// Helper to analyze project structure
async function analyzeProjectStructure(projectPath) {
  const structure = {
    hasPackageJson: false,
    hasTsConfig: false,
    hasTailwind: false,
    hasNextConfig: false,
    framework: 'unknown',
    directories: [],
    components: [],
  };
  
  try {
    const files = await fs.readdir(projectPath);
    structure.hasPackageJson = files.includes('package.json');
    structure.hasTsConfig = files.includes('tsconfig.json');
    structure.hasTailwind = files.includes('tailwind.config.js') || files.includes('tailwind.config.ts');
    structure.hasNextConfig = files.includes('next.config.js') || files.includes('next.config.mjs');
    
    if (structure.hasNextConfig) {
      structure.framework = 'nextjs';
    }
    
    // Check for src directory
    if (files.includes('src')) {
      const srcContents = await fs.readdir(path.join(projectPath, 'src'));
      structure.directories = srcContents.filter(item => {
        return ['app', 'components', 'pages', 'styles', 'hooks', 'context', 'types'].includes(item);
      });
      
      // Find components
      if (structure.directories.includes('components')) {
        try {
          const componentsPath = path.join(projectPath, 'src', 'components');
          const components = await fs.readdir(componentsPath);
          structure.components = components.filter(c => c.endsWith('.tsx') || c.endsWith('.jsx'));
        } catch (e) {
          // Components directory might not exist yet
        }
      }
    }
  } catch (error) {
    console.error('Error analyzing structure:', error);
  }
  
  return structure;
}

// Helper to search for code patterns
async function searchInProject(projectPath, pattern, fileType) {
  const results = [];
  const fileExtensions = fileType ? [`.${fileType}`] : ['.ts', '.tsx', '.js', '.jsx', '.css'];
  
  async function searchInDirectory(dir, depth = 0) {
    if (depth > 5) return; // Limit depth
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        // Skip node_modules and hidden files
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await searchInDirectory(fullPath, depth + 1);
        } else if (entry.isFile() && fileExtensions.some(ext => entry.name.endsWith(ext))) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            
            lines.forEach((line, index) => {
              if (line.includes(pattern)) {
                const relativePath = path.relative(projectPath, fullPath);
                results.push({
                  file: relativePath,
                  line: index + 1,
                  content: line.trim()
                });
              }
            });
          } catch (e) {
            // Skip files that can't be read
          }
        }
      }
    } catch (error) {
      console.error(`Error searching in ${dir}:`, error);
    }
  }
  
  await searchInDirectory(projectPath);
  
  if (results.length === 0) {
    return `No matches found for pattern: "${pattern}"`;
  }
  
  // Format results
  let output = `Found ${results.length} matches for "${pattern}":\n\n`;
  for (const result of results.slice(0, 20)) { // Limit to 20 results
    output += `${result.file}:${result.line}\n${result.content}\n\n`;
  }
  
  if (results.length > 20) {
    output += `... and ${results.length - 20} more matches`;
  }
  
  return output;
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server started successfully');
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});