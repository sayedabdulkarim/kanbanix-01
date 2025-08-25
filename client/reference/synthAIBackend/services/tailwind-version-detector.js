const fs = require('fs/promises');
const path = require('path');

class TailwindVersionDetector {
  /**
   * Always use stable Tailwind v3 configuration to avoid issues
   */
  async detectAndConfigurePostCSS(projectPath, socket) {
    try {
      if (socket) {
        socket.emit('output', `  ℹ Using Tailwind CSS v3 configuration (stable)\n`);
      }
      
      // Clean up any existing PostCSS config files to avoid conflicts
      const configFiles = ['postcss.config.js', 'postcss.config.mjs', 'postcss.config.ts'];
      for (const file of configFiles) {
        const filePath = path.join(projectPath, file);
        try {
          await fs.unlink(filePath);
          if (socket) {
            socket.emit('output', `  ✓ Removed existing ${file}\n`);
          }
        } catch (err) {
          // File doesn't exist, which is fine
        }
      }
      
      // Check package.json to determine Tailwind version
      // Default to v3 since v4 is not stable yet
      let tailwindVersion = 3;
      try {
        const packageJsonPath = path.join(projectPath, 'package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        
        // Check actual installed version in node_modules if available
        try {
          const tailwindPackagePath = path.join(projectPath, 'node_modules', 'tailwindcss', 'package.json');
          const tailwindPackage = JSON.parse(await fs.readFile(tailwindPackagePath, 'utf-8'));
          const installedVersion = tailwindPackage.version;
          tailwindVersion = parseInt(installedVersion.split('.')[0]);
          
          if (socket) {
            socket.emit('output', `  ℹ Detected Tailwind CSS v${installedVersion}\n`);
          }
        } catch (e) {
          // If can't read from node_modules, check package.json dependency
          const tailwindDep = packageJson.dependencies?.tailwindcss || packageJson.devDependencies?.tailwindcss;
          if (tailwindDep) {
            // Parse version more carefully
            // Handle cases like "^3.0.0", "~3.4.0", "3.x", etc.
            const versionMatch = tailwindDep.match(/[~^]?(\d+)\./);
            if (versionMatch) {
              tailwindVersion = parseInt(versionMatch[1]);
            }
          }
        }
      } catch (e) {
        // Default to v3 if can't determine
        tailwindVersion = 3;
      }
      
      // Keep the detected version (no longer forcing v3)
      if (tailwindVersion >= 4 && socket) {
        socket.emit('output', `  ℹ Tailwind CSS v${tailwindVersion} detected\n`);
      }
      
      // Generate appropriate PostCSS config based on Tailwind version
      let postcssConfig;
      if (tailwindVersion >= 4) {
        // Tailwind v4 requires @tailwindcss/postcss
        postcssConfig = `/** @type {import('postcss-load-config').Config} */
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`;
      } else {
        // Tailwind v3 and below use the old format
        postcssConfig = `/** @type {import('postcss-load-config').Config} */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
      }
      
      // Write the config
      const configPath = path.join(projectPath, 'postcss.config.js');
      await fs.writeFile(configPath, postcssConfig, 'utf-8');
      
      if (socket) {
        socket.emit('output', `  ✓ Created PostCSS config for Tailwind v${tailwindVersion}\n`);
      }
      
      // Return appropriate packages based on version
      if (tailwindVersion >= 4) {
        return {
          version: `v${tailwindVersion}`,
          requiredPackages: ['@tailwindcss/postcss']
        };
      } else {
        return {
          version: `v${tailwindVersion}`,
          requiredPackages: ['autoprefixer']
        };
      }
      
    } catch (err) {
      console.error('Error creating PostCSS config:', err);
      return {
        version: 'v3',
        requiredPackages: ['autoprefixer']
      };
    }
  }
}

module.exports = TailwindVersionDetector;