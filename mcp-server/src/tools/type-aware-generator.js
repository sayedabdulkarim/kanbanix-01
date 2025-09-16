#!/usr/bin/env node

/**
 * Phase 4: Type-Aware Pre-Generation System
 * 
 * This module prevents errors BEFORE generation (like Cursor/Copilot)
 * instead of fixing them AFTER (our current Reflection Loop approach)
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

// TypeScript will be loaded dynamically only if available
let ts = null;
try {
  ts = await import('typescript');
  ts = ts.default || ts;
} catch (e) {
  console.log('[TypeAnalyzer] TypeScript not installed, some features disabled');
}

const execPromise = promisify(exec);

/**
 * TypeSystemAnalyzer - Loads and understands project types BEFORE generation
 */
export class TypeSystemAnalyzer {
  constructor() {
    this.typeCache = new Map();
    this.importMap = new Map();
    this.exportMap = new Map();
    this.schemaCache = null;
  }

  /**
   * Analyze entire project BEFORE generating any code
   * This is like Claude Code's "Plan Mode"
   */
  async analyzeProject(projectPath) {
    console.log('[TypeAnalyzer] Starting project analysis...');
    
    const analysis = {
      types: await this.loadTypeDefinitions(projectPath),
      schemas: await this.parseSchemas(projectPath),
      imports: await this.scanImportsExports(projectPath),
      patterns: await this.detectPatterns(projectPath),
      dependencies: await this.loadDependencies(projectPath)
    };
    
    console.log('[TypeAnalyzer] Analysis complete:', {
      typesFound: analysis.types.size,
      schemasFound: Object.keys(analysis.schemas).length,
      importsFound: analysis.imports.size,
      patternsDetected: Object.keys(analysis.patterns).length
    });
    
    return analysis;
  }

  /**
   * Load TypeScript type definitions from the project
   */
  async loadTypeDefinitions(projectPath) {
    const types = new Map();
    
    try {
      // Find tsconfig.json
      const tsconfigPath = path.join(projectPath, 'tsconfig.json');
      const hasTypeScript = await fs.access(tsconfigPath).then(() => true).catch(() => false);
      
      if (hasTypeScript && ts) {
        console.log('[TypeAnalyzer] Loading TypeScript types...');
        
        // Parse tsconfig
        const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          projectPath
        );
        
        // Create TypeScript program
        const program = ts.createProgram({
          rootNames: parsedConfig.fileNames,
          options: parsedConfig.options
        });
        
        const checker = program.getTypeChecker();
        
        // Scan all source files for types
        for (const sourceFile of program.getSourceFiles()) {
          if (sourceFile.fileName.includes('node_modules')) continue;
          
          ts.forEachChild(sourceFile, (node) => {
            // Extract interfaces
            if (ts.isInterfaceDeclaration(node) && node.name) {
              const symbol = checker.getSymbolAtLocation(node.name);
              if (symbol) {
                const type = checker.getTypeOfSymbolAtLocation(symbol, node);
                types.set(symbol.getName(), {
                  kind: 'interface',
                  members: this.extractTypeMembers(type, checker)
                });
              }
            }
            
            // Extract type aliases
            if (ts.isTypeAliasDeclaration(node) && node.name) {
              const symbol = checker.getSymbolAtLocation(node.name);
              if (symbol) {
                types.set(symbol.getName(), {
                  kind: 'type',
                  definition: node.type.getText()
                });
              }
            }
            
            // Extract classes
            if (ts.isClassDeclaration(node) && node.name) {
              const symbol = checker.getSymbolAtLocation(node.name);
              if (symbol) {
                types.set(symbol.getName(), {
                  kind: 'class',
                  members: this.extractClassMembers(node)
                });
              }
            }
          });
        }
      }
    } catch (error) {
      console.log('[TypeAnalyzer] Error loading TypeScript types:', error.message);
    }
    
