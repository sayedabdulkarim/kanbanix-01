import fs from 'fs/promises';
import path from 'path';

class TailwindVersionDetector {
  /**
   * Detect Tailwind version and configure PostCSS appropriately
   * Based on SynthAI's implementation
   */
  async detectAndConfigurePostCSS(projectPath, forceRecreate = false) {
    try {
      console.log('Detecting Tailwind CSS version...');
      
      // Only clean up existing configs if we're forcing recreation
      if (forceRecreate) {
        const configFiles = ['postcss.config.js', 'postcss.config.mjs', 'postcss.config.ts'];
        for (const file of configFiles) {
          const filePath = path.join(projectPath, file);
          try {
            await fs.unlink(filePath);
            console.log(`Removed existing ${file}`);
          } catch (err) {
            // File doesn't exist, which is fine
          }
        }
      }
      
      // Check package.json to determine Tailwind version
      let tailwindVersion = 3; // Default to v3
      try {
        const packageJsonPath = path.join(projectPath, 'package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        
        // Check actual installed version in node_modules if available
        try {
          const tailwindPackagePath = path.join(projectPath, 'node_modules', 'tailwindcss', 'package.json');
          const tailwindPackage = JSON.parse(await fs.readFile(tailwindPackagePath, 'utf-8'));
          const installedVersion = tailwindPackage.version;
          tailwindVersion = parseInt(installedVersion.split('.')[0]);
          
          console.log(`Detected installed Tailwind CSS v${installedVersion}`);
        } catch (e) {
          // If can't read from node_modules, check package.json dependency
          const tailwindDep = packageJson.dependencies?.tailwindcss || packageJson.devDependencies?.tailwindcss;
          if (tailwindDep) {
            // Parse version from dependency string
            // Handle cases like "^4.0.0", "~3.4.0", "4.x", "4.0.0-alpha.30", etc.
            const versionMatch = tailwindDep.match(/[~^]?(\d+)\./);
            if (versionMatch) {
              tailwindVersion = parseInt(versionMatch[1]);
              console.log(`Detected Tailwind CSS v${tailwindVersion} from package.json`);
            }
            
            // Special check for v4 alpha/beta versions
            if (tailwindDep.includes('4.0.0-alpha') || tailwindDep.includes('4.0.0-beta')) {
              tailwindVersion = 4;
              console.log('Detected Tailwind CSS v4 (alpha/beta)');
            }
          }
        }
      } catch (e) {
        console.log('Could not determine Tailwind version, defaulting to v3');
        tailwindVersion = 3;
      }
      
      // Generate appropriate PostCSS config based on Tailwind version
      let postcssConfig;
      let requiredPackages = [];
      
      if (tailwindVersion >= 4) {
        // Tailwind v4 requires @tailwindcss/postcss
        console.log('Configuring PostCSS for Tailwind v4...');
        postcssConfig = `/** @type {import('postcss-load-config').Config} */
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`;
        requiredPackages = ['@tailwindcss/postcss'];
      } else {
        // Tailwind v3 and below use the old format
        console.log('Configuring PostCSS for Tailwind v3...');
        postcssConfig = `/** @type {import('postcss-load-config').Config} */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
        requiredPackages = ['postcss', 'autoprefixer'];
      }
      
      // Write the config
      const configPath = path.join(projectPath, 'postcss.config.js');
      await fs.writeFile(configPath, postcssConfig, 'utf-8');
      console.log(`Created PostCSS config for Tailwind v${tailwindVersion}`);
      
      // Return version info and required packages
      return {
        version: tailwindVersion,
        configCreated: true,
        requiredPackages: requiredPackages,
        postcssConfig: postcssConfig
      };
      
    } catch (err) {
      console.error('Error creating PostCSS config:', err);
      // Return safe defaults
      return {
        version: 3,
        configCreated: false,
        requiredPackages: ['postcss', 'autoprefixer'],
        error: err.message
      };
    }
  }
  
  /**
   * Check if project uses Tailwind CSS
   */
  async checkIfUsesTailwind(projectPath) {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      
      const hasTailwind = !!(
        packageJson.dependencies?.tailwindcss || 
        packageJson.devDependencies?.tailwindcss
      );
      
      return hasTailwind;
    } catch (e) {
      return false;
    }
  }
  
  /**
   * Get appropriate Tailwind config based on version
   */
  getTailwindConfig(version) {
    if (version >= 4) {
      // Tailwind v4 uses CSS-based configuration
      return `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}`;
    } else {
      // Tailwind v3 config
      return `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}`;
    }
  }
}

export default TailwindVersionDetector;