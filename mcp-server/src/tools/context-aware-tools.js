import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the ContextManager from client
// Note: In production, this would be a separate service or API call
async function getProjectContext(projectId) {
  try {
    // For now, read directly from SQLite database
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

export const contextAwareTools = [
  {
    name: 'detect_files_with_context',
    description: 'Intelligently detect files using project context and history',
    inputSchema: {
      type: 'object',
      properties: {
        task_title: {
          type: 'string',
          description: 'The task title/description',
        },
        workspace_path: {
          type: 'string',
          description: 'Path to the workspace/project',
        },
        project_id: {
          type: 'string',
          description: 'Project ID for context lookup',
        },
      },
      required: ['task_title', 'workspace_path'],
    },
    handler: async ({ task_title, workspace_path, project_id }) => {
      console.log(`[Context-Aware] Detecting files for: "${task_title}"`);
      
      // Load project context if project_id provided
      let context = null;
      if (project_id) {
        context = await getProjectContext(project_id);
        if (context) {
          console.log(`[Context-Aware] Loaded context for project type: ${context.projectType}`);
        }
      }
      
      const result = {
        affectedFiles: [],
        suggestedFiles: [],
        backendInfo: null,
        projectInfo: null,
      };
      
      // Parse context data
      if (context) {
        result.projectInfo = {
          type: context.projectType,
          hasBackend: !!context.backendType,
          backendType: context.backendType,
          ormType: context.ormType,
          fileCount: context.fileTree ? JSON.parse(context.fileTree).length : 0,
        };
        
        // Use backend info for TODO tasks
        if (task_title.toLowerCase().includes('todo') && context.backendType) {
          result.backendInfo = {
            type: context.backendType,
            files: context.backendFiles ? JSON.parse(context.backendFiles) : [],
            orm: context.ormType,
          };
        }
        
        // Get recent task patterns
        if (context.taskHistory) {
          const history = JSON.parse(context.taskHistory);
          const recentFiles = new Set();
          
          // Collect files from recent similar tasks
          for (const task of history.slice(-5)) {
            if (task.filesCreated) {
              task.filesCreated.forEach(f => recentFiles.add(f));
            }
            if (task.filesModified) {
              task.filesModified.forEach(f => recentFiles.add(f));
            }
          }
          
          result.suggestedFiles = Array.from(recentFiles);
        }
      }
      
      // Enhanced file detection based on task keywords
      const taskLower = task_title.toLowerCase();
      const detectedFiles = await detectFilesByPattern(workspace_path, taskLower, context);
      
      result.affectedFiles = detectedFiles.files;
      
      // Special handling for common patterns
      if (taskLower.includes('backend') || taskLower.includes('api')) {
        result.suggestedFiles.push(
          'app/api',
          'pages/api',
          'server.js',
          'server',
          'backend',
          'api'
        );
      }
      
      if (taskLower.includes('database') || taskLower.includes('model')) {
        result.suggestedFiles.push(
          'prisma/schema.prisma',
          'models',
          'db',
          'database'
        );
      }
      
      if (taskLower.includes('component')) {
        result.suggestedFiles.push(
          'components',
          'src/components',
          'app/components'
        );
      }
      
      console.log(`[Context-Aware] Found ${result.affectedFiles.length} files, suggested ${result.suggestedFiles.length} locations`);
      
      return {
        success: true,
        ...result,
        message: context 
          ? `Using context for ${context.projectType} project`
          : 'No context available, using pattern matching',
      };
    },
  },
  
  {
    name: 'scan_project_structure',
    description: 'Scan and understand the complete project structure',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_path: {
          type: 'string',
          description: 'Path to the workspace/project',
        },
        project_id: {
          type: 'string',
          description: 'Project ID for context storage',
        },
      },
      required: ['workspace_path'],
    },
    handler: async ({ workspace_path, project_id }) => {
      console.log(`[Context-Aware] Scanning project structure at: ${workspace_path}`);
      
      const structure = {
        directories: {},
        fileTypes: {},
        totalFiles: 0,
        projectType: null,
        hasBackend: false,
        backendType: null,
        hasDatabase: false,
        databaseType: null,
        dependencies: {},
      };
      
      // Scan directory structure
      const scan = await scanDirectory(workspace_path);
      structure.directories = scan.structure;
      structure.totalFiles = scan.fileCount;
      structure.fileTypes = scan.fileTypes;
      
      // Detect project type
      const detection = await detectProjectType(workspace_path);
      Object.assign(structure, detection);
      
      // Store in context if project_id provided
      if (project_id && detection.projectType) {
        await updateProjectContext(project_id, {
          projectType: detection.projectType,
          backendType: detection.backendType,
          ormType: detection.databaseType,
          fileTree: JSON.stringify(scan.structure),
        });
      }
      
      return {
        success: true,
        structure,
        message: `Scanned ${structure.totalFiles} files, detected ${structure.projectType || 'unknown'} project`,
      };
    },
  },
  
  {
    name: 'get_project_summary',
    description: 'Get a summary of the project based on context',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID',
        },
        workspace_path: {
          type: 'string',
          description: 'Path to the workspace/project',
        },
      },
      required: ['project_id', 'workspace_path'],
    },
    handler: async ({ project_id, workspace_path }) => {
      const context = await getProjectContext(project_id);
      
      if (!context) {
        return {
          success: false,
          message: 'No context found for project',
        };
      }
      
      const summary = {
        projectType: context.projectType,
        backendType: context.backendType,
        databaseType: context.ormType,
        lastUpdated: context.updatedAt,
        taskHistory: [],
        fileStats: {},
        technologies: [],
      };
      
      // Parse task history
      if (context.taskHistory) {
        const history = JSON.parse(context.taskHistory);
        summary.taskHistory = history.slice(-10).map(task => ({
          title: task.title,
          timestamp: task.timestamp,
          filesChanged: (task.filesCreated?.length || 0) + (task.filesModified?.length || 0),
        }));
      }
      
      // Parse file tree for stats
      if (context.fileTree) {
        const tree = JSON.parse(context.fileTree);
        summary.fileStats = analyzeFileTree(tree);
      }
      
      // Detect technologies
      if (context.dependencies) {
        const deps = JSON.parse(context.dependencies);
        summary.technologies = Object.keys(deps).filter(dep => 
          ['react', 'vue', 'angular', 'next', 'express', 'django', 'flask'].some(tech => 
            dep.toLowerCase().includes(tech)
          )
        );
      }
      
      return {
        success: true,
        summary,
        message: `Project summary for ${context.projectType || 'unknown'} project`,
      };
    },
  },
];