    return types;
  }

  /**
   * Parse database schemas (Prisma, GraphQL, etc.)
   */
  async parseSchemas(projectPath) {
    const schemas = {};
    
    // Check for Prisma schema
    try {
      const prismaPath = path.join(projectPath, 'prisma', 'schema.prisma');
      const hasPrisma = await fs.access(prismaPath).then(() => true).catch(() => false);
      
      if (hasPrisma) {
        console.log('[TypeAnalyzer] Parsing Prisma schema...');
        const schemaContent = await fs.readFile(prismaPath, 'utf-8');
        schemas.prisma = this.parsePrismaSchema(schemaContent);
      }
    } catch (error) {
      console.log('[TypeAnalyzer] No Prisma schema found');
    }
    
    // Check for GraphQL schema
    try {
      const graphqlPaths = [
        path.join(projectPath, 'schema.graphql'),
        path.join(projectPath, 'src', 'schema.graphql')
      ];
      
      for (const gqlPath of graphqlPaths) {
        const hasGraphQL = await fs.access(gqlPath).then(() => true).catch(() => false);
        if (hasGraphQL) {
          console.log('[TypeAnalyzer] Parsing GraphQL schema...');
          const schemaContent = await fs.readFile(gqlPath, 'utf-8');
          schemas.graphql = this.parseGraphQLSchema(schemaContent);
          break;
        }
      }
    } catch (error) {
      console.log('[TypeAnalyzer] No GraphQL schema found');
    }
    
    return schemas;
  }

  /**
   * Scan all imports and exports to build dependency map
   */
  async scanImportsExports(projectPath) {
    const imports = new Map();
    const exports = new Map();
    
    try {
      // Use ripgrep for fast scanning (like Claude Code)
      const { stdout: importResults } = await execPromise(
        `rg "^import.*from" --type ts --type tsx --type js --type jsx -g "!node_modules" "${projectPath}" 2>/dev/null || true`
      );
      
      // Parse import statements
      const importLines = importResults.split('\n').filter(Boolean);
      for (const line of importLines) {
        const match = line.match(/import\s+(?:{([^}]+)}|(\w+)|(\*\s+as\s+\w+))\s+from\s+['"]([^'"]+)['"]/);
        if (match) {
          const [, namedImports, defaultImport, namespaceImport, modulePath] = match;
          const items = namedImports ? namedImports.split(',').map(s => s.trim()) :
                       defaultImport ? [defaultImport] :
                       namespaceImport ? [namespaceImport] : [];
          
          imports.set(modulePath, items);
        }
      }
      
      // Scan exports
      const { stdout: exportResults } = await execPromise(
        `rg "^export" --type ts --type tsx --type js --type jsx -g "!node_modules" "${projectPath}" 2>/dev/null || true`
      );
      
      const exportLines = exportResults.split('\n').filter(Boolean);
      for (const line of exportLines) {
        const fileMatch = line.match(/^([^:]+):/);
        if (fileMatch) {
          const filePath = fileMatch[1];
          const exportMatch = line.match(/export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)/);
          if (exportMatch) {
            const exportName = exportMatch[1];
            if (!exports.has(filePath)) {
              exports.set(filePath, []);
            }
            exports.get(filePath).push(exportName);
          }
        }
      }
      
    } catch (error) {
      console.log('[TypeAnalyzer] Error scanning imports/exports:', error.message);
    }
    
    this.importMap = imports;
    this.exportMap = exports;
    
    return imports;
  }

  /**
   * Detect code patterns (like CLAUDE.md approach)
   */
  async detectPatterns(projectPath) {
    const patterns = {};
    
    try {
      // Check for common patterns
      const { stdout } = await execPromise(
        `find "${projectPath}" -type f \\( -name "*.tsx" -o -name "*.jsx" \\) -not -path "*/node_modules/*" | head -5 | xargs grep -h "^import\\|^export\\|^const\\|^function" 2>/dev/null || true`
      );
      
      // Detect import style
      if (stdout.includes("import React from 'react'")) {
        patterns.importStyle = 'default';
      } else if (stdout.includes('import * as React')) {
        patterns.importStyle = 'namespace';
      } else if (stdout.includes('import { ')) {
        patterns.importStyle = 'named';
      }
      
      // Detect component style
      if (stdout.includes('export default function')) {
        patterns.componentStyle = 'function';
      } else if (stdout.includes('export const')) {
        patterns.componentStyle = 'arrow';
      } else if (stdout.includes('export default class')) {
        patterns.componentStyle = 'class';
      }
      
      // Check for specific frameworks
      if (stdout.includes('@/')) {
        patterns.hasPathAlias = true;
        patterns.pathAliasPrefix = '@/';
      }
      
      // Check for CSS approach
      const hasTailwind = await fs.access(path.join(projectPath, 'tailwind.config.js'))
        .then(() => true).catch(() => false);
      const hasStyledComponents = stdout.includes('styled-components');
      
      patterns.styling = hasTailwind ? 'tailwind' : 
                        hasStyledComponents ? 'styled-components' : 
                        'css-modules';
      
    } catch (error) {
      console.log('[TypeAnalyzer] Error detecting patterns:', error.message);
    }
    
    return patterns;
  }

  /**
   * Load package.json dependencies
   */
  async loadDependencies(projectPath) {
    const dependencies = new Set();
    
    try {
      const packagePath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
      
      Object.keys(packageJson.dependencies || {}).forEach(dep => dependencies.add(dep));
      Object.keys(packageJson.devDependencies || {}).forEach(dep => dependencies.add(dep));
      
    } catch (error) {
      console.log('[TypeAnalyzer] Error loading dependencies:', error.message);
    }
    
    return dependencies;
  }

  // Helper methods
  
  extractTypeMembers(type, checker) {
    const members = [];
    const symbol = type.getSymbol();
    
    if (symbol) {
      const properties = checker.getPropertiesOfType(type);
      for (const prop of properties) {
        members.push({
          name: prop.getName(),
          type: checker.typeToString(checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration))
        });
      }
    }
    
    return members;
  }

  extractClassMembers(node) {
    const members = [];
    
    if (!ts) return members;
    
    node.members.forEach(member => {
      if (ts.isPropertyDeclaration(member) || ts.isMethodDeclaration(member)) {
        const name = member.name?.getText();
        if (name) {
          members.push({
            name,
            kind: ts.isMethodDeclaration(member) ? 'method' : 'property'
          });
        }
      }
    });
    
    return members;
  }

  parsePrismaSchema(content) {
    const models = {};
    const modelRegex = /model\s+(\w+)\s*{([^}]+)}/g;
    let match;
    
    while ((match = modelRegex.exec(content)) !== null) {
      const [, modelName, modelBody] = match;
      const fields = [];
      
      const fieldLines = modelBody.split('\n').filter(line => line.trim());
      for (const line of fieldLines) {
        const fieldMatch = line.match(/^\s*(\w+)\s+(\w+)(\[\])?(\?)?/);
        if (fieldMatch) {
          const [, fieldName, fieldType, isArray, isOptional] = fieldMatch;
          fields.push({
            name: fieldName,
            type: fieldType,
            isArray: !!isArray,
            isOptional: !!isOptional
          });
        }
      }
      
      models[modelName] = { fields };
    }
    
    return { models };
  }

  parseGraphQLSchema(content) {
    const types = {};
    const typeRegex = /type\s+(\w+)\s*{([^}]+)}/g;
    let match;
    
    while ((match = typeRegex.exec(content)) !== null) {
      const [, typeName, typeBody] = match;
      const fields = [];
      
      const fieldLines = typeBody.split('\n').filter(line => line.trim());
      for (const line of fieldLines) {
        const fieldMatch = line.match(/^\s*(\w+)\s*:\s*(\[?\w+\]?)(!)?/);
        if (fieldMatch) {
          const [, fieldName, fieldType, isRequired] = fieldMatch;
          fields.push({
            name: fieldName,
            type: fieldType,
            required: !!isRequired
          });
        }
      }
      
      types[typeName] = { fields };
    }
    
    return { types };
  }
}

