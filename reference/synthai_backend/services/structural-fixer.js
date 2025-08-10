const fs = require('fs/promises');
const path = require('path');

class StructuralFixer {
  /**
   * Analyze and fix structural mismatches between components and their dependencies
   */
  async analyzeAndFixMismatch(projectPath, errorInfo, socket) {
    const { file, message } = errorInfo;
    
    // Extract the missing properties
    const missingProperties = this.extractMissingProperties(message);
    if (!missingProperties.length) return false;
    
    // Find the source of the destructuring
    const filePath = path.join(projectPath, file);
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Identify the hook or context being used
    const source = this.identifySource(content, missingProperties);
    if (!source) return false;
    
    if (socket) {
      socket.emit('output', `\n\x1b[36m> Fixing structural mismatch: ${source.type} ${source.name}\x1b[0m\n`);
    }
    
    // Fix based on the type of source
    switch (source.type) {
      case 'hook':
        return await this.fixHookMismatch(projectPath, source, missingProperties);
      case 'context':
        return await this.fixContextMismatch(projectPath, source, missingProperties);
      default:
        return false;
    }
  }
  
  extractMissingProperties(errorMessage) {
    const properties = [];
    const regex = /Property '([^']+)' does not exist/g;
    let match;
    
    while ((match = regex.exec(errorMessage)) !== null) {
      properties.push(match[1]);
    }
    
    return properties;
  }
  
  identifySource(content, missingProperties) {
    // Check for hook usage
    const hookRegex = /const\s*{\s*([^}]+)\s*}\s*=\s*(use\w+)\(/;
    const hookMatch = content.match(hookRegex);
    
    if (hookMatch) {
      const destructured = hookMatch[1].split(',').map(s => s.trim());
      if (missingProperties.some(prop => destructured.includes(prop))) {
        return {
          type: 'hook',
          name: hookMatch[2],
          destructured
        };
      }
    }
    
    // Check for context usage
    const contextRegex = /const\s*{\s*([^}]+)\s*}\s*=\s*useContext\((\w+)\)/;
    const contextMatch = content.match(contextRegex);
    
    if (contextMatch) {
      return {
        type: 'context',
        name: contextMatch[2],
        destructured: contextMatch[1].split(',').map(s => s.trim())
      };
    }
    
    return null;
  }
  
  async fixHookMismatch(projectPath, source, missingProperties) {
    try {
      const hooksDir = path.join(projectPath, 'src', 'hooks');
      const hookFileName = `${source.name}.ts`;
      const hookPath = path.join(hooksDir, hookFileName);
      
      // Check if hook file exists
      try {
        await fs.access(hookPath);
      } catch {
        // Try alternative naming
        const altPath = path.join(hooksDir, `${source.name.slice(3)}.ts`);
        try {
          await fs.access(altPath);
          hookPath = altPath;
        } catch {
          console.error(`Hook file not found: ${hookPath}`);
          return false;
        }
      }
      
      const hookContent = await fs.readFile(hookPath, 'utf-8');
      let updatedContent = hookContent;
      
      // Add missing properties based on common patterns
      for (const prop of missingProperties) {
        if (prop.includes('Modal')) {
          updatedContent = await this.addModalState(updatedContent, prop);
        } else if (prop.startsWith('is') || prop.startsWith('has')) {
          updatedContent = await this.addBooleanState(updatedContent, prop);
        } else if (prop.startsWith('set')) {
          // This is likely a setter function that should already exist
          continue;
        } else {
          updatedContent = await this.addGenericState(updatedContent, prop);
        }
      }
      
      // Update the return statement
      updatedContent = this.updateReturnStatement(updatedContent, missingProperties);
      
      if (updatedContent !== hookContent) {
        await fs.writeFile(hookPath, updatedContent, 'utf-8');
        return true;
      }
      
      return false;
    } catch (err) {
      console.error('Error fixing hook mismatch:', err);
      return false;
    }
  }
  
  async addModalState(content, propertyName) {
    // Modal pattern: isXModalOpen, openXModal, closeXModal
    const modalName = propertyName.replace(/^is|Open$/g, '');
    const stateName = `is${modalName}`;
    const openFunc = `open${modalName.replace('Modal', '')}Modal`;
    const closeFunc = `close${modalName.replace('Modal', '')}Modal`;
    
    // Check if already exists
    if (content.includes(stateName)) return content;
    
    // Find the last useState call
    const lastStateIndex = content.lastIndexOf('useState');
    const lineEnd = content.indexOf('\n', lastStateIndex);
    
    const modalCode = `
  const [${stateName}, set${modalName}] = useState(false);
  
  const ${openFunc} = () => set${modalName}(true);
  const ${closeFunc} = () => set${modalName}(false);`;
    
    return content.slice(0, lineEnd) + modalCode + content.slice(lineEnd);
  }
  
  async addBooleanState(content, propertyName) {
    // Boolean state pattern
    const setterName = `set${propertyName.charAt(0).toUpperCase() + propertyName.slice(1)}`;
    
    if (content.includes(propertyName)) return content;
    
    const lastStateIndex = content.lastIndexOf('useState');
    const lineEnd = content.indexOf('\n', lastStateIndex);
    
    const stateCode = `
  const [${propertyName}, ${setterName}] = useState(false);`;
    
    return content.slice(0, lineEnd) + stateCode + content.slice(lineEnd);
  }
  
  async addGenericState(content, propertyName) {
    // Generic state pattern
    const capitalizedName = propertyName.charAt(0).toUpperCase() + propertyName.slice(1);
    const setterName = `set${capitalizedName}`;
    
    if (content.includes(propertyName)) return content;
    
    const lastStateIndex = content.lastIndexOf('useState');
    const lineEnd = content.indexOf('\n', lastStateIndex);
    
    const stateCode = `
  const [${propertyName}, ${setterName}] = useState<any>(null);`;
    
    return content.slice(0, lineEnd) + stateCode + content.slice(lineEnd);
  }
  
  updateReturnStatement(content, newProperties) {
    const returnRegex = /return\s*{\s*([^}]+)\s*}/s;
    const match = content.match(returnRegex);
    
    if (!match) return content;
    
    const currentReturns = match[1].trim().split(',').map(s => s.trim());
    const allReturns = [...currentReturns];
    
    for (const prop of newProperties) {
      if (!currentReturns.some(r => r.includes(prop))) {
        allReturns.push(prop);
        
        // Add related functions for modal patterns
        if (prop.startsWith('is') && prop.includes('Modal')) {
          const modalName = prop.replace(/^is|Open$/g, '');
          const openFunc = `open${modalName.replace('Modal', '')}Modal`;
          const closeFunc = `close${modalName.replace('Modal', '')}Modal`;
          allReturns.push(openFunc, closeFunc);
        }
      }
    }
    
    const newReturn = `return {\n    ${allReturns.join(',\n    ')}\n  }`;
    return content.replace(returnRegex, newReturn);
  }
  
  async fixContextMismatch(projectPath, source, missingProperties) {
    // Similar logic for context providers
    // This would update the context provider to include missing properties
    return false; // Placeholder for now
  }
}

module.exports = StructuralFixer;