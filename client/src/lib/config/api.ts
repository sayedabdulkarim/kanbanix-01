/**
 * Centralized API Configuration
 * 
 * This file contains all API endpoints and configuration
 * Update the BASE_URL for different environments
 */

// Base URL configuration - change this for different environments
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// API endpoint builder
const api = (path: string) => `${BASE_URL}${path}`;

// Export all API endpoints
export const API_ENDPOINTS = {
  // Auth endpoints
  auth: {
    signIn: api('/api/auth/signin'),
    signOut: api('/api/auth/signout'),
    session: api('/api/auth/session'),
  },

  // Project endpoints
  projects: {
    list: api('/api/projects'),
    create: api('/api/projects'),
    get: (projectId: string) => api(`/api/projects/${projectId}`),
    update: (projectId: string) => api(`/api/projects/${projectId}`),
    delete: (projectId: string) => api(`/api/projects/${projectId}`),
    syncGithub: (projectId: string) => api(`/api/projects/${projectId}/sync-github`),
    syncRepos: api('/api/projects/sync-repos'),
  },

  // Task endpoints
  tasks: {
    list: api('/api/tasks'),
    create: api('/api/tasks'),
    get: (taskId: string) => api(`/api/tasks/${taskId}`),
    update: (taskId: string) => api(`/api/tasks/${taskId}`),
    delete: (taskId: string) => api(`/api/tasks/${taskId}`),
    batchUpdate: api('/api/tasks/batch-update'),
    execute: (taskId: string) => api(`/api/tasks/${taskId}/execute`),
    execution: (taskId: string) => api(`/api/tasks/${taskId}/execution`),
    syncGithub: (taskId: string) => api(`/api/tasks/${taskId}/sync-github`),
    syncComments: (taskId: string) => api(`/api/tasks/${taskId}/sync-comments`),
    
    // Comments
    comments: {
      list: (taskId: string) => api(`/api/tasks/${taskId}/comments`),
      create: (taskId: string) => api(`/api/tasks/${taskId}/comments`),
      update: (taskId: string, commentId: string) => api(`/api/tasks/${taskId}/comments/${commentId}`),
      delete: (taskId: string, commentId: string) => api(`/api/tasks/${taskId}/comments/${commentId}`),
    },
    
    // GitHub conversations
    githubConversations: {
      list: (taskId: string) => api(`/api/tasks/${taskId}/github-conversations`),
      resolve: (taskId: string, conversationId: string) => api(`/api/tasks/${taskId}/github-conversations/${conversationId}/resolve`),
    },
  },

  // Workspace endpoints
  workspace: {
    enter: api('/api/workspace/enter'),
    leave: api('/api/workspace/leave'),
    status: api('/api/workspace/status'),
    refresh: api('/api/workspace/refresh'),
    branch: api('/api/workspace/branch'),
    commit: api('/api/workspace/commit'),
    push: api('/api/workspace/push'),
    diff: api('/api/workspace/diff'),
    file: api('/api/workspace/file'),
    pr: api('/api/workspace/pr'),
    syncPr: api('/api/workspace/sync-pr'),
  },

  // GitHub endpoints
  github: {
    repos: api('/api/github/repos'),
    importRepo: api('/api/github/import-repo'),
  },

  // MCP endpoints
  mcp: {
    execute: api('/api/mcp/execute'),
  },

  // Webhook endpoints
  webhooks: {
    github: api('/api/webhooks/github'),
  },

  // Socket endpoint
  socket: api('/api/socket'),

  // Test endpoint
  testDb: api('/api/test-db'),
} as const;

// Helper function for fetch with default headers
export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  return fetch(url, {
    ...options,
    headers: defaultHeaders,
  });
}

// Export the base URL for other uses (like WebSocket connections)
export const getBaseUrl = () => BASE_URL;

// Export WebSocket URL builder
export const getWebSocketUrl = () => {
  if (typeof window === 'undefined') return '';
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = BASE_URL || window.location.host;
  
  // Remove http/https from BASE_URL if present
  const cleanHost = host.replace(/^https?:\/\//, '');
  
  return `${protocol}//${cleanHost}`;
};