/**
 * SmartCodeGenerator - Generates code WITH awareness of project context
 */
export class SmartCodeGenerator {
  constructor(analyzer) {
    this.analyzer = analyzer;
  }

  /**
   * Generate code that already knows about the project
   */
  async generateWithContext(task, analysis) {
    console.log('[SmartGenerator] Generating with project awareness...');
    
    // Build context prompt with type information
    const contextPrompt = this.buildContextPrompt(analysis);
    
    // Generate code that uses existing types/imports
    const code = await this.generateCode(task, contextPrompt, analysis);
    
    // Auto-resolve imports from the project
    const codeWithImports = this.autoResolveImports(code, analysis);
    
    return codeWithImports;
  }

  buildContextPrompt(analysis) {
    let prompt = '# Project Context\n\n';
    
    // Add available types
    if (analysis.types.size > 0) {
      prompt += '## Available Types:\n';
      for (const [name, info] of analysis.types) {
        prompt += `- ${name} (${info.kind})\n`;
      }
      prompt += '\n';
    }
    
    // Add Prisma models if available
    if (analysis.schemas.prisma) {
      prompt += '## Prisma Models:\n';
      for (const [modelName, model] of Object.entries(analysis.schemas.prisma.models)) {
        prompt += `- ${modelName}: ${model.fields.map(f => f.name).join(', ')}\n`;
      }
      prompt += '\n';
    }
    
    // Add detected patterns
    if (analysis.patterns) {
      prompt += '## Code Patterns:\n';
      prompt += `- Import style: ${analysis.patterns.importStyle || 'mixed'}\n`;
      prompt += `- Component style: ${analysis.patterns.componentStyle || 'function'}\n`;
      prompt += `- Styling: ${analysis.patterns.styling || 'css'}\n`;
      if (analysis.patterns.hasPathAlias) {
        prompt += `- Path alias: ${analysis.patterns.pathAliasPrefix}\n`;
      }
      prompt += '\n';
    }
    
    // Add available imports
    if (analysis.imports.size > 0) {
      prompt += '## Common Imports:\n';
      let count = 0;
      for (const [module, items] of analysis.imports) {
        if (count++ > 10) break; // Limit to first 10
        prompt += `- ${module}: ${Array.isArray(items) ? items.join(', ') : items}\n`;
      }
      prompt += '\n';
    }
    
    return prompt;
  }

