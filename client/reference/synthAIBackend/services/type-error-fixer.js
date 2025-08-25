const fs = require('fs/promises');
const path = require('path');

class TypeErrorFixer {
  constructor() {
    this.commonFixes = {
      // Variant/type literal fixes
      'decrease': 'decrement',
      'increase': 'increment',
      'delete': 'remove',
      'add': 'create',
      'edit': 'update',
      'save': 'submit',
      'cancel': 'close',
      'open': 'show',
      'hide': 'close'
    };
  }

  /**
   * Fix type errors based on compilation output
   */
  async fixTypeError(projectPath, error, socket) {
    const { file, message, line } = error;
    
    if (!file) return false;
    
    const filePath = path.join(projectPath, file);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      let newContent = content;
      let fixed = false;
      
      // Handle different type error patterns
      if (message.includes('is not assignable to type')) {
        fixed = await this.fixAssignmentError(newContent, message, line);
        if (fixed) {
          newContent = fixed;
        }
      } else if (message.includes('Argument of type')) {
        fixed = await this.fixArgumentError(newContent, message, line);
        if (fixed) {
          newContent = fixed;
        }
      } else if (message.includes('Property') && message.includes('is missing')) {
        fixed = await this.fixMissingProperty(newContent, message, file, projectPath);
        if (fixed) {
          newContent = fixed;
        }
      }
      
      if (fixed && newContent !== content) {
        await fs.writeFile(filePath, newContent, 'utf-8');
        if (socket) {
          socket.emit('output', `\x1b[32m✓ Fixed type error in ${file}\x1b[0m\n`);
        }
        return true;
      }
      
      return false;
    } catch (err) {
      console.error(`Failed to fix type error in ${file}:`, err);
      return false;
    }
  }
  
  /**
   * Fix assignment type errors (e.g., wrong literal values)
   */
  async fixAssignmentError(content, errorMessage, lineNumber) {
    // Extract the wrong value and expected type
    const match = errorMessage.match(/Type ['"](.*?)['"] is not assignable to type ['"](.*?)['"]/);
    if (!match) return false;
    
    const [, wrongValue, expectedType] = match;
    
    // Handle union types
    if (expectedType.includes('|')) {
      const validValues = expectedType.split('|').map(v => v.trim().replace(/['"]/g, ''));
      const bestMatch = this.findBestMatch(wrongValue, validValues);
      
      if (bestMatch) {
        // Replace the wrong value
        const lines = content.split('\n');
        if (lineNumber && lines[lineNumber - 1]) {
          lines[lineNumber - 1] = lines[lineNumber - 1].replace(
            new RegExp(`(['"])${wrongValue}\\1`),
            `$1${bestMatch}$1`
          );
          return lines.join('\n');
        } else {
          // Global replacement if no line number
          return content.replace(
            new RegExp(`(['"])${wrongValue}\\1`, 'g'),
            `$1${bestMatch}$1`
          );
        }
      }
    }
    
    return false;
  }
  
  /**
   * Fix function argument type errors
   */
  async fixArgumentError(content, errorMessage, lineNumber) {
    // Extract argument info
    const match = errorMessage.match(/Argument of type '(.+?)' is not assignable to parameter of type '(.+?)'/);
    if (!match) return false;
    
    const [, actualType, expectedType] = match;
    
    // Common fixes for argument type mismatches
    if (expectedType.includes('Event') && !actualType.includes('Event')) {
      // Add proper event typing
      const lines = content.split('\n');
      if (lineNumber && lines[lineNumber - 1]) {
        // Look for the function and add proper typing
        const line = lines[lineNumber - 1];
        const funcMatch = line.match(/(\w+)\s*=\s*\(([^)]*)\)\s*=>/);
        if (funcMatch) {
          const [fullMatch, funcName, params] = funcMatch;
          if (!params.includes(':')) {
            // Add type annotation
            lines[lineNumber - 1] = line.replace(
              fullMatch,
              `${funcName} = (${params}: ${expectedType}) =>`
            );
            return lines.join('\n');
          }
        }
      }
    }
    
    return false;
  }
  
  /**
   * Fix missing required properties
   */
  async fixMissingProperty(content, errorMessage, file, projectPath) {
    const match = errorMessage.match(/Property '(\w+)' is missing/);
    if (!match) return false;
    
    const missingProp = match[1];
    
    // Add default value for missing property
    // This is context-specific and would need more sophisticated analysis
    const defaultValues = {
      'className': '""',
      'onClick': '() => {}',
      'onChange': '() => {}',
      'value': '""',
      'disabled': 'false',
      'loading': 'false'
    };
    
    if (defaultValues[missingProp]) {
      // Find where to add the property
      const componentMatch = content.match(/<(\w+)([^>]*?)>/);
      if (componentMatch) {
        const [fullMatch, componentName, props] = componentMatch;
        if (!props.includes(missingProp)) {
          const newProps = `${props} ${missingProp}={${defaultValues[missingProp]}}`;
          return content.replace(fullMatch, `<${componentName}${newProps}>`);
        }
      }
    }
    
    return false;
  }
  
  /**
   * Find the best matching value from a list
   */
  findBestMatch(input, validValues) {
    // Check common mappings first
    if (this.commonFixes[input]) {
      const fixed = this.commonFixes[input];
      if (validValues.includes(fixed)) {
        return fixed;
      }
    }
    
    // Check exact match (case-insensitive)
    const exactMatch = validValues.find(v => v.toLowerCase() === input.toLowerCase());
    if (exactMatch) return exactMatch;
    
    // Check substring matches
    const substringMatch = validValues.find(v => 
      v.toLowerCase().includes(input.toLowerCase()) || 
      input.toLowerCase().includes(v.toLowerCase())
    );
    if (substringMatch) return substringMatch;
    
    // Use Levenshtein distance for fuzzy matching
    let bestMatch = null;
    let bestDistance = Infinity;
    
    for (const valid of validValues) {
      const distance = this.levenshteinDistance(input.toLowerCase(), valid.toLowerCase());
      if (distance < bestDistance && distance <= 3) {
        bestDistance = distance;
        bestMatch = valid;
      }
    }
    
    return bestMatch;
  }
  
  /**
   * Calculate Levenshtein distance
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;
    
    for (let i = 0; i <= len2; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= len1; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[len2][len1];
  }
}

module.exports = TypeErrorFixer;