/**
 * Context Pattern Fixer
 * Automatically fixes common Context pattern issues
 */

class ContextPatternFixer {
  /**
   * Fix context export errors based on import errors
   * @param {Object} files - Map of file paths to content
   * @param {Array} errors - Build/validation errors
   * @returns {Object} Fixed files
   */
  fixContextExports(files, errors) {
    const fixes = [];
    const contextErrors = errors.filter(e => 
      e.includes('has no exported member') && 
      e.includes('Context')
    );
    
    for (const error of contextErrors) {
      // Parse error to extract what's missing
      // Example: Module '"@/context/TodoContext"' has no exported member 'useTodoContext'
      const match = error.match(/Module ['"](.*?)['"].*has no exported member ['"](\w+)['"]/);
      
      if (match) {
        const [, importPath, missingExport] = match;
        const contextName = this.extractContextName(importPath);
        
        if (contextName) {
          // Find the context file
          const contextFile = this.findContextFile(files, contextName);
          
          if (contextFile) {
            const fixedContent = this.addMissingExport(
              files[contextFile], 
              contextName, 
              missingExport
            );
            
            if (fixedContent !== files[contextFile]) {
              files[contextFile] = fixedContent;
              fixes.push(`Added missing export '${missingExport}' to ${contextFile}`);
            }
          }
        }
      }
    }
    
    return { files, fixes };
  }
  
  /**
   * Extract context name from import path
   */
  extractContextName(importPath) {
    // @/context/TodoContext -> Todo
    const match = importPath.match(/(\w+)Context/);
    return match ? match[1] : null;
  }
  
  /**
   * Find context file in project
   */
  findContextFile(files, contextName) {
    return Object.keys(files).find(path => 
      path.includes('context') && 
      path.includes(`${contextName}Context`)
    );
  }
  
  /**
   * Add missing export to context file
   */
  addMissingExport(content, contextName, missingExport) {
    // Check if it's the hook
    if (missingExport === `use${contextName}Context`) {
      // Check if hook already exists but not exported
      const hookExists = content.includes(`function use${contextName}Context`) ||
                        content.includes(`const use${contextName}Context`);
      
      if (!hookExists) {
        // Add the hook after the context creation
        const contextLine = content.indexOf(`${contextName}Context = createContext`);
        if (contextLine !== -1) {
          const insertPoint = content.indexOf('\n', contextLine) + 1;
          
          const hookCode = `
// Custom hook for using the context
export function use${contextName}Context() {
  const context = useContext(${contextName}Context);
  if (!context) {
    throw new Error('use${contextName}Context must be used within ${contextName}Provider');
  }
  return context;
}
`;
          
          return content.slice(0, insertPoint) + hookCode + content.slice(insertPoint);
        }
      } else {
        // Hook exists but not exported, add export
        return content.replace(
          new RegExp(`(function use${contextName}Context)`, 'g'),
          'export $1'
        );
      }
    }
    
    // Check if it's the context itself
    if (missingExport === `${contextName}Context`) {
      // Add export to context creation
      return content.replace(
        new RegExp(`(const ${contextName}Context = createContext)`, 'g'),
        'export $1'
      );
    }
    
    // Check if it's the provider
    if (missingExport === `${contextName}Provider`) {
      const providerExists = content.includes(`function ${contextName}Provider`) ||
                            content.includes(`const ${contextName}Provider`);
      
      if (!providerExists) {
        // Add provider at the end of file
        const providerCode = `
// Provider component
export function ${contextName}Provider({ children }: { children: React.ReactNode }) {
  // Add your state and methods here
  const value = {
    // Add context value here
  };
  
  return (
    <${contextName}Context.Provider value={value}>
      {children}
    </${contextName}Context.Provider>
  );
}
`;
        
        return content + providerCode;
      } else {
        // Provider exists but not exported
        return content.replace(
          new RegExp(`(function ${contextName}Provider)`, 'g'),
          'export $1'
        );
      }
    }
    
    return content;
  }
  
  /**
   * Ensure context file has all required exports
   */
  ensureCompleteContext(files) {
    const contextFiles = Object.keys(files).filter(path => 
      path.includes('context') && path.match(/(\w+)Context\.(tsx?|jsx?)$/)
    );
    
    for (const contextFile of contextFiles) {
      const content = files[contextFile];
      const contextName = contextFile.match(/(\w+)Context\.(tsx?|jsx?)$/)?.[1];
      
      if (contextName) {
        let fixed = content;
        
        // Ensure use client directive
        if (!fixed.trim().startsWith("'use client'")) {
          fixed = "'use client';\n\n" + fixed;
        }
        
        // Ensure context export
        if (!fixed.includes(`export const ${contextName}Context`)) {
          fixed = this.addMissingExport(fixed, contextName, `${contextName}Context`);
        }
        
        // Ensure hook export
        if (!fixed.includes(`export function use${contextName}Context`)) {
          fixed = this.addMissingExport(fixed, contextName, `use${contextName}Context`);
        }
        
        // Ensure provider export
        if (!fixed.includes(`export function ${contextName}Provider`) && 
            !fixed.includes(`export const ${contextName}Provider`)) {
          fixed = this.addMissingExport(fixed, contextName, `${contextName}Provider`);
        }
        
        if (fixed !== content) {
          files[contextFile] = fixed;
        }
      }
    }
    
    return files;
  }
}

module.exports = ContextPatternFixer;