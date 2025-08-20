import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCallback);

export const smartFileDetectorTools = [
  {
    name: 'detect_affected_files',
    description: 'Intelligently detect which files need to be modified for a given task',
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
      },
      required: ['task_title', 'workspace_path'],
    },
    handler: async ({ task_title, workspace_path }) => {
      console.log(`Detecting affected files for task: "${task_title}"`);
      
      const affectedFiles = [];
      const taskLower = task_title.toLowerCase();
      
      try {
        // Extract keywords from task title
        const keywords = taskLower
          .split(/\s+/)
          .filter(word => word.length > 2)
          .filter(word => !['the', 'and', 'for', 'with', 'add'].includes(word));
        
        console.log(`Keywords extracted: ${keywords.join(', ')}`);
        
        // Strategy 1: Look for component files based on keywords
        for (const keyword of keywords) {
          // Special handling for common patterns
          if (keyword === 'reset' || keyword === 'button') {
            // Look for files that likely contain interactive components
            try {
              const componentFiles = await glob('**/components/**/*.{tsx,ts,jsx,js}', {
                cwd: workspace_path,
                ignore: ['**/node_modules/**'],
              });
              
              // Read each component file to check if it's relevant
              for (const file of componentFiles) {
                const filePath = path.join(workspace_path, file);
                const content = await fs.readFile(filePath, 'utf-8');
                
                // Check if file contains state management or is a counter
                if (content.includes('useState') || 
                    content.includes('counter') || 
                    content.includes('increment') ||
                    content.includes('decrement')) {
                  affectedFiles.push(file);
                  console.log(`Found relevant component: ${file}`);
                }
              }
            } catch (err) {
              console.log('Error scanning component files:', err.message);
            }
          }
          
          // Strategy 2: Search for files containing the keyword
          if (keyword === 'counter' || keyword === 'todo' || keyword === 'form') {
            try {
              // Use grep to search for files containing the keyword
              const { stdout } = await exec(
                `grep -r "${keyword}" "${workspace_path}/src" --include="*.tsx" --include="*.ts" --include="*.jsx" --include="*.js" -l 2>/dev/null || true`,
                { maxBuffer: 1024 * 1024 }
              );
              
              if (stdout) {
                const files = stdout.split('\n').filter(Boolean);
                for (const file of files) {
                  const relativePath = path.relative(workspace_path, file);
                  if (!affectedFiles.includes(relativePath)) {
                    affectedFiles.push(relativePath);
                    console.log(`Found file containing "${keyword}": ${relativePath}`);
                  }
                }
              }
            } catch (err) {
              // Grep might fail if no matches, that's okay
              console.log(`No files found containing "${keyword}"`);
            }
          }
        }
        
        // Strategy 3: Look for specific component names
        const componentNames = extractComponentNames(task_title);
        for (const componentName of componentNames) {
          const patterns = [
            `**/components/${componentName}.{tsx,ts,jsx,js}`,
            `**/components/${componentName}/**/*.{tsx,ts,jsx,js}`,
            `**/${componentName}.{tsx,ts,jsx,js}`,
          ];
          
          for (const pattern of patterns) {
            try {
              const files = await glob(pattern, {
                cwd: workspace_path,
                ignore: ['**/node_modules/**'],
              });
              
              for (const file of files) {
                if (!affectedFiles.includes(file)) {
                  affectedFiles.push(file);
                  console.log(`Found component file: ${file}`);
                }
              }
            } catch (err) {
              // Pattern might not match anything
            }
          }
        }
        
        // Remove duplicates and sort
        const uniqueFiles = [...new Set(affectedFiles)].sort();
        
        console.log(`Total affected files detected: ${uniqueFiles.length}`);
        return {
          success: true,
          files: uniqueFiles,
          message: `Found ${uniqueFiles.length} potentially affected files`,
        };
        
      } catch (error) {
        console.error('Error detecting affected files:', error);
        return {
          success: false,
          files: [],
          error: error.message,
        };
      }
    },
  },
  
  {
    name: 'read_files_for_modification',
    description: 'Read multiple files and prepare them for modification',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of file paths to read',
        },
        workspace_path: {
          type: 'string',
          description: 'Path to the workspace',
        },
      },
      required: ['files', 'workspace_path'],
    },
    handler: async ({ files, workspace_path }) => {
      const fileContents = {};
      const errors = [];
      
      for (const file of files) {
        try {
          const fullPath = path.join(workspace_path, file);
          const content = await fs.readFile(fullPath, 'utf-8');
          fileContents[file] = {
            content,
            exists: true,
            lines: content.split('\n').length,
          };
          console.log(`Read file: ${file} (${fileContents[file].lines} lines)`);
        } catch (error) {
          if (error.code === 'ENOENT') {
            fileContents[file] = {
              content: null,
              exists: false,
              error: 'File not found',
            };
          } else {
            errors.push(`Error reading ${file}: ${error.message}`);
          }
        }
      }
      
      return {
        success: errors.length === 0,
        fileContents,
        errors,
        totalFiles: files.length,
        existingFiles: Object.values(fileContents).filter(f => f.exists).length,
      };
    },
  },
  
  {
    name: 'search_project_code',
    description: 'Search for code patterns in the project',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Pattern to search for (regex supported)',
        },
        workspace_path: {
          type: 'string',
          description: 'Path to the workspace',
        },
        file_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'File extensions to search (e.g., ["tsx", "ts"])',
          default: ['tsx', 'ts', 'jsx', 'js'],
        },
      },
      required: ['pattern', 'workspace_path'],
    },
    handler: async ({ pattern, workspace_path, file_types = ['tsx', 'ts', 'jsx', 'js'] }) => {
      try {
        const includeFlags = file_types.map(ext => `--include="*.${ext}"`).join(' ');
        const command = `grep -r "${pattern}" "${workspace_path}/src" ${includeFlags} -l 2>/dev/null || true`;
        
        const { stdout } = await exec(command, { maxBuffer: 1024 * 1024 });
        
        if (!stdout) {
          return {
            success: true,
            files: [],
            message: `No files found matching pattern: ${pattern}`,
          };
        }
        
        const files = stdout.split('\n').filter(Boolean).map(file => 
          path.relative(workspace_path, file)
        );
        
        return {
          success: true,
          files,
          message: `Found ${files.length} files matching pattern`,
        };
        
      } catch (error) {
        return {
          success: false,
          files: [],
          error: error.message,
        };
      }
    },
  },
];

// Helper function to extract component names from task title
function extractComponentNames(taskTitle) {
  const componentNames = [];
  
  // Common component patterns
  const patterns = [
    /(\w+)\s+component/gi,
    /(\w+)\s+page/gi,
    /(\w+)\s+form/gi,
    /(\w+)\s+modal/gi,
    /(\w+)\s+button/gi,
  ];
  
  for (const pattern of patterns) {
    const matches = taskTitle.matchAll(pattern);
    for (const match of matches) {
      componentNames.push(match[1]);
    }
  }
  
  // Also check for specific known components
  const knownComponents = ['Counter', 'Todo', 'Form', 'Modal', 'Navigation', 'Header', 'Footer'];
  for (const component of knownComponents) {
    if (taskTitle.toLowerCase().includes(component.toLowerCase())) {
      componentNames.push(component);
    }
  }
  
  return componentNames;
}