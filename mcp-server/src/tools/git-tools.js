import { simpleGit } from 'simple-git';
import path from 'path';

// Initialize git with project root
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const git = simpleGit(PROJECT_ROOT);

export const gitTools = [
  {
    name: 'git_status',
    description: 'Get current git status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const status = await git.status();
      return JSON.stringify({
        current_branch: status.current,
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        staged: status.staged,
        renamed: status.renamed,
        conflicted: status.conflicted,
        ahead: status.ahead,
        behind: status.behind,
      }, null, 2);
    },
  },

  {
    name: 'git_diff',
    description: 'Get git diff for files',
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Specific file to diff (optional)',
        },
        staged: {
          type: 'boolean',
          description: 'Show staged changes',
          default: false,
        },
      },
    },
    handler: async ({ file, staged = false }) => {
      const args = staged ? ['--cached'] : [];
      if (file) args.push(file);
      
      const diff = await git.diff(args);
      return diff || 'No changes detected';
    },
  },

  {
    name: 'git_add',
    description: 'Stage files for commit',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to stage (or ["."] for all)',
        },
      },
      required: ['files'],
    },
    handler: async ({ files }) => {
      await git.add(files);
      return `Staged ${files.length} file(s): ${files.join(', ')}`;
    },
  },

  {
    name: 'git_commit',
    description: 'Create a git commit',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Commit message',
        },
        body: {
          type: 'string',
          description: 'Commit body (optional)',
        },
      },
      required: ['message'],
    },
    handler: async ({ message, body }) => {
      const commitMessage = body ? `${message}\n\n${body}` : message;
      const result = await git.commit(commitMessage);
      return `Commit created: ${result.commit}\n${result.summary.changes} changes, +${result.summary.insertions} -${result.summary.deletions}`;
    },
  },

  {
    name: 'git_branch',
    description: 'List or create branches',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'checkout'],
          description: 'Action to perform',
        },
        name: {
          type: 'string',
          description: 'Branch name (for create/checkout)',
        },
      },
      required: ['action'],
    },
    handler: async ({ action, name }) => {
      switch (action) {
        case 'list':
          const branches = await git.branchLocal();
          return `Current: ${branches.current}\nAll branches:\n${branches.all.join('\n')}`;
        
        case 'create':
          if (!name) throw new Error('Branch name required');
          await git.checkoutLocalBranch(name);
          return `Created and switched to branch: ${name}`;
        
        case 'checkout':
          if (!name) throw new Error('Branch name required');
          await git.checkout(name);
          return `Switched to branch: ${name}`;
        
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  },

  {
    name: 'git_log',
    description: 'Get commit history',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of commits to show',
          default: 10,
        },
        file: {
          type: 'string',
          description: 'Show commits for specific file',
        },
      },
    },
    handler: async ({ limit = 10, file }) => {
      const options = [`-${limit}`, '--oneline'];
      if (file) options.push('--', file);
      
      const log = await git.log(options);
      return log.all
        .map(commit => `${commit.hash.substring(0, 7)} - ${commit.message}`)
        .join('\n');
    },
  },

  {
    name: 'git_reset',
    description: 'Reset staged changes',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to unstage',
        },
      },
      required: ['files'],
    },
    handler: async ({ files }) => {
      await git.reset(files);
      return `Unstaged ${files.length} file(s): ${files.join(', ')}`;
    },
  },
];