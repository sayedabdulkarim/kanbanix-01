const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);

class LocalProjectValidator {
  constructor() {
    this.validationResults = {
      packageManager: null,
      tailwindVersion: null,
      hasConflicts: false,
      errors: [],
      fixes: []
    };
  }

  /**
   * Main validation method - runs all checks locally
   */
  async validateProject(projectPath, socket = null) {
    console.log(`Starting local validation for project: ${projectPath}`);
    
    try {
      // 1. Check package manager conflicts
      await this.checkPackageManager(projectPath, socket);
      
      // 2. Check Tailwind CSS version
      await this.checkTailwindVersion(projectPath, socket);
      
      // 3. Check PostCSS configuration
      await this.checkPostCSSConfig(projectPath, socket);
      
      // 4. Check for common build issues
      await this.checkBuildIssues(projectPath, socket);
      
      // 5. Apply fixes if needed
      if (this.validationResults.fixes.length > 0) {
        await this.applyFixes(projectPath, socket);
      }
      
      return {
        success: this.validationResults.errors.length === 0,
        results: this.validationResults
      };
      
    } catch (error) {
      console.error('Local validation error:', error);
      this.validationResults.errors.push(`Validation error: ${error.message}`);
      return {
        success: false,
        results: this.validationResults
      };
    }
  }

  /**
   * Check for package manager conflicts
   */
  async checkPackageManager(projectPath, socket) {
    let hasYarnLock = false;
    let hasPackageLock = false;
    
    try {
      await fs.access(path.join(projectPath, 'yarn.lock'));
      hasYarnLock = true;
    } catch {
      // yarn.lock doesn't exist
    }
    
    try {
      await fs.access(path.join(projectPath, 'package-lock.json'));
      hasPackageLock = true;
    } catch {
      // package-lock.json doesn't exist
    }
    
    if (hasYarnLock && hasPackageLock) {
      this.validationResults.hasConflicts = true;
      this.validationResults.errors.push('Both yarn.lock and package-lock.json found');
      this.validationResults.fixes.push({
        type: 'remove-package-lock',
        description: 'Remove package-lock.json to avoid conflicts'
      });
      this.validationResults.packageManager = 'yarn';
    } else if (hasYarnLock) {
      this.validationResults.packageManager = 'yarn';
    } else {
      this.validationResults.packageManager = 'npm';
    }
    
    if (socket) {
      socket.emit("output", `> Package manager: ${this.validationResults.packageManager}\n`);
    }
  }

