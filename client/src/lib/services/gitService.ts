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
    // Create a URL-safe branch name
    const slug = taskTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
    
    return `task/${taskId.substring(0, 8)}-${slug}`;
  }

  /**
   * Create and checkout a new branch for a task
   */
  async createTaskBranch(
    workspacePath: string, 
    taskId: string, 
    taskTitle: string
  ): Promise<string> {
    const baseBranchName = this.createBranchName(taskId, taskTitle);
    let branchName = baseBranchName;
    let attempt = 1;
    
    try {
      // Clean up any git lock files first
      try {
        await execAsync('rm -f .git/index.lock', { cwd: workspacePath });
      } catch (e) {
        // Ignore if file doesn't exist
      }
      
      // Get current branch
      let currentBranch = '';
      try {
        const result = await execAsync('git branch --show-current', { 
          cwd: workspacePath 
        });
        currentBranch = result.stdout;
      } catch (e) {
        console.log('Could not get current branch, assuming we need to create new one');
      }
      
      // Find a unique branch name
      while (attempt <= 10) {
        // Check if branch exists locally or remotely
        let branchExists = false;
        
        // Check local branches
        try {
          await execAsync(`git rev-parse --verify ${branchName}`, { 
            cwd: workspacePath 
          });
          branchExists = true;
        } catch (e) {
          // Branch doesn't exist locally
        }
        
        // Check remote branches
        if (!branchExists) {
          try {
            const { stdout } = await execAsync(
              `git ls-remote --heads origin ${branchName}`, 
              { cwd: workspacePath }
            );
            if (stdout.trim()) {
              branchExists = true;
            }
          } catch (e) {
            // Branch doesn't exist remotely
          }
        }
        
        if (!branchExists) {
          // Found a unique branch name
          break;
        }
        
        // Branch exists, try with version number
        attempt++;
        branchName = `${baseBranchName}-v${attempt}`;
        console.log(`Branch exists, trying: ${branchName}`);
      }
      
      if (attempt > 10) {
        throw new Error('Could not create unique branch name after 10 attempts');
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
      const { stdout } = await execAsync(
        'git log -1 --format="%H|%s|%an|%ai"',
        { cwd: workspacePath }
      );
      
      const [hash, message, author, date] = stdout.trim().split('|');
      
      return {
        hash,
        message,
        author,
        date: new Date(date)
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
}

export default new GitService();