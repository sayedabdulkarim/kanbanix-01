/**
 * GitHub Workflow Service
 * Manages repository operations for AI agent tasks
 */

import { Octokit } from '@octokit/rest';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

export class GitHubWorkflowService {
  private octokit: Octokit;
  private workspacePath: string;

  constructor(accessToken: string) {
    this.octokit = new Octokit({ auth: accessToken });
    this.workspacePath = process.env.WORKSPACE_PATH || path.join(process.cwd(), 'workspace');
  }

  /**
   * Setup workspace for a GitHub project
   */
  async setupProjectWorkspace(
    owner: string, 
    repo: string, 
    projectId: string
  ): Promise<string> {
    const projectPath = path.join(this.workspacePath, projectId);
    
    // Check if already cloned
    try {
      await fs.access(path.join(projectPath, '.git'));
      console.log('Repository already cloned, pulling latest changes...');
      await this.pullLatestChanges(projectPath);
      return projectPath;
    } catch {
      // Clone repository
      console.log('Cloning repository...');
      await fs.mkdir(projectPath, { recursive: true });
      await execAsync(
        `git clone https://github.com/${owner}/${repo}.git .`,
        { cwd: projectPath }
      );
      return projectPath;
    }
  }

  /**
   * Analyze project structure to understand the codebase
   */
  async analyzeProjectStructure(projectPath: string): Promise<ProjectAnalysis> {
    const analysis: ProjectAnalysis = {
      framework: 'unknown',
      language: 'typescript',
      directories: {},
      dependencies: [],
      patterns: {}
    };

    // Check package.json for framework detection
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      // Detect framework
      if (deps['next']) {
        analysis.framework = 'nextjs';
        analysis.directories = {
          pages: await this.findDirectory(projectPath, ['app', 'pages', 'src/app', 'src/pages']),
          components: await this.findDirectory(projectPath, ['components', 'src/components']),
          api: await this.findDirectory(projectPath, ['api', 'pages/api', 'app/api']),
          styles: await this.findDirectory(projectPath, ['styles', 'src/styles'])
        };
      } else if (deps['react']) {
        analysis.framework = 'react';
        analysis.directories = {
          components: await this.findDirectory(projectPath, ['src/components', 'components']),
          pages: await this.findDirectory(projectPath, ['src/pages', 'src/screens', 'src/views']),
          styles: await this.findDirectory(projectPath, ['src/styles', 'styles'])
        };
      } else if (deps['vue']) {
        analysis.framework = 'vue';
      }

      // Store dependencies
      analysis.dependencies = Object.keys(deps);

      // Detect patterns (routing, state management, etc.)
      if (deps['react-router-dom'] || deps['@tanstack/react-router']) {
        analysis.patterns.routing = 'react-router';
      }
      if (deps['redux'] || deps['@reduxjs/toolkit']) {
        analysis.patterns.stateManagement = 'redux';
      }
      if (deps['zustand']) {
        analysis.patterns.stateManagement = 'zustand';
      }

    } catch (error) {
      console.error('Error analyzing project:', error);
    }

    return analysis;
  }

  /**
   * Create a new branch for the task
   */
  async createTaskBranch(
    projectPath: string, 
    taskId: string, 
    taskTitle: string
  ): Promise<string> {
    const branchName = `ai/${taskId}-${taskTitle.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`;
    
    await execAsync(`git checkout -b ${branchName}`, { cwd: projectPath });
    
    return branchName;
  }

  /**
   * Determine if a file should be created or updated
   */
  async determineFileOperation(
    projectPath: string,
    filePath: string
  ): Promise<'create' | 'update'> {
    try {
      await fs.access(path.join(projectPath, filePath));
      return 'update';
    } catch {
      return 'create';
    }
  }

  /**
   * Apply AI-generated changes to the repository
   */
  async applyChanges(
    projectPath: string,
    changes: FileChange[]
  ): Promise<ApplyResult> {
    const results: ApplyResult = {
      created: [],
      updated: [],
      errors: []
    };

    for (const change of changes) {
      try {
        const fullPath = path.join(projectPath, change.path);
        const dir = path.dirname(fullPath);
        
        // Ensure directory exists
        await fs.mkdir(dir, { recursive: true });
        
        if (change.operation === 'create') {
          await fs.writeFile(fullPath, change.content);
          results.created.push(change.path);
        } else if (change.operation === 'update') {
          // For updates, we might want to merge or replace
          // This is where we'd use more sophisticated merging
          await fs.writeFile(fullPath, change.content);
          results.updated.push(change.path);
        }
      } catch (error: any) {
        results.errors.push({
          path: change.path,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Commit and push changes
   */
  async commitAndPush(
    projectPath: string,
    message: string,
    branchName: string
  ): Promise<void> {
    await execAsync('git add .', { cwd: projectPath });
    await execAsync(`git commit -m "${message}"`, { cwd: projectPath });
    await execAsync(`git push origin ${branchName}`, { cwd: projectPath });
  }

  /**
   * Create a pull request
   */
  async createPullRequest(
    owner: string,
    repo: string,
    branchName: string,
    title: string,
    body: string
  ): Promise<string> {
    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head: branchName,
      base: 'main' // or 'master'
    });

    return data.html_url;
  }

  // Helper methods
  private async pullLatestChanges(projectPath: string): Promise<void> {
    await execAsync('git fetch origin', { cwd: projectPath });
    await execAsync('git pull origin main', { cwd: projectPath });
  }

  private async findDirectory(basePath: string, candidates: string[]): Promise<string | null> {
    for (const candidate of candidates) {
      try {
        const fullPath = path.join(basePath, candidate);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          return candidate;
        }
      } catch {
        // Directory doesn't exist, try next
      }
    }
    return null;
  }
}

// Types
interface ProjectAnalysis {
  framework: string;
  language: string;
  directories: {
    [key: string]: string | null;
  };
  dependencies: string[];
  patterns: {
    [key: string]: string;
  };
}

interface FileChange {
  path: string;
  operation: 'create' | 'update' | 'delete';
  content: string;
}

interface ApplyResult {
  created: string[];
  updated: string[];
  errors: Array<{
    path: string;
    error: string;
  }>;
}

export type { ProjectAnalysis, FileChange, ApplyResult };