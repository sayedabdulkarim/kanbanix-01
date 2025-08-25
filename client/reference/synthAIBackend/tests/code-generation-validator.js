const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

/**
 * Local testing framework for validating generated code patterns
 * without calling LLM APIs
 */
class CodeGenerationValidator {
  constructor() {
    this.testResults = [];
    this.testTemplates = this.loadTestTemplates();
  }

  /**
   * Load predefined test templates for common app types
   */
  loadTestTemplates() {
    return {
      'counter': {
        files: [
          {
            path: 'src/components/Counter.tsx',
            requiredPatterns: [
              /^'use client'/,  // Must start with 'use client'
              /export default (function|const) Counter/,  // Default export
              /useState/,  // Uses hooks
            ],
            forbiddenPatterns: [
              /export \{ Counter \}/,  // No named export for components
            ]
          },
          {
            path: 'src/components/CounterButtons.tsx',
            requiredPatterns: [
              /^'use client'/,
              /export default/,
            ]
          }
        ],
        imports: [
          {
            file: 'src/app/page.tsx',
            pattern: /import Counter from ['"]\.\.\/components\/Counter['"]/,
            description: 'Should use default import for Counter'
          }
        ]
      },
      'todo': {
        files: [
          {
            path: 'src/components/TodoApp.tsx',
            requiredPatterns: [
              /^'use client'/,
              /export default/,
              /useState/,
            ]
          },
          {
            path: 'src/types/Task.ts',
            requiredPatterns: [
              /export (interface|type) Task/,
            ],
            forbiddenPatterns: [
              /export default/,  // Types should use named exports
            ]
          },
          {
            path: 'src/lib/dateUtils.ts',
            requiredPatterns: [
              /export function formatArchiveDate/,  // Must export this function
            ]
          }
        ],
        typeConsistency: {
          interface: 'Task',
          expectedShape: {
            id: 'string',
            title: 'string',
            completed: 'boolean',
            createdAt: 'Date | string'
          }
        }
      }
    };
  }

  /**
   * Validate a single file against patterns
   */
  async validateFile(filePath, patterns) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const results = {
        path: filePath,
        passed: [],
        failed: []
      };

      // Check required patterns
      for (const pattern of patterns.requiredPatterns || []) {
        if (pattern.test(content)) {
          results.passed.push(`✓ Contains ${pattern.toString()}`);
        } else {
          results.failed.push(`✗ Missing ${pattern.toString()}`);
        }
      }

      // Check forbidden patterns
      for (const pattern of patterns.forbiddenPatterns || []) {
        if (!pattern.test(content)) {
          results.passed.push(`✓ Does not contain ${pattern.toString()}`);
        } else {
          results.failed.push(`✗ Contains forbidden ${pattern.toString()}`);
        }
      }

      return results;
    } catch (error) {
      return {
        path: filePath,
        passed: [],
        failed: [`✗ File not found or error reading: ${error.message}`]
      };
    }
  }

  /**
   * Check import/export consistency
   */
  async validateImportExportConsistency(projectPath, template) {
    const results = [];
    
    for (const importCheck of template.imports || []) {
      const filePath = path.join(projectPath, importCheck.file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        if (importCheck.pattern.test(content)) {
          results.push({
            file: importCheck.file,
            status: 'passed',
            message: `✓ ${importCheck.description}`
          });
        } else {
          results.push({
            file: importCheck.file,
            status: 'failed',
            message: `✗ ${importCheck.description}`
          });
        }
      } catch (error) {
        results.push({
          file: importCheck.file,
          status: 'failed',
          message: `✗ Could not validate: ${error.message}`
        });
      }
    }
    
    return results;
  }

  /**
   * Run build test without generating code
   */
  async testBuildability(projectPath) {
    return new Promise((resolve) => {
      const buildProcess = spawn('npm', ['run', 'build'], {
        cwd: projectPath,
        env: { ...process.env }
      });

      let output = '';
      let errors = '';

      buildProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      buildProcess.stderr.on('data', (data) => {
        errors += data.toString();
      });

      buildProcess.on('close', (code) => {
        resolve({
          success: code === 0,
          output,
          errors,
          exitCode: code
        });
      });
    });
  }

  /**
   * Validate PostCSS configuration
   */
  async validatePostCSSConfig(projectPath) {
    const configPath = path.join(projectPath, 'postcss.config.js');
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const packageJson = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
      );
      
      const hasTailwindV4 = packageJson.devDependencies?.tailwindcss?.includes('4');
      
      if (hasTailwindV4) {
        // Should use @tailwindcss/postcss for v4
        if (content.includes('@tailwindcss/postcss')) {
          return { status: 'passed', message: '✓ PostCSS config correct for Tailwind v4' };
        } else {
          return { status: 'failed', message: '✗ PostCSS should use @tailwindcss/postcss for v4' };
        }
      } else {
        // Should use tailwindcss for v3
        if (content.includes('tailwindcss: {}') && !content.includes('@tailwindcss/postcss')) {
          return { status: 'passed', message: '✓ PostCSS config correct for Tailwind v3' };
        } else {
          return { status: 'failed', message: '✗ PostCSS config incorrect for Tailwind v3' };
        }
      }
    } catch (error) {
      return { status: 'failed', message: `✗ PostCSS validation error: ${error.message}` };
    }
  }

  /**
   * Main validation function
   */
  async validateProject(projectPath, appType) {
    const template = this.testTemplates[appType];
    if (!template) {
      return {
        success: false,
        message: `No test template for app type: ${appType}`
      };
    }

    console.log(`\n🧪 Validating ${appType} app at ${projectPath}\n`);

    const results = {
      fileValidation: [],
      importExportValidation: [],
      postCSSValidation: null,
      buildTest: null
    };

    // 1. Validate file patterns
    console.log('📝 Checking file patterns...');
    for (const fileSpec of template.files) {
      const filePath = path.join(projectPath, fileSpec.path);
      const result = await this.validateFile(filePath, fileSpec);
      results.fileValidation.push(result);
      
      console.log(`\n${fileSpec.path}:`);
      result.passed.forEach(msg => console.log(`  ${msg}`));
      result.failed.forEach(msg => console.log(`  ${msg}`));
    }

    // 2. Validate import/export consistency
    console.log('\n🔗 Checking import/export consistency...');
    results.importExportValidation = await this.validateImportExportConsistency(projectPath, template);
    results.importExportValidation.forEach(result => {
      console.log(`  ${result.message}`);
    });

    // 3. Validate PostCSS config
    console.log('\n🎨 Checking PostCSS configuration...');
    results.postCSSValidation = await this.validatePostCSSConfig(projectPath);
    console.log(`  ${results.postCSSValidation.message}`);

    // 4. Run build test
    console.log('\n🔨 Running build test...');
    results.buildTest = await this.testBuildability(projectPath);
    console.log(`  ${results.buildTest.success ? '✓ Build successful' : '✗ Build failed'}`);
    if (!results.buildTest.success && results.buildTest.errors) {
      console.log('\nBuild errors:');
      console.log(results.buildTest.errors.substring(0, 500) + '...');
    }

    // Calculate overall success
    const allFilesPassed = results.fileValidation.every(f => f.failed.length === 0);
    const allImportsPassed = results.importExportValidation.every(i => i.status === 'passed');
    const postCSSPassed = results.postCSSValidation.status === 'passed';
    const buildPassed = results.buildTest.success;

    const overallSuccess = allFilesPassed && allImportsPassed && postCSSPassed && buildPassed;

    return {
      success: overallSuccess,
      results,
      summary: {
        fileValidation: `${results.fileValidation.filter(f => f.failed.length === 0).length}/${results.fileValidation.length} files passed`,
        importExport: `${results.importExportValidation.filter(i => i.status === 'passed').length}/${results.importExportValidation.length} imports correct`,
        postCSS: postCSSPassed ? 'Passed' : 'Failed',
        build: buildPassed ? 'Passed' : 'Failed'
      }
    };
  }
}

// Example usage:
async function runTests() {
  const validator = new CodeGenerationValidator();
  
  // Test existing generated projects
  const testProjects = [
    {
      path: '/Users/saykarim/Downloads/no_code_framework-master/client/user-projects/project-29a1be6c',
      type: 'counter'
    },
    {
      path: '/Users/saykarim/Downloads/no_code_framework-master/client/user-projects/project-acb1794b',
      type: 'todo'
    }
  ];

  for (const project of testProjects) {
    const result = await validator.validateProject(project.path, project.type);
    console.log('\n' + '='.repeat(50));
    console.log(`Overall Result: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
    console.log('Summary:', result.summary);
    console.log('='.repeat(50) + '\n');
  }
}

module.exports = CodeGenerationValidator;

// Run tests if called directly
if (require.main === module) {
  runTests().catch(console.error);
}