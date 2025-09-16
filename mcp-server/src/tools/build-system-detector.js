import fs from 'fs/promises';
import path from 'path';

/**
 * Framework-agnostic build system detector
 * Detects build systems for any programming language/framework
 */
export class BuildSystemDetector {
  constructor() {
    // Build system configurations for different languages/frameworks
    this.buildSystems = {
      // JavaScript/TypeScript ecosystems
      'package.json': {
        language: 'javascript',
        buildTools: [
          { file: 'yarn.lock', command: 'yarn build', testCommand: 'yarn test' },
          { file: 'pnpm-lock.yaml', command: 'pnpm build', testCommand: 'pnpm test' },
          { file: 'package-lock.json', command: 'npm run build', testCommand: 'npm test' },
          { default: true, command: 'npm run build', testCommand: 'npm test' }
        ],
        frameworks: {
          'next.config': 'nextjs',
          'nuxt.config': 'nuxtjs',
          'vite.config': 'vite',
          'webpack.config': 'webpack',
          'angular.json': 'angular',
          '.angular': 'angular',
          'vue.config': 'vuejs',
          'svelte.config': 'svelte',
          'gatsby-config': 'gatsby',
          'remix.config': 'remix'
        }
      },
      
      // Python ecosystems
      'setup.py': {
        language: 'python',
        command: 'python setup.py build',
        testCommand: 'python -m pytest'
      },
      'pyproject.toml': {
        language: 'python',
        buildTools: [
          { file: 'poetry.lock', command: 'poetry build', testCommand: 'poetry run pytest' },
          { file: 'Pipfile.lock', command: 'pipenv run build', testCommand: 'pipenv run pytest' },
          { default: true, command: 'python -m build', testCommand: 'python -m pytest' }
        ],
        frameworks: {
          'manage.py': 'django',
          'flask': 'flask',
          'fastapi': 'fastapi',
          'streamlit': 'streamlit'
        }
      },
      'requirements.txt': {
        language: 'python',
        command: 'python -m py_compile .',
        testCommand: 'python -m pytest',
        frameworks: {
          'manage.py': 'django',
          'app.py': 'flask'
        }
      },
      
      // Java ecosystems
      'pom.xml': {
        language: 'java',
        command: 'mvn compile',
        testCommand: 'mvn test',
        framework: 'maven'
      },
      'build.gradle': {
        language: 'java',
        command: 'gradle build',
        testCommand: 'gradle test',
        framework: 'gradle'
      },
      'build.gradle.kts': {
        language: 'kotlin',
        command: 'gradle build',
        testCommand: 'gradle test',
        framework: 'gradle'
      },
      
      // Go
      'go.mod': {
        language: 'go',
        command: 'go build ./...',
        testCommand: 'go test ./...',
        framework: 'go'
      },
      
      // Rust
      'Cargo.toml': {
        language: 'rust',
        command: 'cargo build',
        testCommand: 'cargo test',
        framework: 'cargo'
      },
      
      // Ruby
      'Gemfile': {
        language: 'ruby',
        command: 'bundle exec rake build',
        testCommand: 'bundle exec rspec',
        frameworks: {
          'config.ru': 'rack',
          'rails': 'rails',
          'Rakefile': 'rake'
        }
      },
      
      // PHP
      'composer.json': {
        language: 'php',
        command: 'composer install --no-dev',
        testCommand: 'vendor/bin/phpunit',
        frameworks: {
          'artisan': 'laravel',
          'symfony': 'symfony',
          'wp-config': 'wordpress'
        }
      },
      
      // C# / .NET
      '*.csproj': {
        language: 'csharp',
        command: 'dotnet build',
        testCommand: 'dotnet test',
        framework: 'dotnet'
      },
      '*.sln': {
        language: 'csharp',
        command: 'dotnet build',
        testCommand: 'dotnet test',
        framework: 'dotnet'
      },
      
      // C/C++
      'Makefile': {
        language: 'c',
        command: 'make',
        testCommand: 'make test',
        framework: 'make'
      },
      'CMakeLists.txt': {
        language: 'cpp',
        command: 'cmake --build .',
        testCommand: 'ctest',
        framework: 'cmake'
      },
      
      // Swift
      'Package.swift': {
        language: 'swift',
        command: 'swift build',
        testCommand: 'swift test',
        framework: 'swift'
      },
      
      // Scala
      'build.sbt': {
        language: 'scala',
        command: 'sbt compile',
        testCommand: 'sbt test',
        framework: 'sbt'
      },
      
      // Elixir
      'mix.exs': {
        language: 'elixir',
        command: 'mix compile',
        testCommand: 'mix test',
        framework: 'mix'
      },
      
      // Clojure
      'project.clj': {
        language: 'clojure',
        command: 'lein compile',
        testCommand: 'lein test',
        framework: 'leiningen'
      },
      'deps.edn': {
        language: 'clojure',
        command: 'clj -M:build',
        testCommand: 'clj -M:test',
        framework: 'clojure-cli'
      }
    };
  }

