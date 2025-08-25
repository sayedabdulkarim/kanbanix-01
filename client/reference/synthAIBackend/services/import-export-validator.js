/**
 * Validates that all imports have matching exports across project files
 */

const path = require('path');

class ImportExportValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Main validation entry point
   * @param {Object} files - Object with file paths as keys and content as values
   * @returns {Object} Validation result with errors and warnings
   */
  validate(files) {
    this.errors = [];
    this.warnings = [];
    
    // Step 1: Build export map
    const exportMap = this.buildExportMap(files);
    
    // Step 2: Validate all imports
    this.validateImports(files, exportMap);
    
    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      exportMap // For debugging
    };
  }

  /**
   * Build a map of all exports in the project
   */
  buildExportMap(files) {
    const exportMap = {};
    
    for (const [filePath, content] of Object.entries(files)) {
      if (!this.isCodeFile(filePath)) continue;
      
      exportMap[filePath] = {
        hasDefault: false,
        named: [],
        reExports: []
      };
      
      // Check for default export
      const defaultExportPatterns = [
        /export\s+default\s+function\s+(\w+)/g,
        /export\s+default\s+class\s+(\w+)/g,
        /export\s+default\s+(\w+)/g,
        /export\s+\{\s*(\w+)\s+as\s+default\s*\}/g
      ];
      
      for (const pattern of defaultExportPatterns) {
        if (pattern.test(content)) {
          exportMap[filePath].hasDefault = true;
          break;
        }
      }
      
      // Check for named exports
      const namedExportPatterns = [
        // export function/const/class/interface/type Name
        /export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)/g,
        // export { Name, Name2 } - but not from another module
        /export\s*\{([^}]+)\}\s*(?!from)/g
      ];
      
      for (const pattern of namedExportPatterns) {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
          if (pattern.source.includes('{([^}]+)}')) {
            // Handle export { Name, Name2 as Alias }
            const exports = match[1].split(',').map(e => {
              const parts = e.trim().split(/\s+as\s+/);
              return parts[parts.length - 1]; // Use alias if exists
            });
            exportMap[filePath].named.push(...exports);
          } else {
            exportMap[filePath].named.push(match[1]);
          }
        }
      }
      
      // Handle re-exports: export { Name } from './module'
      const reExportNamedPattern = /export\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g;
      let reMatch;
      while ((reMatch = reExportNamedPattern.exec(content)) !== null) {
        const exports = reMatch[1].split(',').map(e => {
          const parts = e.trim().split(/\s+as\s+/);
          const originalName = parts[0];
          const exportedName = parts[parts.length - 1];
          
          // For now, add to named exports (we could resolve these recursively)
          if (originalName === 'default') {
            // export { default as Something } from './file'
            exportMap[filePath].named.push(exportedName);
          } else {
            exportMap[filePath].named.push(exportedName);
          }
          
          return { original: originalName, exported: exportedName, from: reMatch[2] };
        });
      }
      
      // Check for re-exports (export * from './file')
      const reExportPattern = /export\s*\*\s*(?:as\s+(\w+)\s+)?from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = reExportPattern.exec(content)) !== null) {
        exportMap[filePath].reExports.push({
          namespace: match[1],
          from: match[2]
        });
      }
    }
    
    return exportMap;
  }

  /**
   * Validate all imports against the export map
   */
  validateImports(files, exportMap) {
    for (const [filePath, content] of Object.entries(files)) {
      if (!this.isCodeFile(filePath)) continue;
      
      const imports = this.extractImports(content);
      
      for (const imp of imports) {
        // Skip external packages
        if (!imp.from.startsWith('.') && !imp.from.startsWith('@/')) {
          continue;
        }
        
        // Resolve the import path
        const resolvedPath = this.resolveImportPath(imp.from, filePath, files);
        
        if (!resolvedPath) {
          this.errors.push(`${filePath}: Cannot resolve import path '${imp.from}'`);
          continue;
        }
        
        // Get the exports for the resolved file
        const exports = exportMap[resolvedPath];
        
        if (!exports) {
          this.errors.push(`${filePath}: Import from '${imp.from}' but file not found: ${resolvedPath}`);
          continue;
        }
        
        // Validate the import items
        this.validateImportItems(filePath, imp, exports, resolvedPath);
      }
    }
  }

  /**
   * Extract all imports from a file
   */
  extractImports(content) {
    const imports = [];
    
    // Pattern 1: import Default from 'module'
    const defaultImportPattern = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = defaultImportPattern.exec(content)) !== null) {
      // Skip if it's actually a type import
      const before = content.substring(Math.max(0, match.index - 10), match.index);
      if (before.includes('type ')) continue;
      
      imports.push({
        type: 'default',
        name: match[1],
        from: match[2],
        items: ['default']
      });
    }
    
    // Pattern 2: import { Named } from 'module'
    const namedImportPattern = /import\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g;
    while ((match = namedImportPattern.exec(content)) !== null) {
      const items = match[1].split(',').map(item => {
        const parts = item.trim().split(/\s+as\s+/);
        return parts[0]; // Original name, not alias
      });
      
      imports.push({
        type: 'named',
        from: match[2],
        items: items
      });
    }
    
    // Pattern 3: import * as Name from 'module'
    const namespaceImportPattern = /import\s*\*\s*as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = namespaceImportPattern.exec(content)) !== null) {
      imports.push({
        type: 'namespace',
        name: match[1],
        from: match[2],
        items: ['*']
      });
    }
    
    // Pattern 4: import Default, { Named } from 'module'
    const mixedImportPattern = /import\s+(\w+)\s*,\s*\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g;
    while ((match = mixedImportPattern.exec(content)) !== null) {
      const namedItems = match[2].split(',').map(item => {
        const parts = item.trim().split(/\s+as\s+/);
        return parts[0];
      });
      
      imports.push({
        type: 'mixed',
        defaultName: match[1],
        from: match[3],
        items: ['default', ...namedItems]
      });
    }
    
    return imports;
  }

  /**
   * Resolve import path to actual file path
   */
  resolveImportPath(importPath, fromFile, files) {
    let resolved = importPath;
    
    // Handle @/ alias (common in Next.js)
    if (importPath.startsWith('@/')) {
      resolved = importPath.replace('@/', '/src/');
    } else if (importPath.startsWith('.')) {
      // Relative import
      const dir = path.dirname(fromFile);
      resolved = path.join(dir, importPath);
      // Normalize path (remove ./ and ../)
      resolved = path.normalize(resolved);
      // Ensure it starts with /
      if (!resolved.startsWith('/')) {
        resolved = '/' + resolved;
      }
    } else {
      // External package, skip
      return null;
    }
    
    // Try exact path first
    if (files[resolved]) {
      return resolved;
    }
    
    // Try with extensions
    const extensions = ['.tsx', '.ts', '.jsx', '.js'];
    for (const ext of extensions) {
      if (files[resolved + ext]) {
        return resolved + ext;
      }
    }
    
    // Try index files
    for (const ext of extensions) {
      const indexPath = path.join(resolved, 'index' + ext);
      if (files[indexPath]) {
        return indexPath;
      }
    }
    
    return null;
  }

  /**
   * Validate that import items exist in exports
   */
  validateImportItems(importingFile, imp, exports, exportedFile) {
    for (const item of imp.items) {
      if (item === 'default') {
        if (!exports.hasDefault) {
          this.errors.push(
            `${importingFile}: Imports default from '${imp.from}' but ${exportedFile} has no default export`
          );
        }
      } else if (item === '*') {
        // Namespace import is always valid
        continue;
      } else {
        // Named import
        if (!exports.named.includes(item)) {
          // Check re-exports
          let found = false;
          for (const reExport of exports.reExports) {
            if (!reExport.namespace) {
              // export * from './file' - we'd need to check that file
              this.warnings.push(
                `${importingFile}: Import '${item}' might be re-exported from ${exportedFile}`
              );
              found = true;
              break;
            }
          }
          
          if (!found) {
            this.errors.push(
              `${importingFile}: Imports '${item}' from '${imp.from}' but ${exportedFile} doesn't export '${item}'`
            );
          }
        }
      }
    }
  }

  /**
   * Check if file is a code file
   */
  isCodeFile(filePath) {
    return /\.(ts|tsx|js|jsx)$/.test(filePath) && 
           !filePath.includes('.d.ts') &&
           !filePath.includes('node_modules');
  }
}

module.exports = ImportExportValidator;