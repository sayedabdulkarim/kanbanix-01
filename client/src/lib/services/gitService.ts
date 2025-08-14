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
    const branchName = this.createBranchName(taskId, taskTitle);
    
    try {
      // First, ensure we're on main/master
      await execAsync('git checkout main || git checkout master', { 
        cwd: workspacePath 
      });
      
      // Pull latest changes
      await execAsync('git pull origin main || git pull origin master', { 
        cwd: workspacePath 
      });
      
      // Create and checkout new branch
      await execAsync(`git checkout -b ${branchName}`, { 
        cwd: workspacePath 
      });
      
      console.log(`Created and checked out branch: ${branchName}`);
      return branchName;
    } catch (error: any) {
      // If branch already exists, just checkout
      if (error.message.includes('already exists')) {
        await execAsync(`git checkout ${branchName}`, { 
          cwd: workspacePath 
        });
        console.log(`Checked out existing branch: ${branchName}`);
        return branchName;
      }
      throw error;
    }
  }

  /**
   * Get current branch and status
   */
  async getBranchInfo(workspacePath: string): Promise<GitBranchInfo> {
    try {
      // Get current branch
      const { stdout: currentBranch } = await execAsync(
        'git branch --show-current',
        { cwd: workspacePath }
      );
      
      // Get all branches
      const { stdout: allBranchesOutput } = await execAsync(
        'git branch -a',
        { cwd: workspacePath }
      );
      
      const allBranches = allBranchesOutput
        .split('\n')
        .map(b => b.trim().replace('* ', ''))
        .filter(b => b);
      
      // Check for uncommitted changes
      const { stdout: statusOutput } = await execAsync(
        'git status --porcelain',
        { cwd: workspacePath }
      );
      
      return {
        current: currentBranch.trim(),
        all: allBranches,
        hasUncommittedChanges: statusOutput.trim().length > 0
      };
    } catch (error) {
      console.error('Error getting branch info:', error);
      throw error;
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
   * Push branch to remote
   */
  async pushBranch(
    workspacePath: string,
    branchName: string,
    accessToken?: string
  ): Promise<void> {
    try {
      // Set upstream and push
      const pushCommand = accessToken
        ? `git push -u origin ${branchName}`
        : `git push -u origin ${branchName}`;
      
      await execAsync(pushCommand, {
        cwd: workspacePath,
        env: {
          ...process.env,
          GIT_ASKPASS: 'echo',
          GIT_USERNAME: accessToken || ''
        }
      });
      
      console.log(`Pushed branch ${branchName} to remote`);
    } catch (error) {
      console.error('Error pushing branch:', error);
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