'use client';

import { useEffect, useState } from 'react';
import { X, Terminal, CheckCircle, XCircle, Loader2, Clock, FileCode, GitCommit, GitBranch, GitPullRequest, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { useExecutionSocket } from '@/lib/socket/useSocket';
import DiffViewer from './DiffViewer';

interface AgentExecution {
  id: string;
  taskId: string;
  status: string;
  agentType: string;
  summary?: string;
  output?: string;
  changes?: any[];
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  progress?: number;
  currentStep?: string;
  logs: AgentLog[];
}

interface AgentLog {
  id: string;
  executionId: string;
  level: string;
  message: string;
  data?: any;
  timestamp: Date;
}

interface AgentExecutionPanelProps {
  taskId: string;
  projectId?: string;
  onClose: () => void;
  repoUrl?: string;
}

export default function AgentExecutionPanel({ taskId, projectId, onClose, repoUrl }: AgentExecutionPanelProps) {
  const [execution, setExecution] = useState<AgentExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [branchInfo, setBranchInfo] = useState<any>(null);
  const [showDiff, setShowDiff] = useState(true);
  const [pushAfterCommit, setPushAfterCommit] = useState(true);
  
  // Use WebSocket for real-time updates
  const { execution: socketExecution, logs: socketLogs } = useExecutionSocket(executionId);

  // Initial fetch to get execution ID
  useEffect(() => {
    fetchInitialExecution();
    
    // Poll for updates every 2 seconds if running
    const interval = setInterval(() => {
      if (execution && execution.status === 'running') {
        fetchInitialExecution();
      }
    }, 2000);
    
    return () => clearInterval(interval);
  }, [taskId, execution?.status]);
  
  // Fetch branch info when execution completes
  useEffect(() => {
    if (execution?.status === 'completed' && projectId) {
      fetchBranchInfo();
    }
  }, [execution?.status, projectId]);

  // Update execution from WebSocket
  useEffect(() => {
    if (socketExecution) {
      setExecution(prev => ({
        ...prev,
        ...socketExecution,
        logs: socketLogs || prev?.logs || []
      }));
    }
  }, [socketExecution, socketLogs]);

  const fetchInitialExecution = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/tasks/${taskId}/execution`);
      if (response.ok) {
        const data = await response.json();
        setExecution(data);
        setExecutionId(data.id); // This will trigger WebSocket subscription
      }
    } catch (error) {
      console.error('Error fetching execution:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const fetchBranchInfo = async () => {
    if (!projectId) return;
    try {
      const response = await fetch(`/api/workspace/status?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setBranchInfo(data.workspace?.git);
      }
    } catch (error) {
      console.error('Error fetching branch info:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
      case 'completed':
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-gray-500" />;
      default:
        return null;
    }
  };

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-500';
      case 'warning':
        return 'text-yellow-500';
      case 'info':
        return 'text-blue-500';
      case 'success':
        return 'text-green-500';
      default:
        return 'text-gray-400';
    }
  };

  const handleCommit = async () => {
    if (!projectId || !commitMessage.trim()) return;
    
    setCommitting(true);
    try {
      // First commit
      const commitResponse = await fetch('/api/workspace/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          taskId,
          message: commitMessage
        })
      });
      
      if (commitResponse.ok) {
        const commitResult = await commitResponse.json();
        console.log('Commit successful:', commitResult);
        
        // Then push if requested
        if (pushAfterCommit) {
          const pushResponse = await fetch('/api/workspace/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              branch: branchInfo?.branch
            })
          });
          
          if (pushResponse.ok) {
            const pushResult = await pushResponse.json();
            console.log('Push successful:', pushResult);
          } else {
            const pushError = await pushResponse.json();
            console.error('Push failed:', pushError);
          }
        }
        
        setShowCommitDialog(false);
        setCommitMessage('');
        setPushAfterCommit(true);
        
        // Refresh branch info
        fetchBranchInfo();
      } else {
        const error = await commitResponse.json();
        console.error('Commit failed:', error);
        // TODO: Show error toast
      }
    } catch (error) {
      console.error('Commit error:', error);
    } finally {
      setCommitting(false);
    }
  };
  
  const handleCreatePR = () => {
    if (repoUrl && branchInfo?.branch) {
      // Extract owner and repo from URL
      const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
      if (match) {
        const [, owner, repo] = match;
        const prUrl = `https://github.com/${owner}/${repo}/compare/main...${branchInfo.branch}?expand=1`;
        window.open(prUrl, '_blank');
      }
    }
  };

  if (loading && !execution) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="h-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">AI Agent Execution</h3>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-muted-foreground">No execution found for this task</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Terminal className="h-5 w-5" />
            <div>
              <h3 className="font-semibold">AI Agent Execution</h3>
              <p className="text-sm text-muted-foreground">
                {execution.agentType.replace('_', ' ').toUpperCase()}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="border-b p-4 bg-muted/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {getStatusIcon(execution.status)}
            <span className="font-medium capitalize">{execution.status}</span>
            {branchInfo?.branch && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <GitBranch className="h-3 w-3" />
                {branchInfo.branch}
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            Started: {format(new Date(execution.startedAt), 'HH:mm:ss')}
            {execution.completedAt && (
              <> • Completed: {format(new Date(execution.completedAt), 'HH:mm:ss')}</>
            )}
          </div>
        </div>
        
        {/* Progress Bar */}
        {execution.progress !== undefined && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{execution.currentStep || 'Processing...'}</span>
              <span className="font-medium">{execution.progress}%</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ease-out ${
                  execution.status === 'completed' ? 'bg-green-500' : 
                  execution.status === 'failed' ? 'bg-red-500' : 
                  'bg-primary'
                }`}
                style={{ width: `${execution.progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Summary */}
      {execution.summary && (
        <div className="p-4 border-b">
          <h4 className="font-medium mb-2">Summary</h4>
          <p className="text-sm">{execution.summary}</p>
        </div>
      )}

      {/* Changes and Actions */}
      {(execution.changes && execution.changes.length > 0) || execution.status === 'completed' ? (
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium flex items-center gap-2">
              <FileCode className="h-4 w-4" />
              Changes {execution.changes?.length ? `(${execution.changes.length} files)` : ''}
            </h4>
            <div className="flex items-center gap-2">
              {execution.status === 'completed' && projectId && (
                <>
                  <button
                    onClick={() => {
                      setCommitMessage(`feat: ${execution.summary || 'Generated code'}`);
                      setShowCommitDialog(true);
                    }}
                    className="flex items-center gap-2 px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
                  >
                    <GitCommit className="h-3 w-3" />
                    Commit
                  </button>
                  {repoUrl && branchInfo?.branch && (
                    <button
                      onClick={handleCreatePR}
                      className="flex items-center gap-2 px-3 py-1 text-sm border rounded hover:bg-secondary"
                    >
                      <GitPullRequest className="h-3 w-3" />
                      Create PR
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          
          {/* Diff Viewer */}
          {showDiff && execution.changes && projectId && (
            <div className="mt-4">
              <DiffViewer projectId={projectId} changes={execution.changes} />
            </div>
          )}
        </div>
      ) : null}

      {/* Logs */}
      <div className="flex-1 overflow-auto p-4">
        <h4 className="font-medium mb-2">Execution Logs</h4>
        <div className="space-y-1 font-mono text-sm">
          {execution.logs && execution.logs.length > 0 ? (
            execution.logs.map((log) => (
              <div key={log.id} className="flex gap-2">
                <span className="text-muted-foreground">
                  {format(new Date(log.timestamp), 'HH:mm:ss.SSS')}
                </span>
                <span className={getLogLevelColor(log.level)}>
                  [{log.level.toUpperCase()}]
                </span>
                <span className="flex-1">{log.message}</span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">No logs available</p>
          )}
        </div>
      </div>

      {/* Error Display */}
      {execution.error && (
        <div className="p-4 border-t bg-red-500/10">
          <h4 className="font-medium text-red-500 mb-2">Error</h4>
          <p className="text-sm font-mono">{execution.error}</p>
        </div>
      )}
      
      {/* Commit Dialog */}
      {showCommitDialog && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <GitCommit className="h-5 w-5" />
              Commit Changes
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Commit Message
                </label>
                <textarea
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  className="w-full h-24 px-3 py-2 border rounded-md bg-background"
                  placeholder="Describe your changes..."
                />
              </div>
              
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="pushAfterCommit"
                  checked={pushAfterCommit}
                  onChange={(e) => setPushAfterCommit(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="pushAfterCommit" className="text-sm">
                  Push to remote after commit
                </label>
              </div>
              
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowCommitDialog(false)}
                  className="px-4 py-2 text-sm border rounded-md hover:bg-secondary"
                  disabled={committing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCommit}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                  disabled={committing || !commitMessage.trim()}
                >
                  {committing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                      {pushAfterCommit ? 'Committing & Pushing...' : 'Committing...'}
                    </>
                  ) : (
                    pushAfterCommit ? 'Commit & Push' : 'Commit'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}