  /**
   * Detect the build system for a given project path
   * @param {string} projectPath - Path to the project
   * @returns {Promise<Object>} Build system information
   */
  async detect(projectPath) {
    console.log(`[BuildSystemDetector] Analyzing project at: ${projectPath}`);
    
    try {
      // Check for each build system file
      for (const [pattern, config] of Object.entries(this.buildSystems)) {
        let found = false;
        let matchedFile = null;
        
        // Handle wildcard patterns
        if (pattern.includes('*')) {
          const files = await this.findFiles(projectPath, pattern);
          if (files.length > 0) {
            found = true;
            matchedFile = files[0];
          }
        } else {
          // Check if file exists
          const filePath = path.join(projectPath, pattern);
          try {
            await fs.access(filePath);
            found = true;
            matchedFile = pattern;
          } catch (e) {
            // File doesn't exist, continue
          }
        }
        
        if (found) {
          console.log(`[BuildSystemDetector] Found ${matchedFile}`);
          
          // Determine the specific build tool and framework
          const result = await this.resolveBuildConfig(projectPath, config, matchedFile);
          
          console.log(`[BuildSystemDetector] Detected: ${result.language} project using ${result.buildTool || result.framework}`);
          return result;
        }
      }
      
      // No known build system found - try to infer from file extensions
      const inference = await this.inferFromFiles(projectPath);
      if (inference) {
        console.log(`[BuildSystemDetector] Inferred: ${inference.language} project`);
        return inference;
      }
      
      console.log('[BuildSystemDetector] No build system detected');
      return {
        detected: false,
        language: 'unknown',
        command: null,
        testCommand: null
      };
      
    } catch (error) {
      console.error('[BuildSystemDetector] Error during detection:', error);
      return {
        detected: false,
        language: 'unknown',
        command: null,
        testCommand: null,
        error: error.message
      };
    }
  }

  /**
   * Resolve specific build configuration based on additional files
   */
  async resolveBuildConfig(projectPath, config, matchedFile) {
    let command = config.command;
    let testCommand = config.testCommand;
    let buildTool = null;
    let framework = config.framework;
    
    // Check for specific build tools (for configs with multiple options)
    if (config.buildTools) {
      for (const tool of config.buildTools) {
        if (tool.default) continue;
        
        const toolPath = path.join(projectPath, tool.file);
        try {
          await fs.access(toolPath);
          command = tool.command;
          testCommand = tool.testCommand;
          buildTool = tool.file;
          break;
        } catch (e) {
          // Tool file doesn't exist
        }
      }
      
      // Use default if no specific tool found
      if (!command && config.buildTools.find(t => t.default)) {
        const defaultTool = config.buildTools.find(t => t.default);
        command = defaultTool.command;
        testCommand = defaultTool.testCommand;
      }
    }
    
    // Detect framework
    if (config.frameworks) {
      for (const [indicator, fw] of Object.entries(config.frameworks)) {
        try {
          // Check if indicator file/directory exists
          const files = await fs.readdir(projectPath);
          if (files.some(f => f.includes(indicator))) {
            framework = fw;
            break;
          }
        } catch (e) {
          // Error reading directory
        }
      }
    }
    
    // Try to read package.json for scripts if it's a JS project
    if (matchedFile === 'package.json') {
      try {
        const packageJson = JSON.parse(
          await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
        );
        
        // Check for custom build scripts
        if (packageJson.scripts) {
          if (packageJson.scripts.build) {
            // Command already set correctly
          } else if (packageJson.scripts.compile) {
            command = command.replace('build', 'compile');
          } else if (packageJson.scripts.dev && !packageJson.scripts.build) {
            // Development only project
            command = command.replace('build', 'dev');
          }
        }
      } catch (e) {
        // Couldn't read package.json
      }
    }
    
    return {
      detected: true,
      language: config.language,
      command: command,
      testCommand: testCommand,
      buildTool: buildTool,
      framework: framework,
      configFile: matchedFile
    };
  }

