import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitBranchInfo {
  current: string;
  all: string[];
  hasUncommittedChanges: boolean;
}

export interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

class GitService {
  /**
   * Create a branch name from task title
   */
  createBranchName(taskId: string, taskTitle: string): string {
    // Create a URL-safe branch name with timestamp for uniqueness
    const slug = taskTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 30); // Reduced to make room for timestamp
    
    // Add timestamp to ensure uniqueness (last 6 digits of timestamp)
    const timestamp = Date.now().toString().slice(-6);
    
    return `task/${taskId.substring(0, 8)}-${slug}-${timestamp}`;
  }

  /**
   * Create a session branch name for V2 workflow
   */
  createSessionBranchName(projectId: string): string {
    // Create session branch with project ID and timestamp
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const uniqueId = Date.now().toString().slice(-6);
    
    return `session/${projectId.substring(0, 8)}-${timestamp}-${uniqueId}`;
  }

  /**
   * Create or get existing session branch for V2 workflow
   */
  async createOrGetSessionBranch(
    workspacePath: string,
    projectId: string
  ): Promise<string> {
    try {
      // Clean up any git lock files first
      try {
        await execAsync('rm -f .git/index.lock', { cwd: workspacePath });
      } catch (e) {
        // Ignore if file doesn't exist
      }

      // Check if a session branch already exists
      const { stdout: branchList } = await execAsync(
        'git branch -a | grep "session/"',
        { cwd: workspacePath }
      ).catch(() => ({ stdout: '' }));

      const existingSessionBranches = branchList
        .split('\n')
        .map(b => b.trim().replace('* ', ''))
        .filter(b => b.startsWith('session/') && b.includes(projectId.substring(0, 8)));

      if (existingSessionBranches.length > 0) {
        // Use the most recent session branch
        const sessionBranch = existingSessionBranches[0];
        await execAsync(`git checkout ${sessionBranch}`, { cwd: workspacePath });
        console.log(`Using existing session branch: ${sessionBranch}`);
        return sessionBranch;
      }

      // No existing session branch, create new one
      const sessionBranch = this.createSessionBranchName(projectId);

      // First ensure we're on main
      try {
        await execAsync('git checkout main', { cwd: workspacePath });
      } catch (mainError) {
        // Try master if main doesn't exist
        try {
          await execAsync('git checkout master', { cwd: workspacePath });
        } catch (masterError) {
          console.log('No main/master branch, creating branch from current state');
        }
      }

      // Create and checkout new session branch
      await execAsync(`git checkout -b ${sessionBranch}`, { cwd: workspacePath });
      console.log(`Created new session branch: ${sessionBranch}`);
      
      return sessionBranch;
    } catch (error: any) {
      console.error('Error creating session branch:', error);
      throw error;
    }
  }

  /**
   * Create and checkout a new branch for a task
   */
  async createTaskBranch(
    workspacePath: string, 
    taskId: string, 
    taskTitle: string
  ): Promise<string> {
    // Branch name is now unique by default due to timestamp
    const branchName = this.createBranchName(taskId, taskTitle);
    
    try {
      // Clean up any git lock files first
      try {
        await execAsync('rm -f .git/index.lock', { cwd: workspacePath });
      } catch (e) {
        // Ignore if file doesn't exist
      }
      
      // Branch doesn't exist, create it
      
      // First ensure we're on main
      try {
        await execAsync('git checkout main', { cwd: workspacePath });
      } catch (mainError) {
        // Try master if main doesn't exist
        try {
          await execAsync('git checkout master', { cwd: workspacePath });
        } catch (masterError) {
          // If neither exists, we're probably on initial commit
          console.log('No main/master branch, creating branch from current state');
        }
      }
      
      // Create and checkout new branch
      await execAsync(`git checkout -b ${branchName}`, { 
        cwd: workspacePath 
      });
      
      console.log(`Created and checked out unique branch: ${branchName}`);
      return branchName;
    } catch (error: any) {
      console.error('Error creating task branch:', error);
      throw error;
    }
  }

  /**
   * Get current branch and status
   */
  async getBranchInfo(workspacePath: string): Promise<GitBranchInfo> {
    try {
      // Get current branch
      let currentBranch = 'main';
      try {
        const { stdout } = await execAsync(
          'git branch --show-current',
          { cwd: workspacePath }
        );
        currentBranch = stdout.trim() || 'main';
      } catch (e) {
        console.warn('Could not get current branch, defaulting to main');
      }
      
      // Get all branches
      let allBranches = [currentBranch];
      try {
        const { stdout: allBranchesOutput } = await execAsync(
          'git branch -a',
          { cwd: workspacePath }
        );
        
        allBranches = allBranchesOutput
          .split('\n')
          .map(b => b.trim().replace('* ', ''))
          .filter(b => b);
      } catch (e) {
        console.warn('Could not get all branches');
      }
      
      // Check for uncommitted changes
      let hasUncommittedChanges = false;
      try {
        const { stdout: statusOutput } = await execAsync(
          'git status --porcelain',
          { cwd: workspacePath }
        );
        hasUncommittedChanges = statusOutput.trim().length > 0;
      } catch (e) {
        console.warn('Could not get status');
      }
      
      return {
        current: currentBranch,
        all: allBranches,
        hasUncommittedChanges
      };
    } catch (error) {
      console.error('Error getting branch info:', error);
      // Return sensible defaults instead of throwing
      return {
        current: 'main',
        all: ['main'],
        hasUncommittedChanges: false
      };
    }
  }

  /**
   * Stage and commit changes
   */
  async commitChanges(
    workspacePath: string,
    message: string,
    files?: string[]
  ): Promise<GitCommitInfo> {
    try {
      // Stage files (all if none specified)
      if (files && files.length > 0) {
        await execAsync(`git add ${files.join(' ')}`, { 
          cwd: workspacePath 
        });
      } else {
        await execAsync('git add .', { 
          cwd: workspacePath 
        });
      }
      
      // Commit with message
      await execAsync(`git commit -m "${message}"`, { 
        cwd: workspacePath 
      });
      
      // Get commit info
      const { stdout } = await execAsync(
        'git log -1 --format="%H|%s|%an|%ai"',
        { cwd: workspacePath }
      );
      
      const [hash, commitMessage, author, date] = stdout.trim().split('|');
      
      return {
        hash: hash.substring(0, 7),
        message: commitMessage,
        author,
        date
      };
    } catch (error: any) {
      if (error.message.includes('nothing to commit')) {
        throw new Error('No changes to commit');
      }
      throw error;
    }
  }

  /**
   * Auto-commit task changes for V2 workflow
   */
  async autoCommitTask(
    workspacePath: string,
    taskId: string,
    taskTitle: string,
    files?: string[]
  ): Promise<GitCommitInfo> {
    // Format: [Task-{taskId}] {taskTitle}
    const message = `[Task-${taskId.substring(0, 8)}] ${taskTitle}`;
    
    try {
      // Check if there are changes to commit
      const { stdout: statusOutput } = await execAsync(
        'git status --porcelain',
        { cwd: workspacePath }
      );
      
      if (!statusOutput.trim()) {
        throw new Error('No changes to commit');
      }
      
      // Commit the changes
      const commitInfo = await this.commitChanges(workspacePath, message, files);
      console.log(`Auto-committed task changes: ${commitInfo.hash}`);
      
      return commitInfo;
    } catch (error: any) {
      console.error('Error auto-committing task:', error);
      throw error;
    }
  }


  /**
   * Create a pull request (using GitHub CLI or API)
   */
  async createPullRequest(
    workspacePath: string,
    title: string,
    body: string,
    baseBranch: string = 'main'
  ): Promise<string> {
    try {
      // Use GitHub CLI if available
      const { stdout } = await execAsync(
        `gh pr create --title "${title}" --body "${body}" --base ${baseBranch}`,
        { cwd: workspacePath }
      );
      
      // Extract PR URL from output
      const prUrl = stdout.match(/https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/)?.[0];
      return prUrl || stdout.trim();
    } catch (error: any) {
      if (error.message.includes('gh: command not found')) {
        throw new Error('GitHub CLI not installed. Please install gh to create PRs.');
      }
      throw error;
    }
  }

  /**
   * Push branch to remote repository
   */
  async pushBranch(workspacePath: string, branchName: string, accessToken?: string): Promise<void> {
    try {
      // First try to push with the existing remote
      try {
        const { stdout } = await execAsync(
          `git push -u origin ${branchName}`,
          { cwd: workspacePath }
        );
        console.log('Branch pushed successfully:', stdout);
        return;
      } catch (error: any) {
        // If push fails, try to set the remote with token
        if (accessToken && (error.message.includes('Authentication failed') || error.message.includes('could not read Username'))) {
          console.log('Attempting to push with access token...');
          
          // Get the remote URL
          const { stdout: remoteUrl } = await execAsync(
            'git remote get-url origin',
            { cwd: workspacePath }
          );
          
          // Parse GitHub URL
          const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
          if (match) {
            const [, owner, repo] = match;
            const authenticatedUrl = `https://${accessToken}@github.com/${owner}/${repo.replace('.git', '')}.git`;
            
            // Set authenticated remote temporarily
            await execAsync(
              `git remote set-url origin ${authenticatedUrl}`,
              { cwd: workspacePath }
            );
            
            try {
              // Push with authenticated remote
              await execAsync(
                `git push -u origin ${branchName}`,
                { cwd: workspacePath }
              );
              console.log('Branch pushed successfully with token');
            } finally {
              // Reset remote URL to original (without token)
              await execAsync(
                `git remote set-url origin ${remoteUrl.trim()}`,
                { cwd: workspacePath }
              );
            }
            return;
          }
        }
        throw error;
      }
    } catch (error: any) {
      console.error('Error pushing branch:', error);
      throw new Error(`Failed to push branch: ${error.message}`);
    }
  }

  /**
   * Get last commit information
   */
  async getLastCommit(workspacePath: string): Promise<GitCommitInfo> {
    try {
      // Use a delimiter that's unlikely to appear in commit messages
      const delimiter = '|||DELIMITER|||';
      // Use %B to get the full commit message (subject + body)
      const { stdout } = await execAsync(
        `git log -1 --format="%H${delimiter}%B${delimiter}%an${delimiter}%ai"`,
        { cwd: workspacePath }
      );
      
      const [hash, message, author, date] = stdout.trim().split(delimiter);
      
      return {
        hash: hash.trim(),
        message: message.trim(),
        author: author.trim(),
        date: new Date(date.trim())
      };
    } catch (error) {
      console.error('Error getting last commit:', error);
      throw error;
    }
  }

  /**
   * Get uncommitted changes
   */
  async getUncommittedChanges(workspacePath: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync(
        'git status --porcelain',
        { cwd: workspacePath }
      );
      
      return stdout
        .trim()
        .split('\n')
        .filter(line => line)
        .map(line => {
          const [status, ...pathParts] = line.trim().split(' ');
          return pathParts.join(' ');
        });
    } catch (error) {
      console.error('Error getting uncommitted changes:', error);
      return [];
    }
  }

  /**
   * Get diff for uncommitted changes
   */
  async getDiff(workspacePath: string, staged: boolean = false): Promise<string> {
    try {
      const command = staged ? 'git diff --cached' : 'git diff';
      const { stdout } = await execAsync(command, { cwd: workspacePath });
      return stdout;
    } catch (error) {
      console.error('Error getting diff:', error);
      return '';
    }
  }

  /**
   * Get diff for a specific file (uncommitted changes)
   */
  async getDiffForFile(workspacePath: string, filePath: string): Promise<string> {
    try {
      // Remove leading slash if present
      const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
      
      console.log(`[gitService.getDiffForFile] Getting diff for: ${cleanPath}`);
      
      // First check if file is tracked by git
      try {
        const { stdout: lsFilesOutput } = await execAsync(
          `git ls-files "${cleanPath}"`,
          { cwd: workspacePath }
        );
        
        const isTracked = lsFilesOutput.trim().length > 0;
        console.log(`[gitService.getDiffForFile] File ${cleanPath} tracked: ${isTracked}`);
        
        if (!isTracked) {
          // File is not tracked - it's a new file
          // Add it with -N flag to make it show in diff
          console.log(`[gitService.getDiffForFile] Adding untracked file with -N flag`);
          await execAsync(`git add -N "${cleanPath}"`, { cwd: workspacePath });
        }
      } catch (e) {
        console.log(`[gitService.getDiffForFile] Error checking if file is tracked: ${e}`);
      }
      
      // Get both staged and unstaged changes for the file
      const { stdout: unstagedDiff } = await execAsync(
        `git diff -- "${cleanPath}"`, 
        { cwd: workspacePath }
      );
      
      const { stdout: stagedDiff } = await execAsync(
        `git diff --cached -- "${cleanPath}"`, 
        { cwd: workspacePath }
      );
      
      console.log(`[gitService.getDiffForFile] Unstaged diff length: ${unstagedDiff.length}, Staged diff length: ${stagedDiff.length}`);
      
      // Combine both diffs if both exist
      if (unstagedDiff && stagedDiff) {
        return `${stagedDiff}\n${unstagedDiff}`;
      }
      
      return unstagedDiff || stagedDiff || '';
    } catch (error) {
      console.error(`[gitService.getDiffForFile] Error getting diff for file ${filePath}:`, error);
      return '';
    }
  }

  /**
   * Get diff for a specific file
   */
  async getFileDiff(workspacePath: string, filePath: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`git diff HEAD -- "${filePath}"`, { cwd: workspacePath });
      return stdout;
    } catch (error) {
      console.error('Error getting file diff:', error);
      return '';
    }
  }

  /**
   * Get diff between two commits (for V2 task-specific diffs)
   */
  async getDiffBetweenCommits(
    workspacePath: string, 
    fromCommit: string, 
    toCommit: string
  ): Promise<string> {
    try {
      // Use unified diff format with proper headers for parsing
      const { stdout } = await execAsync(
        `git diff --unified=3 ${fromCommit}..${toCommit}`,
        { cwd: workspacePath }
      );
      return stdout;
    } catch (error) {
      console.error('Error getting diff between commits:', error);
      return '';
    }
  }
  
  /**
   * Get list of changed files in a commit
   */
  async getChangedFilesInCommit(workspacePath: string, commitSha: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync(
        `git diff-tree --no-commit-id --name-only -r ${commitSha}`,
        { cwd: workspacePath }
      );
      return stdout.trim().split('\n').filter(f => f);
    } catch (error) {
      console.error('Error getting changed files:', error);
      return [];
    }
  }

  /**
   * Get the commit before a specific commit (parent commit)
   */
  async getParentCommit(workspacePath: string, commitSha: string): Promise<string | null> {
    try {
      // First check if the commit exists
      try {
        await execAsync(`git rev-parse ${commitSha}`, { cwd: workspacePath });
      } catch (e) {
        console.log(`Commit ${commitSha} does not exist in repository`);
        return null;
      }
      
      // Now get the parent
      const { stdout } = await execAsync(
        `git rev-parse ${commitSha}^`,
        { cwd: workspacePath }
      );
      return stdout.trim();
    } catch (error) {
      console.error('Error getting parent commit:', error);
      return null;
    }
  }
}

export default new GitService();