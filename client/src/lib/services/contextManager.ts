import { PrismaClient, ProjectContext } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs/promises';

const prisma = new PrismaClient();

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: Date;
  children?: FileTreeNode[];
}

interface ProjectSummary {
  totalFiles: number;
  projectType: string | null;
  hasBackend: boolean;
  backendType: string | null;
  hasDatabase: boolean;
  databaseType: string | null;
  mainTechnologies: string[];
  recentTasks: any[];
}

export class ContextManager {
  private workspacePath: string;

  constructor() {
    this.workspacePath = process.env.WORKSPACE_PATH || path.join(process.cwd(), 'projects');
  }

  /**
   * Load or create context for a project
   */
  async loadContext(projectId: string): Promise<{
    memory: ProjectContext | null;
    files: FileTreeNode;
    summary: ProjectSummary;
  }> {
    // Get existing context from database
    const context = await prisma.projectContext.findUnique({
      where: { projectId }
    });

    // Scan current workspace
    const projectPath = path.join(this.workspacePath, projectId);
    const currentFiles = await this.scanWorkspace(projectPath);

    // Generate project summary
    const summary = await this.generateProjectSummary(context, currentFiles);

    return {
      memory: context,
      files: currentFiles,
      summary
    };
  }

  /**
   * Save updated context after task completion
   */
  async saveContext(projectId: string, taskResult: any): Promise<void> {
    const existing = await prisma.projectContext.findUnique({
      where: { projectId }
    });

    const projectPath = path.join(this.workspacePath, projectId);
    
    // Scan for current state
    const fileTree = await this.scanWorkspace(projectPath);
    const projectType = await this.detectProjectType(projectPath);
    const backendInfo = await this.detectBackend(projectPath);
    const dependencies = await this.extractDependencies(projectPath);

    // Update task history
    const taskHistory = existing?.taskHistory 
      ? JSON.parse(existing.taskHistory)
      : [];
    
    taskHistory.push({
      taskId: taskResult.taskId,
      title: taskResult.title,
      timestamp: new Date(),
      filesCreated: taskResult.filesCreated || [],
      filesModified: taskResult.filesModified || [],
      summary: taskResult.summary
    });

    // Keep only last 20 tasks for memory efficiency
    if (taskHistory.length > 20) {
      taskHistory.shift();
    }

    const updatedContext = {
      fileTree: JSON.stringify(fileTree),
      projectType,
      dependencies: JSON.stringify(dependencies),
      backendType: backendInfo.type,
      backendFiles: JSON.stringify(backendInfo.files),
      ormType: backendInfo.ormType,
      taskHistory: JSON.stringify(taskHistory),
      lastSnapshot: JSON.stringify({
        timestamp: new Date(),
        fileCount: this.countFiles(fileTree),
        lastTask: taskResult.title
      })
    };

    await prisma.projectContext.upsert({
      where: { projectId },
      update: updatedContext,
      create: {
        projectId,
        ...updatedContext
      }
    });
  }

  /**
   * Scan workspace and build file tree
   */
  private async scanWorkspace(projectPath: string): Promise<FileTreeNode> {
    const stats = await fs.stat(projectPath).catch(() => null);
    
    if (!stats || !stats.isDirectory()) {
      return {
        name: path.basename(projectPath),
        path: projectPath,
        type: 'directory',
        children: []
      };
    }

    return this.buildFileTree(projectPath, projectPath);
  }

  /**
   * Recursively build file tree
   */
  private async buildFileTree(dirPath: string, basePath: string): Promise<FileTreeNode> {
    const name = path.basename(dirPath);
    const relativePath = path.relative(basePath, dirPath);
    
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const children: FileTreeNode[] = [];

    for (const entry of entries) {
      // Skip node_modules, .git, and other build directories
      if (this.shouldSkipDirectory(entry.name)) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively process subdirectories
        const subTree = await this.buildFileTree(fullPath, basePath);
        children.push(subTree);
      } else {
        // Add file node
        const stats = await fs.stat(fullPath);
        children.push({
          name: entry.name,
          path: path.relative(basePath, fullPath),
          type: 'file',
          size: stats.size,
          lastModified: stats.mtime
        });
      }
    }