// Helper functions
async function detectFilesByPattern(workspacePath, taskDescription, context) {
  const files = [];
  const patterns = extractPatterns(taskDescription);
  
  try {
    // Use context to prioritize certain directories
    const searchDirs = [];
    if (context?.projectType === 'nextjs') {
      searchDirs.push('app', 'pages', 'components', 'src');
    } else if (context?.projectType === 'react') {
      searchDirs.push('src', 'components');
    }
    
    // Search for files matching patterns
    for (const pattern of patterns) {
      const searchPath = searchDirs.length > 0 
        ? searchDirs.map(dir => path.join(workspacePath, dir))
        : [workspacePath];
      
      for (const dir of searchPath) {
        try {
          const dirFiles = await findFilesRecursive(dir, pattern);
          files.push(...dirFiles);
        } catch (e) {
          // Directory might not exist
        }
      }
    }
    
    // Remove duplicates
    return {
      files: [...new Set(files)],
      patterns,
    };
  } catch (error) {
    console.error('Error detecting files:', error);
    return { files: [], patterns };
  }
}

async function findFilesRecursive(dir, pattern, basePath = dir) {
  const files = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip common ignore directories
      if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
        continue;
      }
      
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await findFilesRecursive(fullPath, pattern, basePath);
        files.push(...subFiles);
      } else if (entry.name.toLowerCase().includes(pattern) || 
                 (await checkFileContent(fullPath, pattern))) {
        files.push(path.relative(basePath, fullPath));
      }
    }
  } catch (e) {
    // Ignore errors
  }
  
  return files;
}

