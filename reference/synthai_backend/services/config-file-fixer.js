const fs = require('fs/promises');
const path = require('path');

class ConfigFileFixer {
  /**
   * Fix Next.js config file issues
   */
  async fixConfigFiles(projectPath, socket) {
    const fixes = [];
    
    // Check for next.config.ts (not supported)
    const tsConfigPath = path.join(projectPath, 'next.config.ts');
    const jsConfigPath = path.join(projectPath, 'next.config.js');
    const mjsConfigPath = path.join(projectPath, 'next.config.mjs');
    
    try {
      await fs.access(tsConfigPath);
      
      if (socket) {
        socket.emit('output', '  ⚠ Found next.config.ts (not supported by Next.js)\n');
      }
      
      // Read the content
      const content = await fs.readFile(tsConfigPath, 'utf-8');
      
      // Convert TypeScript to JavaScript
      let jsContent = content
        // Remove type imports
        .replace(/import\s+type\s*{[^}]+}\s*from\s*['"][^'"]+['"];?\s*\n?/g, '')
        // Remove type annotations
        .replace(/:\s*NextConfig/g, '')
        // Convert export
        .replace(/export\s+default/, 'module.exports =')
        // Remove const with type annotation
        .replace(/const\s+(\w+)\s*:\s*\w+\s*=/, 'const $1 =');
      
      // If it's a simple config, create a basic one
      if (!jsContent.includes('module.exports')) {
        jsContent = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

module.exports = nextConfig
`;
      }
      
      // Write as .js file
      await fs.writeFile(jsConfigPath, jsContent, 'utf-8');
      
      // Remove the .ts file
      await fs.unlink(tsConfigPath);
      
      if (socket) {
        socket.emit('output', '  ✓ Converted next.config.ts to next.config.js\n');
      }
      
      fixes.push('next.config');
    } catch (err) {
      // No next.config.ts found, check if we need to create a config
      try {
        await fs.access(jsConfigPath);
      } catch {
        try {
          await fs.access(mjsConfigPath);
        } catch {
          // No config file exists, create a simple one
          const defaultConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

module.exports = nextConfig
`;
          await fs.writeFile(jsConfigPath, defaultConfig, 'utf-8');
          
          if (socket) {
            socket.emit('output', '  ✓ Created next.config.js\n');
          }
          
          fixes.push('next.config');
        }
      }
    }
    
    return fixes;
  }
  
  /**
   * Ensure tsconfig.json is properly configured
   */
  async fixTypeScriptConfig(projectPath, socket) {
    const tsconfigPath = path.join(projectPath, 'tsconfig.json');
    
    try {
      const content = await fs.readFile(tsconfigPath, 'utf-8');
      const tsconfig = JSON.parse(content);
      
      // Ensure it doesn't have problematic settings
      if (!tsconfig.compilerOptions) {
        tsconfig.compilerOptions = {};
      }
      
      // Ensure proper settings for Next.js
      tsconfig.compilerOptions = {
        ...tsconfig.compilerOptions,
        target: 'es5',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        forceConsistentCasingInFileNames: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'node',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [
          {
            name: 'next'
          }
        ],
        paths: {
          '@/*': ['./src/*']
        }
      };
      
      // Ensure proper include/exclude
      tsconfig.include = ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'];
      tsconfig.exclude = ['node_modules'];
      
      await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf-8');
      
      return true;
    } catch (err) {
      // Create default tsconfig if missing
      const defaultTsConfig = {
        compilerOptions: {
          target: 'es5',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          forceConsistentCasingInFileNames: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'node',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          plugins: [
            {
              name: 'next'
            }
          ],
          paths: {
            '@/*': ['./src/*']
          }
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules']
      };
      
      await fs.writeFile(tsconfigPath, JSON.stringify(defaultTsConfig, null, 2), 'utf-8');
      
      if (socket) {
        socket.emit('output', '  ✓ Created tsconfig.json\n');
      }
      
      return true;
    }
  }
}

module.exports = ConfigFileFixer;