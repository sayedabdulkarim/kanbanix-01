import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');

export const codeTools = [
  {
    name: 'analyze_code_structure',
    description: 'Analyze project structure and dependencies',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to analyze',
          default: '.',
        },
      },
    },
    handler: async ({ path: targetPath = '.' }) => {
      const fullPath = path.resolve(PROJECT_ROOT, targetPath);
      
      // Check for package.json
      let dependencies = {};
      let scripts = {};
      try {
        const packagePath = path.join(fullPath, 'package.json');
        const packageContent = await fs.readFile(packagePath, 'utf-8');
        const packageJson = JSON.parse(packageContent);
        dependencies = packageJson.dependencies || {};
        scripts = packageJson.scripts || {};
      } catch {
        // No package.json
      }
      
      // Analyze file structure
      const jsFiles = await glob('**/*.{js,jsx,ts,tsx}', {
        cwd: fullPath,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
      });
      
      const structure = {
        total_files: jsFiles.length,
        file_types: {},
        directories: new Set(),
      };
      
      jsFiles.forEach(file => {
        const ext = path.extname(file);
        structure.file_types[ext] = (structure.file_types[ext] || 0) + 1;
        structure.directories.add(path.dirname(file));
      });
      
      return JSON.stringify({
        dependencies: Object.keys(dependencies),
        scripts: Object.keys(scripts),
        structure: {
          total_files: structure.total_files,
          file_types: structure.file_types,
          main_directories: Array.from(structure.directories)
            .filter(d => !d.includes('/'))
            .slice(0, 10),
        },
      }, null, 2);
    },
  },

  {
    name: 'find_todos',
    description: 'Find TODO, FIXME, and HACK comments in code',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to search',
          default: '.',
        },
      },
    },
    handler: async ({ path: searchPath = '.' }) => {
      const fullPath = path.resolve(PROJECT_ROOT, searchPath);
      const files = await glob('**/*.{js,jsx,ts,tsx}', {
        cwd: fullPath,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
      });
      
      const todos = [];
      const patterns = /\b(TODO|FIXME|HACK|XXX|NOTE|BUG)\b:?\s*(.*)/gi;
      
      for (const file of files) {
        const content = await fs.readFile(path.join(fullPath, file), 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          const matches = line.matchAll(patterns);
          for (const match of matches) {
            todos.push({
              file,
              line: index + 1,
              type: match[1].toUpperCase(),
              message: match[2].trim(),
            });
          }
        });
      }
      
      if (todos.length === 0) {
        return 'No TODOs found';
      }
      
      return todos
        .map(t => `${t.file}:${t.line} [${t.type}] ${t.message}`)
        .join('\n');
    },
  },

  {
    name: 'analyze_imports',
    description: 'Analyze import statements in a file',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'File to analyze',
        },
      },
      required: ['file'],
    },
    handler: async ({ file }) => {
      const fullPath = path.resolve(PROJECT_ROOT, file);
      const content = await fs.readFile(fullPath, 'utf-8');
      
      // Match various import patterns
      const importPatterns = [
        /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g,
        /require\s*\(['"]([^'"]+)['"]\)/g,
      ];
      
      const imports = new Set();
      
      importPatterns.forEach(pattern => {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
          imports.add(match[1]);
        }
      });
      
      const importList = Array.from(imports);
      const external = importList.filter(i => !i.startsWith('.') && !i.startsWith('/'));
      const internal = importList.filter(i => i.startsWith('.') || i.startsWith('/'));
      
      return JSON.stringify({
        total: importList.length,
        external_packages: external,
        internal_modules: internal,
      }, null, 2);
    },
  },

  {
    name: 'find_function',
    description: 'Find function or class definitions',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Function or class name to find',
        },
        path: {
          type: 'string',
          description: 'Directory to search',
          default: '.',
        },
      },
      required: ['name'],
    },
    handler: async ({ name, path: searchPath = '.' }) => {
      const fullPath = path.resolve(PROJECT_ROOT, searchPath);
      const files = await glob('**/*.{js,jsx,ts,tsx}', {
        cwd: fullPath,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
      });
      
      const results = [];
      
      // Patterns to match function/class definitions
      const patterns = [
        new RegExp(`(function|const|let|var)\\s+${name}\\s*[=(]`, 'g'),
        new RegExp(`class\\s+${name}\\s*[{<]`, 'g'),
        new RegExp(`${name}\\s*:\\s*function`, 'g'),
        new RegExp(`${name}\\s*\\([^)]*\\)\\s*[{:]`, 'g'),
      ];
      
      for (const file of files) {
        const content = await fs.readFile(path.join(fullPath, file), 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          patterns.forEach(pattern => {
            if (pattern.test(line)) {
              results.push({
                file,
                line: index + 1,
                code: line.trim(),
              });
            }
          });
        });
      }
      
      if (results.length === 0) {
        return `No definitions found for "${name}"`;
      }
      
      return results
        .map(r => `${r.file}:${r.line}\n  ${r.code}`)
        .join('\n\n');
    },
  },

  {
    name: 'count_lines',
    description: 'Count lines of code in project',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to analyze',
          default: '.',
        },
      },
    },
    handler: async ({ path: targetPath = '.' }) => {
      const fullPath = path.resolve(PROJECT_ROOT, targetPath);
      const files = await glob('**/*.{js,jsx,ts,tsx,css,html}', {
        cwd: fullPath,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
      });
      
      let totalLines = 0;
      let totalCode = 0;
      let totalComments = 0;
      let totalBlank = 0;
      
      for (const file of files) {
        const content = await fs.readFile(path.join(fullPath, file), 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach(line => {
          totalLines++;
          const trimmed = line.trim();
          
          if (trimmed === '') {
            totalBlank++;
          } else if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
            totalComments++;
          } else {
            totalCode++;
          }
        });
      }
      
      return JSON.stringify({
        total_lines: totalLines,
        code_lines: totalCode,
        comment_lines: totalComments,
        blank_lines: totalBlank,
        files_analyzed: files.length,
      }, null, 2);
    },
  },
];