  /**
   * Find files matching a pattern
   */
  async findFiles(projectPath, pattern) {
    const files = await fs.readdir(projectPath);
    const regex = new RegExp(pattern.replace('*', '.*'));
    return files.filter(f => regex.test(f));
  }

  /**
   * Infer language from file extensions when no build system is found
   */
  async inferFromFiles(projectPath) {
    const files = await fs.readdir(projectPath, { recursive: true, withFileTypes: true });
    const extensions = {};
    
    // Count file extensions
    for (const file of files) {
      if (file.isFile()) {
        const ext = path.extname(file.name);
        if (ext) {
          extensions[ext] = (extensions[ext] || 0) + 1;
        }
      }
    }
    
    // Map extensions to languages
    const languageMap = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.rb': 'ruby',
      '.php': 'php',
      '.cs': 'csharp',
      '.c': 'c',
      '.cpp': 'cpp',
      '.cc': 'cpp',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.ex': 'elixir',
      '.exs': 'elixir',
      '.clj': 'clojure'
    };
    
    // Find most common language
    let maxCount = 0;
    let detectedLang = null;
    
    for (const [ext, count] of Object.entries(extensions)) {
      if (languageMap[ext] && count > maxCount) {
        maxCount = count;
        detectedLang = languageMap[ext];
      }
    }
    
    if (detectedLang) {
      // Return basic commands for inferred language
      const basicCommands = {
        javascript: 'node .',
        typescript: 'tsc && node .',
        python: 'python .',
        java: 'javac *.java',
        go: 'go run .',
        rust: 'rustc main.rs',
        ruby: 'ruby main.rb',
        php: 'php index.php'
      };
      
      return {
        detected: true,
        language: detectedLang,
        command: basicCommands[detectedLang] || null,
        testCommand: null,
        inferred: true
      };
    }
    
    return null;
  }

  /**
   * Get the appropriate build command for a project
   * This can use AI to determine the command if needed
   */
  async getBuildCommand(projectPath, anthropic = null) {
    // First try detection
    const detected = await this.detect(projectPath);
    
    if (detected.command) {
      return detected;
    }
    
    // If no command found and AI available, ask AI
    if (anthropic && !detected.command) {
      console.log('[BuildSystemDetector] Using AI to determine build command...');
      
      try {
        const files = await fs.readdir(projectPath);
        const prompt = `Given these files in a project: ${files.slice(0, 20).join(', ')}
        
        What is the appropriate build command for this project?
        Return ONLY a JSON object with:
        {
          "command": "the build command",
          "language": "detected language",
          "framework": "detected framework if any"
        }`;
        
        const message = await anthropic.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 256,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }]
        });
        
        const response = JSON.parse(message.content[0].text);
        
        return {
          detected: true,
          language: response.language || 'unknown',
          command: response.command,
          framework: response.framework,
          aiGenerated: true
        };
      } catch (error) {
        console.error('[BuildSystemDetector] AI detection failed:', error);
      }
    }
    
    return detected;
  }
}

// Export singleton instance
export const buildSystemDetector = new BuildSystemDetector();