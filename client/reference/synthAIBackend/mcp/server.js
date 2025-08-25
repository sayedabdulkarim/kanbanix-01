#!/usr/bin/env node

/**
 * MCP Server for No-Code Framework
 * Provides tools for Claude to interact with project files and build systems
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Server configuration
const server = new Server(
  {
    name: 'no-code-framework',
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

// Tool: Read project file
const readProjectFileTool = {
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
};

// Tool: List project files
const listProjectFilesTool = {
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
};

// Tool: Search code
const searchCodeTool = {
  name: 'search_code',
  description: 'Search for a pattern across project files',
  inputSchema: {
    type: 'object',
    properties: {
      projectName: {
        type: 'string',
        description: 'Name of the project',
      },
      pattern: {
        type: 'string',
        description: 'Search pattern (regex supported)',
      },
      fileType: {
        type: 'string',
        description: 'File extension to search in (e.g., tsx, ts, css)',
      },
    },
    required: ['projectName', 'pattern'],
  },
};

// Tool: Check project structure
const checkProjectStructureTool = {
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
};

// Tool: Run build command
const runBuildTool = {
  name: 'run_build',
  description: 'Run build command for a project and return results',
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
};

// Tool: Read error log
const readErrorLogTool = {
  name: 'read_error_log',
  description: 'Read the latest build or runtime errors',
  inputSchema: {
    type: 'object',
    properties: {
      projectName: {
        type: 'string',
        description: 'Name of the project',
      },
      errorType: {
        type: 'string',
        enum: ['build', 'runtime', 'typescript'],
        description: 'Type of error to read',
      },
    },
    required: ['projectName'],
  },
};

// Register tools
server.setRequestHandler('tools/list', async () => ({
  tools: [
    readProjectFileTool,
    listProjectFilesTool,
    searchCodeTool,
    checkProjectStructureTool,
    runBuildTool,
    readErrorLogTool,
  ],
}));

// Handle tool calls
server.setRequestHandler('tools/call', async (request) => {
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
          };
        }
      }

      case 'search_code': {
        const projectPath = getProjectPath(args.projectName);
        const results = await searchInProject(projectPath, args.pattern, args.fileType);
        
        return {
          content: [
            {
              type: 'text',
              text: formatSearchResults(results),
            },
          ],
        };
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

      case 'run_build': {
        const projectPath = getProjectPath(args.projectName);
        
        try {
          const { stdout, stderr } = await execAsync('npm run build', {
            cwd: projectPath,
            maxBuffer: 1024 * 1024 * 10, // 10MB
          });
          
          return {
            content: [
              {
                type: 'text',
                text: `Build Output:\n${stdout}\n\nErrors:\n${stderr}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Build failed:\n${error.stdout}\n\nError:\n${error.stderr}`,
              },
            ],
          };
        }
      }

      case 'read_error_log': {
        // This would integrate with your error tracking system
        // For now, we'll check for common error locations
        const projectPath = getProjectPath(args.projectName);
        const errors = await findRecentErrors(projectPath, args.errorType);
        
        return {
          content: [
            {
              type: 'text',
              text: errors || 'No recent errors found',
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error executing tool: ${error.message}`,
        },
      ],
    };
  }
});

// Helper functions
async function listFiles(dir, baseDir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);
    
    if (entry.isDirectory()) {
      files.push({ type: 'directory', path: relativePath });
      const subFiles = await listFiles(fullPath, baseDir);
      files.push(...subFiles);
    } else {
      files.push({ type: 'file', path: relativePath });
    }
  }
  
  return files;
}

async function searchInProject(projectPath, pattern, fileType) {
  const results = [];
  const regex = new RegExp(pattern, 'gi');
  
  async function searchDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        await searchDir(fullPath);
      } else if (!fileType || entry.name.endsWith(`.${fileType}`)) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          
          lines.forEach((line, index) => {
            if (regex.test(line)) {
              results.push({
                file: path.relative(projectPath, fullPath),
                line: index + 1,
                content: line.trim(),
              });
            }
          });
        } catch (error) {
          // Skip files that can't be read
        }
      }
    }
  }
  
  await searchDir(projectPath);
  return results;
}

function formatSearchResults(results) {
  if (results.length === 0) return 'No matches found';
  
  return results
    .map(r => `${r.file}:${r.line} - ${r.content}`)
    .join('\n');
}

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
    // Check for key files
    const files = await fs.readdir(projectPath);
    structure.hasPackageJson = files.includes('package.json');
    structure.hasTsConfig = files.includes('tsconfig.json');
    structure.hasTailwind = files.includes('tailwind.config.js');
    structure.hasNextConfig = files.includes('next.config.js');
    
    // Detect framework
    if (structure.hasNextConfig) {
      structure.framework = 'nextjs';
    }
    
    // Check for common directories
    const srcPath = path.join(projectPath, 'src');
    if (files.includes('src')) {
      const srcContents = await fs.readdir(srcPath);
      structure.directories = srcContents.filter(item => {
        return ['app', 'components', 'pages', 'styles', 'hooks', 'context', 'types'].includes(item);
      });
      
      // Find components
      const componentsPath = path.join(srcPath, 'components');
      if (structure.directories.includes('components')) {
        const components = await fs.readdir(componentsPath);
        structure.components = components.filter(c => c.endsWith('.tsx') || c.endsWith('.jsx'));
      }
    }
    
  } catch (error) {
    console.error('Error analyzing structure:', error);
  }
  
  return structure;
}

async function findRecentErrors(projectPath, errorType) {
  // This is a simplified version - in production, you'd integrate
  // with your error tracking system
  const nextBuildDir = path.join(projectPath, '.next');
  
  try {
    // Check for build errors in .next directory
    if (errorType === 'build') {
      const buildManifest = path.join(nextBuildDir, 'build-manifest.json');
      // Read actual build errors if available
    }
    
    // For now, return a placeholder
    return `No ${errorType} errors found in recent builds`;
  } catch (error) {
    return `Unable to read error logs: ${error.message}`;
  }
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server started successfully');
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});