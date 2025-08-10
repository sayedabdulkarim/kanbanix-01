const fs = require('fs/promises');
const path = require('path');

class QuickFixChecker {
  /**
   * Apply quick fixes for common errors before using LLM
   */
  async applyQuickFixes(buildOutput, projectPath, socket) {
    const fixes = [];
    
    // Check for next.config.ts error
    if (buildOutput.includes("next.config.ts' is not supported")) {
      const ConfigFileFixer = require('./config-file-fixer');
      const configFixer = new ConfigFileFixer();
      const configFixes = await configFixer.fixConfigFiles(projectPath, socket);
      if (configFixes.length > 0) {
        fixes.push(...configFixes.map(f => ({ type: 'config', file: f, fixed: true })));
      }
    }
    
    // Check for 'use client' errors
    if (buildOutput.includes("use client") || 
        buildOutput.includes("Client Component") ||
        buildOutput.includes("This React Hook only works in a Client Component")) {
      const useClientFixes = await this.fixUseClientErrors(buildOutput, projectPath, socket);
      fixes.push(...useClientFixes);
    }
    
    // Check for Tailwind PostCSS error
    if (buildOutput.includes('tailwindcss` directly as a PostCSS plugin') ||
        buildOutput.includes('@tailwindcss/postcss') ||
        buildOutput.includes('Cannot apply unknown utility class') ||
        buildOutput.includes('PostCSS plugin') ||
        (buildOutput.includes('tailwind') && buildOutput.includes('postcss'))) {
      const TailwindVersionDetector = require('./tailwind-version-detector');
      const detector = new TailwindVersionDetector();
      await detector.detectAndConfigurePostCSS(projectPath, socket);
      fixes.push({ type: 'postcss', file: 'postcss.config.js', fixed: true });
    }
    
    // Check for Context export errors
    if (buildOutput.includes('has no exported member') && buildOutput.includes('Context')) {
      const contextFixes = await this.fixContextExportErrors(buildOutput, projectPath, socket);
      fixes.push(...contextFixes);
    }
    
    if (socket && fixes.length > 0) {
      socket.emit('output', `\x1b[32m✓ Applied ${fixes.length} quick fixes\x1b[0m\n`);
    }
    
    return fixes;
  }
  
  /**
   * Fix missing 'use client' directives
   */
  async fixUseClientErrors(buildOutput, projectPath, socket) {
    const fixes = [];
    const processedFiles = new Set();
    
    console.log('=== USE CLIENT ERROR DETECTION ===');
    console.log('Build output snippet:', buildOutput.substring(0, 500));
    
    // Extract file paths from error output using multiple strategies
    const filePaths = this.extractFilePathsFromError(buildOutput);
    
    console.log('Extracted file paths:', filePaths);
    
    for (const filePath of filePaths) {
      if (!processedFiles.has(filePath)) {
        processedFiles.add(filePath);
        
        try {
          const fullPath = path.join(projectPath, filePath);
          console.log(`Processing file: ${fullPath}`);
          
          const content = await fs.readFile(fullPath, 'utf-8');
          
          // Check if file needs 'use client'
          const needsUseClient = this.checkIfNeedsUseClient(content);
          const hasUseClient = this.checkIfHasUseClient(content);
          
          console.log(`File ${filePath}: needsUseClient=${needsUseClient}, hasUseClient=${hasUseClient}`);
          
          if (needsUseClient && !hasUseClient) {
            console.log(`Adding 'use client' to ${filePath}`);
            
            const success = await this.addUseClientDirective(fullPath, content);
            
            if (success) {
              fixes.push({
                file: filePath,
                type: 'use_client',
                fixed: true
              });
              
              if (socket) {
                socket.emit('output', `  ✓ Added 'use client' to ${filePath}\n`);
              }
              
              console.log(`Successfully added 'use client' to ${filePath}`);
            } else {
              console.error(`Failed to add 'use client' to ${filePath}`);
            }
          }
        } catch (err) {
          console.error(`Error processing ${filePath}:`, err);
        }
      }
    }
    
    return fixes;
  }
  