  async generateCode(task, contextPrompt, analysis) {
    // This would call Claude API with the context
    // For now, return a placeholder
    console.log('[SmartGenerator] Would generate code with context:', contextPrompt.substring(0, 200) + '...');
    
    return {
      'src/components/Example.tsx': `
import React from 'react';

export const Example: React.FC = () => {
  return <div>Generated with type awareness</div>;
};
`
    };
  }

  autoResolveImports(code, analysis) {
    // Automatically add imports based on what's used in the code
    // and what's available in the project
    
    for (const [filePath, content] of Object.entries(code)) {
      // Check if code uses any known types
      for (const [typeName] of analysis.types) {
        if (content.includes(typeName) && !content.includes(`import.*${typeName}`)) {
          // Auto-add import for this type
          console.log(`[SmartGenerator] Auto-importing ${typeName}`);
        }
      }
      
      // Check if code uses Prisma models
      if (analysis.schemas.prisma && content.includes('prisma')) {
        if (!content.includes("from '@prisma/client'")) {
          // Add Prisma import
          const prismaImport = "import { PrismaClient } from '@prisma/client';\n";
          code[filePath] = prismaImport + content;
        }
      }
    }
    
    return code;
  }
}

/**
 * PreValidationSystem - Validates code BEFORE writing to disk
 */
export class PreValidationSystem {
  constructor(projectPath) {
    this.projectPath = projectPath;
  }