    return {
      name,
      path: relativePath || '.',
      type: 'directory',
      children
    };
  }

  /**
   * Detect project type from files and dependencies
   */
  private async detectProjectType(projectPath: string): Promise<string | null> {
    // Check for package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

      // Framework detection
      if (deps['next']) return 'nextjs';
      if (deps['react']) return 'react';
      if (deps['vue']) return 'vue';
      if (deps['@angular/core']) return 'angular';
      if (deps['svelte']) return 'svelte';
      if (deps['express']) return 'express';
      if (deps['fastify']) return 'fastify';
      if (deps['nest']) return 'nestjs';
    } catch (e) {
      // Not a Node.js project
    }

    // Check for Python projects
    const requirementsPath = path.join(projectPath, 'requirements.txt');
    const pyprojectPath = path.join(projectPath, 'pyproject.toml');
    
    if (await this.fileExists(requirementsPath) || await this.fileExists(pyprojectPath)) {
      const managePy = path.join(projectPath, 'manage.py');
      if (await this.fileExists(managePy)) return 'django';
      
      const appPy = path.join(projectPath, 'app.py');
      if (await this.fileExists(appPy)) return 'flask';
      
      return 'python';
    }

    // Check for other project types
    if (await this.fileExists(path.join(projectPath, 'Gemfile'))) return 'rails';
    if (await this.fileExists(path.join(projectPath, 'composer.json'))) return 'php';
    if (await this.fileExists(path.join(projectPath, 'pom.xml'))) return 'java-maven';
    if (await this.fileExists(path.join(projectPath, 'build.gradle'))) return 'java-gradle';
    if (await this.fileExists(path.join(projectPath, 'Cargo.toml'))) return 'rust';
    if (await this.fileExists(path.join(projectPath, 'go.mod'))) return 'go';

    return null;
  }

  /**
   * Detect backend infrastructure
   */
  private async detectBackend(projectPath: string): Promise<{
    type: string | null;
    files: string[];
    ormType: string | null;
  }> {
    const backendFiles: string[] = [];
    let backendType: string | null = null;
    let ormType: string | null = null;

    // Check for Node.js backends
    if (await this.fileExists(path.join(projectPath, 'server.js'))) {
      backendFiles.push('server.js');
      backendType = 'express';
    }

    // Check for Next.js API routes
    const nextApiPaths = [
      'pages/api',
      'app/api',
      'src/pages/api',
      'src/app/api'
    ];

    for (const apiPath of nextApiPaths) {
      const fullPath = path.join(projectPath, apiPath);
      if (await this.fileExists(fullPath)) {
        // Find API files recursively
        const apiFiles: string[] = [];
        const findApiFiles = async (dir: string) => {
          try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const entryPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                await findApiFiles(entryPath);
              } else if (entry.isFile() && 
                        ['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(entry.name))) {
                apiFiles.push(path.relative(fullPath, entryPath));
              }
            }
          } catch (e) {
            // Ignore errors
          }
        };
        await findApiFiles(fullPath);
        backendFiles.push(...apiFiles.map(f => path.join(apiPath, f)));
        backendType = 'nextjs-api';
        break;
      }
    }

    // Check for database/ORM
    if (await this.fileExists(path.join(projectPath, 'prisma/schema.prisma'))) {
      ormType = 'prisma';
    } else if (await this.fileExists(path.join(projectPath, 'package.json'))) {
      try {
        const packageJson = JSON.parse(
          await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
        );
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        if (deps['mongoose']) ormType = 'mongoose';
        if (deps['sequelize']) ormType = 'sequelize';
        if (deps['typeorm']) ormType = 'typeorm';
      } catch (e) {
        // Ignore
      }
    }

    // Check for Python backends
    if (await this.fileExists(path.join(projectPath, 'manage.py'))) {
      backendType = 'django';
      backendFiles.push('manage.py', 'settings.py');
    } else if (await this.fileExists(path.join(projectPath, 'app.py'))) {
      backendType = 'flask';
      backendFiles.push('app.py');
    }

    return {
      type: backendType,
      files: backendFiles,
      ormType
    };
  }

  /**
   * Extract project dependencies
   */
  private async extractDependencies(projectPath: string): Promise<Record<string, string>> {
    const dependencies: Record<string, string> = {};

    // Node.js projects
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (await this.fileExists(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        Object.assign(dependencies, packageJson.dependencies || {});
      } catch (e) {
        // Ignore
      }
    }

    // Python projects
    const requirementsPath = path.join(projectPath, 'requirements.txt');
    if (await this.fileExists(requirementsPath)) {
      try {
        const requirements = await fs.readFile(requirementsPath, 'utf-8');
        requirements.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const [name] = trimmed.split(/[>=<]/);
            dependencies[name] = trimmed;
          }
        });
      } catch (e) {
        // Ignore
      }
    }

    return dependencies;
  }

  /**
   * Generate project summary
   */
  private async generateProjectSummary(
    context: ProjectContext | null,
    fileTree: FileTreeNode
  ): Promise<ProjectSummary> {
    const fileCount = this.countFiles(fileTree);
    const taskHistory = context?.taskHistory ? JSON.parse(context.taskHistory) : [];
    
    // Extract main technologies
    const mainTechnologies: string[] = [];
    if (context?.projectType) mainTechnologies.push(context.projectType);
    if (context?.backendType) mainTechnologies.push(context.backendType);
    if (context?.ormType) mainTechnologies.push(context.ormType);

    return {
      totalFiles: fileCount,
      projectType: context?.projectType || null,
      hasBackend: !!context?.backendType,
      backendType: context?.backendType || null,
      hasDatabase: !!context?.ormType,
      databaseType: context?.ormType || null,
      mainTechnologies: Array.from(new Set(mainTechnologies)),
      recentTasks: taskHistory.slice(-5)
    };
  }

  /**
   * Count files in tree
   */
  private countFiles(node: FileTreeNode): number {
    if (node.type === 'file') return 1;
    
    let count = 0;
    if (node.children) {
      for (const child of node.children) {
        count += this.countFiles(child);
      }
    }
    return count;
  }

  /**
   * Check if file/directory exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Should skip directory during scanning
   */
  private shouldSkipDirectory(name: string): boolean {
    const skipDirs = [
      'node_modules',
      '.git',
      '.next',
      'dist',
      'build',
      '.cache',
      '.vscode',
      '.idea',
      '__pycache__',
      '.pytest_cache',
      'venv',
      'env',
      '.env'
    ];
    
    return skipDirs.includes(name);
  }

  /**
   * Get relevant files for a task based on context
   */
  async getRelevantFiles(
    projectId: string,
    taskDescription: string,
    maxFiles: number = 5
  ): Promise<Array<{ path: string; content: string; relevance: number }>> {
    const context = await this.loadContext(projectId);
    const projectPath = path.join(this.workspacePath, projectId);
    const relevantFiles: Array<{ path: string; content: string; relevance: number }> = [];

    // Extract keywords from task description
    const keywords = taskDescription.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !['the', 'and', 'for', 'with', 'add', 'create', 'update'].includes(word));

    // Search for files containing keywords
    const files = await this.findFilesWithKeywords(projectPath, keywords);
    
    // Read and score files
    for (const filePath of files.slice(0, maxFiles * 2)) {
      try {
        const content = await fs.readFile(path.join(projectPath, filePath), 'utf-8');
        const relevance = this.calculateRelevance(content, keywords);
        
        relevantFiles.push({
          path: filePath,
          content,
          relevance
        });
      } catch (e) {
        // Skip files that can't be read
      }
    }

    // Sort by relevance and return top N
    return relevantFiles
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxFiles);
  }

  /**
   * Find files containing keywords
   */
  private async findFilesWithKeywords(
    projectPath: string,
    keywords: string[]
  ): Promise<string[]> {
    const matchingFiles: string[] = [];
    
    // Recursively search for files
    const searchDir = async (dir: string, base: string) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          // Skip common directories
          if (['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) {
            continue;
          }
          
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            await searchDir(fullPath, base);
          } else if (entry.isFile()) {
            // Check if it's a code file
            const ext = path.extname(entry.name);
            if (['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.rb', '.php'].includes(ext)) {
              try {
                const content = await fs.readFile(fullPath, 'utf-8');
                const lowerContent = content.toLowerCase();
                
                for (const keyword of keywords) {
                  if (lowerContent.includes(keyword)) {
                    matchingFiles.push(path.relative(base, fullPath));
                    break;
                  }
                }
              } catch (e) {
                // Skip files that can't be read
              }
            }
          }
        }
      } catch (e) {
        // Skip directories that can't be read
      }
    };
    
    await searchDir(projectPath, projectPath);
    return matchingFiles;
  }

  /**
   * Calculate relevance score for content
   */
  private calculateRelevance(content: string, keywords: string[]): number {
    const lowerContent = content.toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      // Count occurrences
      const regex = new RegExp(keyword, 'gi');
      const matches = content.match(regex);
      if (matches) {
        score += matches.length;
      }

      // Bonus for exact matches in important contexts
      if (lowerContent.includes(`class ${keyword}`) || 
          lowerContent.includes(`function ${keyword}`) ||
          lowerContent.includes(`const ${keyword}`) ||
          lowerContent.includes(`export ${keyword}`)) {
        score += 5;
      }
    }

    return score;
  }
}

export default new ContextManager();