  /**
   * Extract file paths from error output using multiple patterns
   */
  extractFilePathsFromError(buildOutput) {
    const filePaths = new Set();
    
    // Pattern 1: ./src/components/file.tsx format
    const pattern1 = /\.\/?(src\/[^\s:]+\.(?:tsx?|jsx?))/g;
    let match;
    while ((match = pattern1.exec(buildOutput)) !== null) {
      filePaths.add(match[1]);
    }
    
    // Pattern 2: ,-[path] format
    const pattern2 = /,-\[[^\]]*\/(src\/[^:]+\.(?:tsx?|jsx?))/g;
    while ((match = pattern2.exec(buildOutput)) !== null) {
      filePaths.add(match[1]);
    }
    
    // Pattern 3: Direct file mentions
    const pattern3 = /([^\/\s]+\/(src\/[^\s:]+\.(?:tsx?|jsx?)))/g;
    while ((match = pattern3.exec(buildOutput)) !== null) {
      filePaths.add(match[2]);
    }
    
    return Array.from(filePaths);
  }
  
  /**
   * Check if file content needs 'use client' directive
   */
  checkIfNeedsUseClient(content) {
    // Check for React hooks
    const hasHooks = /\b(useState|useEffect|useContext|useReducer|useCallback|useMemo|useRef|useImperativeHandle|useLayoutEffect|useDebugValue)\b/.test(content);
    
    // Check for event handlers
    const hasEventHandlers = /\b(onClick|onChange|onSubmit|onFocus|onBlur|onKeyDown|onKeyUp|onMouseOver|onMouseOut)\b/.test(content);
    
    // Check for browser APIs
    const hasBrowserAPIs = /\b(window|document|localStorage|sessionStorage|navigator)\b/.test(content);
    
    return hasHooks || hasEventHandlers || hasBrowserAPIs;
  }
  
  /**
   * Check if file already has 'use client' directive
   */
  checkIfHasUseClient(content) {
    const lines = content.split('\n');
    
    // Check first 10 lines for 'use client'
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i].trim();
      if (line === "'use client';" || 
          line === '"use client";' || 
          line === "'use client'" || 
          line === '"use client"') {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Add 'use client' directive to a file
   */
  async addUseClientDirective(fullPath, content) {
    try {
      // Add 'use client' at the very beginning
      const newContent = `'use client';\n\n${content}`;
      
      // Write the file
      await fs.writeFile(fullPath, newContent, 'utf-8');
      
      // Verify it was written correctly
      const verifyContent = await fs.readFile(fullPath, 'utf-8');
      const firstLine = verifyContent.split('\n')[0].trim();
      
      if (firstLine === "'use client';") {
        console.log(`Verified 'use client' was added successfully`);
        return true;
      } else {
        console.error(`Verification failed. First line is: "${firstLine}"`);
        return false;
      }
    } catch (err) {
      console.error(`Error adding 'use client':`, err);
      return false;
    }
  }
  
  /**
   * Fix Context export errors
   */
  async fixContextExportErrors(buildOutput, projectPath, socket) {
    const fixes = [];
    const ContextPatternFixer = require('./context-pattern-fixer');
    const contextFixer = new ContextPatternFixer();
    
    try {
      // Read all project files
      const files = {};
      async function readDir(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await readDir(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
            const relativePath = path.relative(projectPath, fullPath);
            files[relativePath] = await fs.readFile(fullPath, 'utf-8');
          }
        }
      }
      
      await readDir(path.join(projectPath, 'src'));
      
      // Extract errors from build output
      const errors = buildOutput.split('\n').filter(line => 
        line.includes('has no exported member') && line.includes('Context')
      );
      
      // Fix context exports
      const { files: fixedFiles, fixes: contextFixes } = contextFixer.fixContextExports(files, errors);
      
      // Write fixed files back
      for (const [filePath, content] of Object.entries(fixedFiles)) {
        if (content !== files[filePath]) {
          const fullPath = path.join(projectPath, filePath);
          await fs.writeFile(fullPath, content, 'utf-8');
          fixes.push({
            file: filePath,
            type: 'context_export',
            fixed: true
          });
        }
      }
      
      // Also ensure all context files are complete
      const completeFiles = contextFixer.ensureCompleteContext(fixedFiles);
      for (const [filePath, content] of Object.entries(completeFiles)) {
        if (content !== fixedFiles[filePath]) {
          const fullPath = path.join(projectPath, filePath);
          await fs.writeFile(fullPath, content, 'utf-8');
          fixes.push({
            file: filePath,
            type: 'context_complete',
            fixed: true
          });
        }
      }
      
      if (socket && fixes.length > 0) {
        socket.emit('output', `  ✓ Fixed ${fixes.length} context export issues\n`);
      }
      
    } catch (err) {
      console.error('Error fixing context exports:', err);
    }
    
    return fixes;
  }
}

module.exports = QuickFixChecker;