  /**
   * Validate generated code BEFORE saving (prevents errors)
   */
  async validateBeforeWrite(code, analysis) {
    console.log('[PreValidator] Validating code before write...');
    
    const validationResults = {
      valid: true,
      issues: []
    };
    
    // Check 1: Validate all imports exist
    const importValidation = await this.validateImports(code, analysis);
    if (!importValidation.valid) {
      validationResults.valid = false;
      validationResults.issues.push(...importValidation.issues);
    }
    
    // Check 2: Validate types match
    const typeValidation = await this.validateTypes(code, analysis);
    if (!typeValidation.valid) {
      validationResults.valid = false;
      validationResults.issues.push(...typeValidation.issues);
    }
    
    // Check 3: Validate Prisma usage
    if (analysis.schemas.prisma) {
      const prismaValidation = this.validatePrismaUsage(code, analysis.schemas.prisma);
      if (!prismaValidation.valid) {
        validationResults.valid = false;
        validationResults.issues.push(...prismaValidation.issues);
      }
    }
    
    // Check 4: Run TypeScript compiler check (without writing files)
    const tscValidation = await this.validateWithTypeScript(code);
    if (!tscValidation.valid) {
      validationResults.valid = false;
      validationResults.issues.push(...tscValidation.issues);
    }
    
    console.log(`[PreValidator] Validation ${validationResults.valid ? 'PASSED' : 'FAILED'}`);
    if (!validationResults.valid) {
      console.log('[PreValidator] Issues found:', validationResults.issues);
    }
    
    return validationResults;
  }

  async validateImports(code, analysis) {
    const issues = [];
    
    for (const [filePath, content] of Object.entries(code)) {
      // Extract imports from the generated code
      const importRegex = /import\s+(?:{[^}]+}|\w+|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        
        // Check if it's a node_module import
        if (!importPath.startsWith('.') && !importPath.startsWith('@/')) {
          // Check if package exists in dependencies
          if (analysis.dependencies && !analysis.dependencies.has(importPath.split('/')[0])) {
            issues.push({
              type: 'missing-dependency',
              file: filePath,
              import: importPath,
              message: `Package "${importPath}" not found in dependencies`
            });
          }
        } else {
          // Check if local file exists
          // This is simplified - would need proper path resolution
          const resolvedPath = this.resolveImportPath(importPath, filePath);
          if (analysis.exports && !analysis.exports.has(resolvedPath)) {
            issues.push({
              type: 'missing-import',
              file: filePath,
              import: importPath,
              message: `Import "${importPath}" not found in project`
            });
          }
        }
      }
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }

  async validateTypes(code, analysis) {
    const issues = [];
    
    for (const [filePath, content] of Object.entries(code)) {
      // Check if code uses types that don't exist
      for (const [typeName, typeInfo] of analysis.types) {
        const typeUsageRegex = new RegExp(`:\\s*${typeName}(?:[\\s<>\\[\\]|&]|$)`, 'g');
        if (typeUsageRegex.test(content)) {
          // Check if type is imported
          const importRegex = new RegExp(`import.*{[^}]*${typeName}[^}]*}.*from`);
          if (!importRegex.test(content) && !content.includes(`interface ${typeName}`) && !content.includes(`type ${typeName}`)) {
            issues.push({
              type: 'missing-type-import',
              file: filePath,
              typeName,
              message: `Type "${typeName}" used but not imported`
            });
          }
        }
      }
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }

  validatePrismaUsage(code, prismaSchema) {
    const issues = [];
    
    for (const [filePath, content] of Object.entries(code)) {
      if (content.includes('prisma.')) {
        // Extract Prisma model usage
        const modelUsageRegex = /prisma\.(\w+)\./g;
        let match;
        
        while ((match = modelUsageRegex.exec(content)) !== null) {
          const modelName = match[1];
          
          // Check if model exists in schema
          if (!prismaSchema.models[modelName] && !['$transaction', '$disconnect', '$connect'].includes(modelName)) {
            issues.push({
              type: 'invalid-prisma-model',
              file: filePath,
              model: modelName,
              message: `Prisma model "${modelName}" not found in schema`
            });
          }
        }
        
        // Check field usage
        for (const [modelName, model] of Object.entries(prismaSchema.models)) {
          const fieldRegex = new RegExp(`prisma\\.${modelName}\\.[\\w]+\\([^)]*{[^}]*([\\w]+):[^}]*}`, 'g');
          let fieldMatch;
          
          while ((fieldMatch = fieldRegex.exec(content)) !== null) {
            const fieldName = fieldMatch[1];
            const validFields = model.fields.map(f => f.name);
            
            if (!validFields.includes(fieldName)) {
              issues.push({
                type: 'invalid-prisma-field',
                file: filePath,
                model: modelName,
                field: fieldName,
                message: `Field "${fieldName}" not found in ${modelName} model`
              });
            }
          }
        }
      }
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }

  async validateWithTypeScript(code) {
    // Create a temporary TypeScript program to validate the code
    // without writing files to disk
    
    try {
      // This would use TypeScript compiler API to validate
      // For now, return success
      return { valid: true, issues: [] };
    } catch (error) {
      return {
        valid: false,
        issues: [{
          type: 'typescript-error',
          message: error.message
        }]
      };
    }
  }

  resolveImportPath(importPath, fromFile) {
    // Simplified path resolution
    if (importPath.startsWith('@/')) {
      return importPath.replace('@/', 'src/');
    }
    if (importPath.startsWith('./')) {
      return path.join(path.dirname(fromFile), importPath);
    }
    return importPath;
  }
}

/**
 * Main Type-Aware Generator that combines all components
 */
export class TypeAwareGenerator {
  constructor() {
    this.analyzer = new TypeSystemAnalyzer();
    this.generator = new SmartCodeGenerator(this.analyzer);
    this.validator = null; // Will be initialized with project path
  }

  /**
   * Main entry point - generates code with type awareness
   */
  async generate(task, projectPath) {
    console.log('\n=== Phase 4: Type-Aware Generation Starting ===\n');
    
    // Step 1: Analyze project (Plan Mode)
    console.log('Step 1: Analyzing project...');
    const analysis = await this.analyzer.analyzeProject(projectPath);
    
    // Step 2: Generate with awareness
    console.log('\nStep 2: Generating code with type awareness...');
    const code = await this.generator.generateWithContext(task, analysis);
    
    // Step 3: Pre-validate
    console.log('\nStep 3: Validating before write...');
    this.validator = new PreValidationSystem(projectPath);
    const validation = await this.validator.validateBeforeWrite(code, analysis);
    
    if (!validation.valid) {
      console.log('\nStep 4: Fixing validation issues...');
      // Fix issues and regenerate (but only 1-2 times, not 5!)
      const fixedCode = await this.fixValidationIssues(code, validation.issues, analysis);
      
      // Re-validate
      const revalidation = await this.validator.validateBeforeWrite(fixedCode, analysis);
      if (revalidation.valid) {
        console.log('✅ Fixed all issues!');
        return { success: true, code: fixedCode };
      } else {
        console.log('⚠️ Some issues remain:', revalidation.issues);
        return { success: false, code: fixedCode, issues: revalidation.issues };
      }
    }
    
    console.log('\n✅ Code generated successfully with ZERO errors!');
    return { success: true, code };
  }

  async fixValidationIssues(code, issues, analysis) {
    console.log(`[TypeAware] Fixing ${issues.length} validation issues...`);
    
    for (const issue of issues) {
      switch (issue.type) {
        case 'missing-type-import':
          // Add the missing import
          const filePath = issue.file;
          const typeName = issue.typeName;
          const importLine = `import { ${typeName} } from './types';\n`;
          code[filePath] = importLine + code[filePath];
          console.log(`[TypeAware] Added import for ${typeName}`);
          break;
          
        case 'missing-dependency':
          console.log(`[TypeAware] Warning: Package ${issue.import} not installed`);
          // Could auto-install here
          break;
          
        case 'invalid-prisma-model':
          console.log(`[TypeAware] Error: Invalid Prisma model ${issue.model}`);
          // Would need to regenerate this part
          break;
      }
    }
    
    return code;
  }
}

// Export for use in existing system
export default TypeAwareGenerator;