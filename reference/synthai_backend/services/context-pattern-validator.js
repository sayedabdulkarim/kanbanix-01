/**
 * Context Pattern Validator
 * Ensures React Context files follow consistent patterns
 */

class ContextPatternValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Validate a context file
   * @param {string} filePath - Path to the context file
   * @param {string} content - File content
   * @returns {Object} Validation result with exports info
   */
  validateContextFile(filePath, content) {
    const contextName = this.extractContextName(filePath);
    if (!contextName) {
      return { valid: false, error: 'Could not determine context name from file path' };
    }

    const result = {
      valid: true,
      contextName,
      exports: {
        context: false,
        hook: false,
        provider: false,
        types: []
      },
      errors: []
    };

    // Check for 'use client' directive
    if (!content.trim().startsWith("'use client'")) {
      result.errors.push("Context file must start with 'use client' directive");
    }

    // Check for Context export (e.g., export const TodoContext)
    const contextExportPattern = new RegExp(`export\\s+(const|let)\\s+${contextName}Context\\s*=\\s*createContext`, 'i');
    if (contextExportPattern.test(content)) {
      result.exports.context = true;
    } else {
      result.errors.push(`Missing export: ${contextName}Context`);
    }

    // Check for hook export (e.g., export function useTodoContext)
    const hookExportPattern = new RegExp(`export\\s+(function|const)\\s+use${contextName}Context`, 'i');
    if (hookExportPattern.test(content)) {
      result.exports.hook = true;
    } else {
      result.errors.push(`Missing export: use${contextName}Context`);
    }

    // Check for Provider export (e.g., export function TodoProvider)
    const providerExportPattern = new RegExp(`export\\s+(function|const)\\s+${contextName}Provider`, 'i');
    if (providerExportPattern.test(content)) {
      result.exports.provider = true;
    } else {
      result.errors.push(`Missing export: ${contextName}Provider`);
    }

    // Check for type exports
    const typeExportPattern = new RegExp(`export\\s+(interface|type)\\s+(\\w+)`, 'g');
    let match;
    while ((match = typeExportPattern.exec(content)) !== null) {
      result.exports.types.push(match[2]);
    }

    // Check hook implementation
    if (result.exports.hook) {
      const hookUsesContext = new RegExp(`use${contextName}Context[^{]*{[^}]*useContext\\s*\\(\\s*${contextName}Context\\s*\\)`, 's').test(content);
      if (!hookUsesContext) {
        result.warnings.push(`use${contextName}Context should use useContext(${contextName}Context)`);
      }

      // Check for error handling
      const hasErrorHandling = /throw\s+new\s+Error.*must\s+be\s+used\s+within/i.test(content);
      if (!hasErrorHandling) {
        result.warnings.push('Hook should throw error when used outside provider');
      }
    }

    // Check Provider implementation
    if (result.exports.provider) {
      const providerUsesContext = new RegExp(`${contextName}Provider[^{]*{[^}]*<\\s*${contextName}Context\\.Provider`, 's').test(content);
      if (!providerUsesContext) {
        result.errors.push(`${contextName}Provider must use ${contextName}Context.Provider`);
      }
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  /**
   * Extract context name from file path
   * @param {string} filePath - e.g., /src/context/TodoContext.tsx
   * @returns {string|null} Context name (e.g., "Todo")
   */
  extractContextName(filePath) {
    const match = filePath.match(/(\w+)Context\.(tsx?|jsx?)$/);
    return match ? match[1] : null;
  }

  /**
   * Validate component imports from context
   * @param {string} componentPath - Path to component file
   * @param {string} componentContent - Component file content
   * @param {Object} contextInfo - Info about the context file
   * @returns {Object} Validation result
   */
  validateComponentImports(componentPath, componentContent, contextInfo) {
    const result = {
      valid: true,
      errors: [],
      imports: []
    };

    // Extract imports from context
    const importPattern = /import\s*{([^}]+)}\s*from\s*['"][^'"]*[Cc]ontext[^'"]*['"]/g;
    let match;
    
    while ((match = importPattern.exec(componentContent)) !== null) {
      const imports = match[1].split(',').map(i => i.trim());
      result.imports.push(...imports);

      // Check each import
      for (const imp of imports) {
        const isValidImport = 
          imp === `${contextInfo.contextName}Context` ||
          imp === `use${contextInfo.contextName}Context` ||
          imp === `${contextInfo.contextName}Provider` ||
          contextInfo.exports.types.includes(imp);

        if (!isValidImport) {
          result.errors.push(`Invalid import '${imp}' - not exported from ${contextInfo.contextName}Context`);
        }
      }
    }

    // If component uses context, it should import the hook
    const usesContextHook = new RegExp(`use${contextInfo.contextName}Context\\s*\\(`, 'i').test(componentContent);
    if (usesContextHook && !result.imports.includes(`use${contextInfo.contextName}Context`)) {
      result.errors.push(`Component uses use${contextInfo.contextName}Context but doesn't import it`);
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  /**
   * Validate all context patterns in the project
   * @param {Object} files - Map of file paths to content
   * @returns {Object} Validation result
   */
  validateAll(files) {
    this.errors = [];
    this.warnings = [];
    const contexts = {};

    // First, find and validate all context files
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath.includes('context') && filePath.match(/Context\.(tsx?|jsx?)$/)) {
        const validation = this.validateContextFile(filePath, content);
        contexts[filePath] = validation;
        
        if (!validation.valid) {
          this.errors.push(...validation.errors.map(e => `${filePath}: ${e}`));
        }
        if (validation.warnings) {
          this.warnings.push(...validation.warnings.map(w => `${filePath}: ${w}`));
        }
      }
    }

    // Then validate components that import from contexts
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath.includes('components') && (filePath.endsWith('.tsx') || filePath.endsWith('.jsx'))) {
        // Check if this component imports from any context
        for (const [contextPath, contextInfo] of Object.entries(contexts)) {
          if (content.includes('Context')) {
            const validation = this.validateComponentImports(filePath, content, contextInfo);
            if (!validation.valid) {
              this.errors.push(...validation.errors.map(e => `${filePath}: ${e}`));
            }
          }
        }
      }
    }

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      contexts: contexts
    };
  }
}

module.exports = ContextPatternValidator;