async function checkFileContent(filePath, pattern) {
  try {
    // Only check text files
    const ext = path.extname(filePath);
    if (!['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.go'].includes(ext)) {
      return false;
    }
    
    const content = await fs.readFile(filePath, 'utf-8');
    return content.toLowerCase().includes(pattern);
  } catch {
    return false;
  }
}

function extractPatterns(description) {
  const patterns = [];
  const keywords = description.toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !['with', 'create', 'update', 'delete', 'make'].includes(word));
  
  // Add specific patterns for common terms
  if (description.includes('todo')) patterns.push('todo');
  if (description.includes('counter')) patterns.push('counter');
  if (description.includes('button')) patterns.push('button');
  if (description.includes('form')) patterns.push('form');
  if (description.includes('auth')) patterns.push('auth');
  
  return [...new Set([...patterns, ...keywords])];
}

async function scanDirectory(dirPath) {
  const structure = {};
  const fileTypes = {};
  let fileCount = 0;
  
  async function scan(dir, current) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          current[entry.name] = {};
          await scan(path.join(dir, entry.name), current[entry.name]);
        } else {
          fileCount++;
          const ext = path.extname(entry.name);
          fileTypes[ext] = (fileTypes[ext] || 0) + 1;
        }
      }
    } catch (e) {
      // Ignore errors
    }
  }
  
  await scan(dirPath, structure);
  
  return {
    structure,
    fileCount,
    fileTypes,
  };
}

async function detectProjectType(workspacePath) {
  const result = {
    projectType: null,
    hasBackend: false,
    backendType: null,
    hasDatabase: false,
    databaseType: null,
    dependencies: {},
  };
  
  // Check package.json
  try {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(workspacePath, 'package.json'), 'utf-8')
    );
    
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    result.dependencies = deps;
    
    // Detect framework
    if (deps['next']) {
      result.projectType = 'nextjs';
      result.hasBackend = true;
      result.backendType = 'nextjs-api';
    } else if (deps['react']) {
      result.projectType = 'react';
    } else if (deps['vue']) {
      result.projectType = 'vue';
    } else if (deps['express']) {
      result.projectType = 'express';
      result.hasBackend = true;
      result.backendType = 'express';
    }
    
    // Detect database
    if (deps['prisma'] || deps['@prisma/client']) {
      result.hasDatabase = true;
      result.databaseType = 'prisma';
    } else if (deps['mongoose']) {
      result.hasDatabase = true;
      result.databaseType = 'mongoose';
    } else if (deps['sequelize']) {
      result.hasDatabase = true;
      result.databaseType = 'sequelize';
    }
  } catch (e) {
    // Not a Node.js project
  }
  
  // Check for Python projects
  try {
    await fs.access(path.join(workspacePath, 'requirements.txt'));
    result.projectType = 'python';
    
    if (await fs.access(path.join(workspacePath, 'manage.py')).then(() => true).catch(() => false)) {
      result.projectType = 'django';
      result.hasBackend = true;
      result.backendType = 'django';
    }
  } catch (e) {
    // Not a Python project
  }
  
  return result;
}

async function updateProjectContext(projectId, updates) {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({
      datasourceUrl: `file:${path.join(__dirname, '../../../client/prisma/prisma/dev.db')}`
    });
    
    await prisma.projectContext.upsert({
      where: { projectId },
      update: updates,
      create: {
        projectId,
        ...updates,
      },
    });
    
    await prisma.$disconnect();
    console.log(`[Context-Aware] Updated context for project ${projectId}`);
  } catch (error) {
    console.error('Error updating context:', error);
  }
}

function analyzeFileTree(tree) {
  const stats = {
    totalDirectories: 0,
    maxDepth: 0,
    largestDirectory: '',
    largestDirFileCount: 0,
  };
  
  function analyze(node, depth = 0) {
    if (typeof node === 'object') {
      stats.totalDirectories++;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
      
      const fileCount = Object.keys(node).length;
      if (fileCount > stats.largestDirFileCount) {
        stats.largestDirFileCount = fileCount;
      }
      
      for (const key in node) {
        analyze(node[key], depth + 1);
      }
    }
  }
  
  analyze(tree);
  return stats;
}