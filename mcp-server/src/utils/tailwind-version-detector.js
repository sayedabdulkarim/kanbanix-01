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
      
      // Check if PostCSS config already exists and is correct
      const existingConfigs = ['postcss.config.js', 'postcss.config.mjs', 'postcss.config.ts'];
      let existingConfigFile = null;
      let existingConfigContent = null;
      
      for (const file of existingConfigs) {
        const filePath = path.join(projectPath, file);
        try {
          existingConfigContent = await fs.readFile(filePath, 'utf-8');
          existingConfigFile = file;
          console.log(`Found existing PostCSS config: ${file}`);
          break;
        } catch (err) {
          // File doesn't exist, continue checking
        }
      }
      
      // If we have an existing config and it contains @tailwindcss/postcss, it's v4 and correct
      if (existingConfigContent && existingConfigContent.includes('@tailwindcss/postcss')) {
        console.log('Existing PostCSS config is already configured for Tailwind v4, keeping it');
        return {
          version: 4,
          configCreated: false,
          requiredPackages: ['@tailwindcss/postcss'],
          postcssConfig: existingConfigContent
        };
      }
      
      // Only clean up existing configs if we're forcing recreation
      if (forceRecreate && existingConfigFile) {
        const filePath = path.join(projectPath, existingConfigFile);
        try {
          await fs.unlink(filePath);
          console.log(`Removed existing ${existingConfigFile} for recreation`);
        } catch (err) {
          // File doesn't exist, which is fine
        }
      }
      
      // Check package.json to determine Tailwind version
      let tailwindVersion = 3; // Default to v3
      try {
        const packageJsonPath = path.join(projectPath, 'package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        
        // First check for @tailwindcss/postcss - definitive sign of v4
        const hasTailwindPostCSS = packageJson.dependencies?.['@tailwindcss/postcss'] || 
                                   packageJson.devDependencies?.['@tailwindcss/postcss'];
        
        if (hasTailwindPostCSS) {
          tailwindVersion = 4;
          console.log('Detected Tailwind CSS v4 (found @tailwindcss/postcss package)');
        } else {
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
              const versionMatch = tailwindDep.match(/[~^]?(\d+)\./);
              if (versionMatch) {
                tailwindVersion = parseInt(versionMatch[1]);
                console.log(`Detected Tailwind CSS v${tailwindVersion} from package.json`);
              }
              
              // Special check for v4 versions
              if (tailwindDep.includes('^4') || tailwindDep.includes('~4') || tailwindDep.match(/^4\./)) {
                tailwindVersion = 4;
                console.log('Detected Tailwind CSS v4 from version string');
              }
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