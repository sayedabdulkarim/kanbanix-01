// Workspace Management Service
// Handles cloning, cleanup, and status tracking for temporary workspaces

import { API_ENDPOINTS, apiFetch } from '@/lib/config/api';

export interface WorkspaceStatus {
  projectId: string;
  projectName: string;
  workspace: {
    path: string;
    exists: boolean;
    createdAt?: Date;
    modifiedAt?: Date;
    size?: string;
    git?: {
      branch: string;
      hasUncommittedChanges: boolean;
      lastCommit: string;
    };
  };
  tasksInProgress: number;
  runningExecutions: number;
  githubRepo: {
    owner: string;
    repo: string;
    url: string;
  };
}

export interface WorkspaceEnterResult {
  success: boolean;
  workspacePath: string;
  message: string;
  project: {
    id: string;
    name: string;
    githubOwner: string;
    githubRepo: string;
    defaultBranch?: string;
  };
}

export interface WorkspaceLeaveResult {
  success: boolean;
  message: string;
  tasksReset?: number;
  executionsCancelled?: string;
}

class WorkspaceService {
  private currentWorkspace: string | null = null;
  private currentProjectId: string | null = null;

  // Enter a project workspace (clone repository)
  async enterWorkspace(projectId: string): Promise<WorkspaceEnterResult> {
    try {
      const response = await apiFetch(API_ENDPOINTS.workspace.enter, {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to enter workspace');
      }

      const result = await response.json();
      
      // Store current workspace info
      this.currentWorkspace = result.workspacePath;
      this.currentProjectId = projectId;
      
      // Store in sessionStorage for persistence across page refreshes
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('currentWorkspace', result.workspacePath);
        sessionStorage.setItem('currentProjectId', projectId);
      }

      return result;
    } catch (error: any) {
      console.error('Error entering workspace:', error);
      throw error;
    }
  }

  // Leave current workspace (cleanup)
  async leaveWorkspace(projectId?: string): Promise<WorkspaceLeaveResult> {
    const targetProjectId = projectId || this.currentProjectId;
    
    if (!targetProjectId) {
      throw new Error('No project ID specified');
    }

    try {
      const response = await apiFetch(API_ENDPOINTS.workspace.leave, {
        method: 'POST',
        body: JSON.stringify({ projectId: targetProjectId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to leave workspace');
      }

      const result = await response.json();
      
      // Clear current workspace info
      if (targetProjectId === this.currentProjectId) {
        this.currentWorkspace = null;
        this.currentProjectId = null;
        
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('currentWorkspace');
          sessionStorage.removeItem('currentProjectId');
        }
      }

      return result;
    } catch (error: any) {
      console.error('Error leaving workspace:', error);
      throw error;
    }
  }

  // Get workspace status
  async getWorkspaceStatus(projectId: string): Promise<WorkspaceStatus> {
    try {
      const response = await apiFetch(`${API_ENDPOINTS.workspace.status}?projectId=${projectId}`, {
        method: 'GET',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get workspace status');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error getting workspace status:', error);
      throw error;
    }
  }

  // Refresh workspace (pull latest changes)
  async refreshWorkspace(projectId: string, discardChanges: boolean = false): Promise<any> {
    try {
      const response = await apiFetch(API_ENDPOINTS.workspace.refresh, {
        method: 'POST',
        body: JSON.stringify({ projectId, discardChanges }),
      });

      if (!response.ok) {
        const error = await response.json();
        
        // Handle uncommitted changes conflict
        if (response.status === 409) {
          return {
            success: false,
            hasUncommittedChanges: true,
            changes: error.changes,
            message: error.message
          };
        }
        
        throw new Error(error.error || 'Failed to refresh workspace');
      }

      return await response.json();
    } catch (error: any) {
      console.error('Error refreshing workspace:', error);
      throw error;
    }
  }

  // Get current workspace path
  getCurrentWorkspace(): string | null {
    if (this.currentWorkspace) {
      return this.currentWorkspace;
    }
    
    // Try to recover from sessionStorage
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('currentWorkspace');
    }
    
    return null;
  }

  // Get current project ID
  getCurrentProjectId(): string | null {
    if (this.currentProjectId) {
      return this.currentProjectId;
    }
    
    // Try to recover from sessionStorage
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('currentProjectId');
    }
    
    return null;
  }

  // Check if we have an active workspace
  hasActiveWorkspace(): boolean {
    return this.currentWorkspace !== null || 
           (typeof window !== 'undefined' && sessionStorage.getItem('currentWorkspace') !== null);
  }

  // Initialize from storage (call on app mount)
  initFromStorage(): void {
    if (typeof window !== 'undefined') {
      this.currentWorkspace = sessionStorage.getItem('currentWorkspace');
      this.currentProjectId = sessionStorage.getItem('currentProjectId');
    }
  }
}

// Export singleton instance
export const workspaceService = new WorkspaceService();
export default workspaceService;