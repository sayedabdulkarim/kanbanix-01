import { Octokit } from '@octokit/rest';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';

export async function getGithubClient() {
  const session = await getServerSession(authOptions);
  
  if (!session?.accessToken) {
    throw new Error('No GitHub access token available');
  }

  return new Octokit({
    auth: session.accessToken,
  });
}

export interface GithubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  owner: {
    login: string;
    id: number;
  };
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  default_branch: string;
}

export interface GithubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  labels: Array<{
    name: string;
    color: string;
  }>;
  assignee: {
    login: string;
    avatar_url: string;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface GithubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  merged: boolean;
  html_url: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  created_at: string;
  updated_at: string;
}

export interface GithubComment {
  id: number;
  body: string;
  html_url: string;
  user: {
    login: string;
    avatar_url: string;
  };
  created_at: string;
  updated_at: string;
}

// Helper functions for GitHub operations
export async function createGithubWebhook(
  owner: string,
  repo: string,
  webhookUrl: string,
  secret: string
) {
  const octokit = await getGithubClient();
  
  try {
    const { data } = await octokit.repos.createWebhook({
      owner,
      repo,
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret,
      },
      events: ['issues', 'pull_request', 'issue_comment', 'push'],
      active: true,
    });
    
    return data;
  } catch (error: any) {
    if (error.status === 422) {
      // Webhook already exists
      console.log('Webhook already exists for this repository');
    } else {
      throw error;
    }
  }
}

export async function deleteGithubWebhook(
  owner: string,
  repo: string,
  hookId: number
) {
  const octokit = await getGithubClient();
  
  await octokit.repos.deleteWebhook({
    owner,
    repo,
    hook_id: hookId,
  });
}

export async function syncGithubIssues(owner: string, repo: string) {
  const octokit = await getGithubClient();
  
  const { data: issues } = await octokit.issues.listForRepo({
    owner,
    repo,
    state: 'all',
    per_page: 100,
  });
  
  return issues;
}

export async function syncGithubPullRequests(owner: string, repo: string) {
  const octokit = await getGithubClient();
  
  const { data: pulls } = await octokit.pulls.list({
    owner,
    repo,
    state: 'all',
    per_page: 100,
  });
  
  return pulls;
}

export async function postCommentToGithub(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
) {
  const octokit = await getGithubClient();
  
  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
  
  return data;
}

export async function updateGithubIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  updates: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    labels?: string[];
    assignees?: string[];
  }
) {
  const octokit = await getGithubClient();
  
  const { data } = await octokit.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    ...updates,
  });
  
  return data;
}