  /**
   * Check Tailwind CSS version
   */
  async checkTailwindVersion(projectPath, socket) {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      const tailwindVersion = 
        packageJson.dependencies?.tailwindcss || 
        packageJson.devDependencies?.tailwindcss;
      
      if (!tailwindVersion) {
        this.validationResults.errors.push('Tailwind CSS not found in dependencies');
        this.validationResults.fixes.push({
          type: 'install-tailwind-v3',
          description: 'Install Tailwind CSS v3'
        });
        return;
      }
      
      this.validationResults.tailwindVersion = tailwindVersion;
      
      // Check if it's v4 (4.x.x)
      if (tailwindVersion.includes('4.') || tailwindVersion.includes('^4.') || tailwindVersion.includes('~4.')) {
        this.validationResults.errors.push(`Tailwind CSS v4 detected (${tailwindVersion})`);
        this.validationResults.fixes.push({
          type: 'downgrade-tailwind',
          description: 'Downgrade Tailwind CSS from v4 to v3'
        });
      }
      
      if (socket) {
        socket.emit("output", `> Tailwind CSS version: ${tailwindVersion}\n`);
      }
      
    } catch (error) {
      this.validationResults.errors.push(`Failed to check Tailwind version: ${error.message}`);
    }
  }

  /**
   * Check PostCSS configuration
   */
  async checkPostCSSConfig(projectPath, socket) {
    const possibleConfigs = [
      'postcss.config.js',
      'postcss.config.mjs',
      'postcss.config.cjs',
      '.postcssrc.js',
      '.postcssrc.json'
    ];
    
    let foundConfigs = [];
    
    for (const config of possibleConfigs) {
      try {
        await fs.access(path.join(projectPath, config));
        foundConfigs.push(config);
      } catch {
        // Config doesn't exist
      }
    }
    
    if (foundConfigs.length === 0) {
      this.validationResults.errors.push('No PostCSS configuration found');
      this.validationResults.fixes.push({
        type: 'create-postcss-config',
        description: 'Create PostCSS configuration for Tailwind v3'
      });
    } else if (foundConfigs.length > 1) {
      this.validationResults.errors.push(`Multiple PostCSS configs found: ${foundConfigs.join(', ')}`);
      this.validationResults.fixes.push({
        type: 'consolidate-postcss-config',
        description: 'Remove duplicate PostCSS configurations'
      });
    }
    
    if (socket) {
      socket.emit("output", `> PostCSS configs found: ${foundConfigs.length > 0 ? foundConfigs.join(', ') : 'none'}\n`);
    }
  }

  /**
   * Check for common build issues
   */
  async checkBuildIssues(projectPath, socket) {
    try {
      // Check if globals.css exists and has proper Tailwind directives
      const globalsCssPath = path.join(projectPath, 'src/app/globals.css');
      const globalsCss = await fs.readFile(globalsCssPath, 'utf8');
      
      // Check for Tailwind v3 or v4 syntax
      const hasTailwindV3 = globalsCss.includes('@tailwind base') || 
                            globalsCss.includes('@tailwind components') || 
                            globalsCss.includes('@tailwind utilities');
      const hasTailwindV4 = globalsCss.includes('@import "tailwindcss"') || 
                            globalsCss.includes("@import 'tailwindcss'");
      
      // If neither v3 nor v4 syntax is found, it's an error
      if (!hasTailwindV3 && !hasTailwindV4) {
        this.validationResults.errors.push(`Missing Tailwind configuration in globals.css`);
        this.validationResults.fixes.push({
          type: 'add-tailwind-directives',
          description: 'Add Tailwind configuration to globals.css'
        });
      }
      
    } catch (error) {
      // globals.css might not exist or be in a different location
      console.log('Could not check globals.css:', error.message);
    }
  }

  /**
   * Apply fixes to the project
   */
  async applyFixes(projectPath, socket) {
    if (socket) {
      socket.emit("output", `\n> Applying ${this.validationResults.fixes.length} fixes...\n`);
    }
    
    for (const fix of this.validationResults.fixes) {
      try {
        switch (fix.type) {
          case 'remove-package-lock':
            await fs.unlink(path.join(projectPath, 'package-lock.json'));
            if (socket) {
              socket.emit("output", `> ✓ Removed package-lock.json\n`);
            }
            break;
            
          case 'downgrade-tailwind':
            await this.downgradeTailwind(projectPath, socket);
            break;
            
          case 'install-tailwind-v3':
            await this.installTailwindV3(projectPath, socket);
            break;
            
          case 'create-postcss-config':
            await this.createPostCSSConfig(projectPath, socket);
            break;
            
          case 'consolidate-postcss-config':
            await this.consolidatePostCSSConfig(projectPath, socket);
            break;
            
          case 'add-tailwind-directives':
            await this.addTailwindDirectives(projectPath, socket);
            break;
        }
      } catch (error) {
        console.error(`Failed to apply fix ${fix.type}:`, error);
        if (socket) {
          socket.emit("output", `> ✗ Failed to apply fix: ${fix.description}\n`);
        }
      }
    }
  }

  /**
   * Downgrade Tailwind from v4 to v3
   */
  async downgradeTailwind(projectPath, socket) {
    const pm = this.validationResults.packageManager;
    const uninstallCmd = pm === 'yarn' ? ['remove'] : ['uninstall'];
    const installCmd = pm === 'yarn' ? ['add', '--dev'] : ['install', '--save-dev'];
    
    // Uninstall v4
    await this.runCommand(pm, [...uninstallCmd, 'tailwindcss', '@tailwindcss/postcss'], projectPath);
    
    // Install v3
    await this.runCommand(
      pm, 
      [...installCmd, 'tailwindcss@3.4.1', 'postcss@8.4.33', 'autoprefixer@10.4.17'], 
      projectPath
    );
    
    if (socket) {
      socket.emit("output", `> ✓ Downgraded Tailwind CSS to v3\n`);
    }
  }

  /**
   * Install Tailwind CSS v3
   */
  async installTailwindV3(projectPath, socket) {
    const pm = this.validationResults.packageManager;
    const installCmd = pm === 'yarn' ? ['add', '--dev'] : ['install', '--save-dev'];
    
    await this.runCommand(
      pm, 
      [...installCmd, 'tailwindcss@3.4.1', 'postcss@8.4.33', 'autoprefixer@10.4.17'], 
      projectPath
    );
    
    if (socket) {
      socket.emit("output", `> ✓ Installed Tailwind CSS v3\n`);
    }
  }

  /**
   * Create PostCSS configuration
   */
  async createPostCSSConfig(projectPath, socket) {
    const config = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`;
    await fs.writeFile(path.join(projectPath, 'postcss.config.js'), config);
    
    if (socket) {
      socket.emit("output", `> ✓ Created PostCSS configuration\n`);
    }
  }

  /**
   * Remove duplicate PostCSS configs
   */
  async consolidatePostCSSConfig(projectPath, socket) {
    const configsToRemove = [
      'postcss.config.mjs',
      'postcss.config.cjs',
      '.postcssrc.js',
      '.postcssrc.json'
    ];
    
    for (const config of configsToRemove) {
      try {
        await fs.unlink(path.join(projectPath, config));
        if (socket) {
          socket.emit("output", `> ✓ Removed ${config}\n`);
        }
      } catch {
        // File doesn't exist, skip
      }
    }
    
    // Ensure postcss.config.js exists
    await this.createPostCSSConfig(projectPath, socket);
  }

  /**
   * Add Tailwind directives to globals.css
   */
  async addTailwindDirectives(projectPath, socket) {
    // CRITICAL: Skip this fix - globals.css should not be modified
    // The boilerplate already creates the correct configuration
    if (socket) {
      socket.emit("output", `> ⚠ Skipping globals.css modification (preserving boilerplate configuration)\n`);
    }
    return;
  }

  /**
   * Run a command and wait for completion
   */
  async runCommand(command, args, cwd) {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, { cwd, shell: true });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });
      
      process.on('error', reject);
    });
  }
}

module.exports = { LocalProjectValidator };