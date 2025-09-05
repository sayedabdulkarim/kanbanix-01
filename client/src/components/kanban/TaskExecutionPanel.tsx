'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  X, Terminal, CheckCircle, XCircle, Loader2, Clock, 
  GitBranch, GitPullRequest, ExternalLink, ChevronRight,
  ChevronDown, MessageSquare, Send, FileCode, GitCommit
} from 'lucide-react';
import { format } from 'date-fns';
import { useExecutionSocket } from '@/lib/socket/useSocket';
import DiffViewer from './DiffViewer';
import { API_ENDPOINTS, apiFetch } from '@/lib/config/api';

interface TaskExecution {
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
  logs: ExecutionLog[];
}

interface ExecutionLog {
  id: string;
  executionId: string;
  level: string;
  message: string;
  data?: any;
  timestamp: Date;
}

interface TaskExecutionPanelProps {
  task: any;
  projectId: string;
  repoUrl?: string;
  onClose: () => void;
  onTaskUpdate?: (updatedTask: any) => void;
}

export default function TaskExecutionPanel({ 
  task, 
  projectId, 
  repoUrl,
  onClose,
  onTaskUpdate
}: TaskExecutionPanelProps) {
  const [execution, setExecution] = useState<TaskExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'logs' | 'diffs'>('logs');
  const [taskDetailsExpanded, setTaskDetailsExpanded] = useState(true);
  const [devServerExpanded, setDevServerExpanded] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [expandAllDiffs, setExpandAllDiffs] = useState<boolean | undefined>(undefined);
  const [branchInfo, setBranchInfo] = useState<any>(null);
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [prStatus, setPrStatus] = useState<any>(null);
  const [isCommitted, setIsCommitted] = useState(false);
  const [commitStatus, setCommitStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({ type: null, message: '' });
  const [prCreated, setPrCreated] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [devServerUrl, setDevServerUrl] = useState<string | null>(null);
  const [devServerStatus, setDevServerStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped');
  const [devServerStarted, setDevServerStarted] = useState(false);
  const [shouldStartDevServer, setShouldStartDevServer] = useState(false);

  // WebSocket for real-time updates
  const { execution: socketExecution, logs: socketLogs } = useExecutionSocket(execution?.id || null);

  const fetchExecution = async () => {
    try {
      setLoading(true);
      const response = await apiFetch(API_ENDPOINTS.tasks.execution(task.id));
      if (response.ok) {
        const data = await response.json();
        console.log('Fetched execution with changes:', data.changes?.length || 0);
        setExecution(data);
        
        // Check if execution has dev server URL in summary
        if (data.summary) {
          const urlMatch = data.summary.match(/\[DEV_SERVER_URL\](.*?)\[\/DEV_SERVER_URL\]/);
          if (urlMatch) {
            setDevServerUrl(urlMatch[1]);
            setDevServerStatus('pending');
          }
        }
        
        // If execution completed and has changes, try to start dev server
        if (data.status === 'completed' && data.changes && data.changes.length > 0 && !devServerStarted) {
          console.log('Execution completed, should start dev server...');
          setShouldStartDevServer(true);
          
          // Fetch the updated task status from backend
          // The backend should have moved it to InReview
          if (onTaskUpdate && task) {
            // Add a delay to ensure backend has updated the task
            setTimeout(() => {
              fetch(`/api/tasks/${task.id}`, {
                cache: 'no-store',
                headers: {
                  'Cache-Control': 'no-cache'
                }
              })
                .then(res => res.json())
                .then(updatedTask => {
                  console.log('Fetched updated task:', {
                    id: updatedTask.id,
                    status: updatedTask.status, 
                    columnId: updatedTask.columnId
                  });
                  
                  if (updatedTask && updatedTask.status === 'inReview') {
                    console.log('Task moved to InReview, updating UI with columnId:', updatedTask.columnId);
                    onTaskUpdate(updatedTask);
                  } else if (updatedTask) {
                    // If not yet InReview, retry with more attempts
                    console.log(`Task status is ${updatedTask.status}, retrying...`);
                    let retryCount = 0;
                    const maxRetries = 3;
                    
                    const retryFetch = () => {
                      if (retryCount >= maxRetries) {
                        console.log('Max retries reached. Task status:', updatedTask.status);
                        // Even if not inReview, update with current status
                        onTaskUpdate(updatedTask);
                        return;
                      }
                      
                      setTimeout(() => {
                        retryCount++;
                        fetch(`/api/tasks/${task.id}`, {
                          cache: 'no-store',
                          headers: {
                            'Cache-Control': 'no-cache'
                          }
                        })
                          .then(res => res.json())
                          .then(finalTask => {
                            console.log(`Retry ${retryCount}: Task status = ${finalTask.status}, columnId = ${finalTask.columnId}`);
                            if (finalTask && finalTask.status === 'inReview') {
                              console.log('Task finally moved to InReview, updating UI...');
                              onTaskUpdate(finalTask);
                            } else if (retryCount < maxRetries) {
                              retryFetch();
                            } else {
                              // Update with whatever status we have
                              onTaskUpdate(finalTask);
                            }
                          })
                          .catch(err => console.error(`Error on retry ${retryCount}:`, err));
                      }, 2000);
                    };
                    
                    retryFetch();
                  }
                })
                .catch(err => console.error('Error fetching updated task:', err));
            }, 2000); // Increased initial delay to give backend more time
          }
        }
        // Don't auto-switch tabs anymore to prevent re-renders
      }
    } catch (error) {
      console.error('Error fetching execution:', error);
    } finally {
      setLoading(false);
    }
  };

  // Define startDevServerForProject first, before any useEffect that uses it
  const startDevServerForProject = useCallback(async () => {
    if (!projectId || devServerStatus === 'running' || devServerStatus === 'starting' || devServerStarted) return;
    
    try {
      setDevServerStatus('starting');
      setDevServerStarted(true);
      const response = await apiFetch(API_ENDPOINTS.workspace.devServer, {
        method: 'POST',
        body: JSON.stringify({ 
          projectId, 
          taskId: task.id,
          executionId: execution?.id 
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.url) {
          setDevServerUrl(data.url);
          setDevServerStatus('running');
          console.log('Dev server started at:', data.url);
        }
      } else {
        console.error('Failed to start dev server');
        setDevServerStatus('error');
      }
    } catch (error) {
      console.error('Error starting dev server:', error);
      setDevServerStatus('error');
    }
  }, [projectId, devServerStatus, task.id, execution?.id, devServerStarted]);

  const fetchBranchInfo = async () => {
    try {
      const response = await apiFetch(`${API_ENDPOINTS.workspace.status}?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setBranchInfo(data.workspace?.git);
      }
    } catch (error) {
      console.error('Error fetching branch info:', error);
    }
  };

  const [creatingPR, setCreatingPR] = useState(false);

  // All useEffects after function definitions
  useEffect(() => {
    if (task?.id) {
      fetchExecution();
      // Also fetch branch info on initial load
      if (projectId) {
        fetchBranchInfo();
      }
    }
  }, [task?.id, projectId]);
  
  // Separate polling effect
  useEffect(() => {
    if (execution && (execution.status === 'running' || execution.status === 'pending')) {
      const interval = setInterval(() => {
        fetchExecution();
      }, 2000);
      
      return () => clearInterval(interval);
    }
  }, [execution?.status, task?.id]);

  useEffect(() => {
    if (socketExecution) {
      setExecution(prev => ({
        ...prev,
        ...socketExecution,
        logs: socketLogs || prev?.logs || []
      }));
      
      // Check if execution just completed and we haven't started dev server yet
      if (socketExecution.status === 'completed' && !devServerStarted && socketExecution.changes?.length > 0) {
        console.log('Execution completed via socket, should start dev server...');
        setShouldStartDevServer(true);
        
        // Fetch the updated task status from backend
        // The backend should have moved it to InReview
        if (onTaskUpdate && task) {
          // Add a delay to ensure backend has updated the task
          setTimeout(() => {
            fetch(`/api/tasks/${task.id}`, {
              cache: 'no-store',
              headers: {
                'Cache-Control': 'no-cache'
              }
            })
              .then(res => res.json())
              .then(updatedTask => {
                console.log('Socket - Fetched updated task:', {
                  id: updatedTask.id,
                  status: updatedTask.status,
                  columnId: updatedTask.columnId
                });
                
                if (updatedTask && updatedTask.status === 'inReview') {
                  console.log('Socket - Task moved to InReview, updating UI with columnId:', updatedTask.columnId);
                  onTaskUpdate(updatedTask);
                } else if (updatedTask) {
                  // If not yet InReview, retry with more attempts
                  console.log(`Socket - Task status is ${updatedTask.status}, retrying...`);
                  let retryCount = 0;
                  const maxRetries = 3;
                  
                  const retryFetch = () => {
                    if (retryCount >= maxRetries) {
                      console.log('Socket - Max retries reached. Task status:', updatedTask.status);
                      // Even if not inReview, update with current status
                      onTaskUpdate(updatedTask);
                      return;
                    }
                    
                    setTimeout(() => {
                      retryCount++;
                      fetch(`/api/tasks/${task.id}`, {
                        cache: 'no-store',
                        headers: {
                          'Cache-Control': 'no-cache'
                        }
                      })
                        .then(res => res.json())
                        .then(finalTask => {
                          console.log(`Socket - Retry ${retryCount}: Task status = ${finalTask.status}, columnId = ${finalTask.columnId}`);
                          if (finalTask && finalTask.status === 'inReview') {
                            console.log('Socket - Task finally moved to InReview, updating UI...');
                            onTaskUpdate(finalTask);
                          } else if (retryCount < maxRetries) {
                            retryFetch();
                          } else {
                            // Update with whatever status we have
                            onTaskUpdate(finalTask);
                          }
                        })
                        .catch(err => console.error(`Socket - Error on retry ${retryCount}:`, err));
                    }, 2000);
                  };
                  
                  retryFetch();
                }
              })
              .catch(err => console.error('Socket - Error fetching updated task:', err));
          }, 2000); // Increased initial delay to give backend more time
        }
      }
      
      // Check for dev server URL in summary (just for display, don't start again)
      if (socketExecution.summary) {
        const urlMatch = socketExecution.summary.match(/\[DEV_SERVER_URL\](.*?)\[\/DEV_SERVER_URL\]/);
        if (urlMatch && urlMatch[1] === 'pending') {
          // Dev server should be started, just mark status
          if (!devServerStarted) {
            setShouldStartDevServer(true);
          }
        }
      }
    }
    
    // Also check logs for dev server messages
    if (socketLogs && socketLogs.length > 0) {
      const lastLog = socketLogs[socketLogs.length - 1];
      if (lastLog.message?.includes('Dev server ready at')) {
        // This log comes from the dev-server route with the actual URL
        const urlMatch = lastLog.message.match(/http:\/\/localhost:\d+/);
        if (urlMatch) {
          setDevServerUrl(urlMatch[0]);
          setDevServerStatus('running');
        }
      } else if (lastLog.message?.includes('Starting development server')) {
        setDevServerStatus('starting');
      } else if (lastLog.message?.includes('Code generation completed') && !devServerStarted) {
        // Start dev server when code generation completes
        setShouldStartDevServer(true);
      }
    }
  }, [socketExecution, socketLogs, devServerStarted]);
  
  // Handle dev server start when flag is set
  useEffect(() => {
    if (shouldStartDevServer && !devServerStarted) {
      setShouldStartDevServer(false);
      startDevServerForProject();
    }
  }, [shouldStartDevServer, devServerStarted, startDevServerForProject]);

  // Re-fetch execution when status changes to completed to get changes
  useEffect(() => {
    if (execution?.status === 'completed' && (!execution.changes || execution.changes.length === 0)) {
      fetchExecution();
    }
  }, [execution?.status]);

  useEffect(() => {
    // Fetch branch info when execution status changes
    if (execution && projectId) {
      fetchBranchInfo();
    }
  }, [execution?.status, projectId]);
  
  const handleSyncPR = async () => {
    if (!projectId || !task?.id) return;
    
    setSyncing(true);
    try {
      const response = await apiFetch(API_ENDPOINTS.workspace.syncPr, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          taskId: task.id,
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setPrStatus(data.pr);
        
        // If task status changed, reload the page to update the board
        if (data.task.status !== task.status) {
          window.location.reload();
        }
        
        console.log('PR sync successful:', data);
      } else {
        console.error('PR sync failed:', data.error);
      }
    } catch (error) {
      console.error('Error syncing PR:', error);
    } finally {
      setSyncing(false);
    }
  };

  const handleCreatePR = async () => {
    if (!projectId || !task?.id) {
      console.error('Missing projectId or taskId');
      return;
    }
    
    setCreatingPR(true);
    try {
      const response = await apiFetch(API_ENDPOINTS.workspace.pr, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          taskId: task.id,
          title: `feat: ${task.title}`,
          description: task.description
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Set PR created state
        setPrCreated(true);
        setPrUrl(data.pullRequest?.url || null);
        
        // Open the PR in a new tab
        if (data.pullRequest?.url) {
          window.open(data.pullRequest.url, '_blank');
        }
        
        console.log('PR created successfully:', data.pullRequest);
        
        // Show success message
        setCommitStatus({ 
          type: 'success', 
          message: `Pull Request created successfully! PR #${data.pullRequest?.number || ''}` 
        });
        
        // Refresh branch info
        fetchBranchInfo();
        
        // Call the onTaskUpdate callback if provided to update the task status
        if (onTaskUpdate) {
          // Update the task to show it's in review
          onTaskUpdate({
            ...task,
            status: 'inReview',
            githubPrNumber: data.pullRequest?.number,
            githubPrUrl: data.pullRequest?.url
          });
        }
      } else {
        console.error('Failed to create PR:', data.error);
        setCommitStatus({ 
          type: 'error', 
          message: data.error || 'Failed to create pull request' 
        });
      }
    } catch (error) {
      console.error('Error creating PR:', error);
      alert('Failed to create pull request. Please try again.');
    } finally {
      setCreatingPR(false);
    }
  };

  const handleCommit = async () => {
    if (!projectId) return;
    
    setCommitting(true);
    setCommitStatus({ type: null, message: '' });
    
    try {
      // Combine the base message with user's custom message
      const fullCommitMessage = commitMessage.trim() 
        ? `feat: ${task.title}\n\n${commitMessage.trim()}`
        : `feat: ${task.title}`;
      
      const response = await apiFetch(API_ENDPOINTS.workspace.commit, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          taskId: task.id,
          message: fullCommitMessage
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setShowCommitDialog(false);
        setCommitMessage('');
        setIsCommitted(true);
        setCommitStatus({ 
          type: 'success', 
          message: `Changes committed successfully! ${data.commitHash ? `(${data.commitHash.slice(0, 7)})` : ''}` 
        });
        fetchBranchInfo();
        
        // Clear success message after 5 seconds
        setTimeout(() => {
          setCommitStatus({ type: null, message: '' });
        }, 5000);
      } else {
        const error = await response.json();
        setCommitStatus({ 
          type: 'error', 
          message: error.error || 'Failed to commit changes' 
        });
      }
    } catch (error) {
      console.error('Commit error:', error);
      setCommitStatus({ 
        type: 'error', 
        message: 'Failed to commit changes. Please try again.' 
      });
    } finally {
      setCommitting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'text-green-500';
      case 'failed':
        return 'text-red-500';
      case 'running':
        return 'text-blue-500';
      default:
        return 'text-gray-500';
    }
  };

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-red-500';
      case 'warning': return 'text-yellow-500';
      case 'info': return 'text-blue-500';
      case 'success': return 'text-green-500';
      default: return 'text-gray-400';
    }
  };

  const formatTaskStatus = (status?: string) => {
    switch (status) {
      case 'done': return 'Done';
      case 'inProgress': 
        // Phase 2: Task should be in review after AI completion
        // This is a fallback display - the task should have moved to inReview status
        if (execution?.status === 'completed') {
          return 'In Review';
        }
        if (execution?.status === 'running') {
          return 'In Progress (Running...)';
        }
        return 'In Progress';
      case 'inReview': return 'In Review';
      case 'todo': return 'To Do';
      case 'backlog': return 'Backlog';
      default: return status || 'To Do';
    }
  };

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">No task selected</p>
      </div>
    );
  }

  if (loading && !execution) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="text-lg font-semibold">{task?.title || 'Untitled Task'}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-sm font-medium ${
              task?.status === 'done' ? 'text-green-500' :
              task?.status === 'inReview' ? 'text-yellow-500' : 
              task?.status === 'inProgress' && execution?.status === 'completed' ? 'text-green-500' :
              task?.status === 'inProgress' ? 'text-blue-500' : 
              getStatusColor(task?.status || 'todo')
            }`}>
              ● {formatTaskStatus(task?.status)}
            </span>
            {task?.description && (
              <span className="text-sm text-muted-foreground">{task.description}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-1 hover:bg-secondary rounded">
            <ExternalLink className="h-4 w-4" />
          </button>
          <button className="p-1 hover:bg-secondary rounded">
            <GitBranch className="h-4 w-4" />
          </button>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Task Details Section */}
      <div className="border-b">
        <button
          onClick={() => setTaskDetailsExpanded(!taskDetailsExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50"
        >
          <span className="font-medium">Task Details</span>
          {taskDetailsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        
        {taskDetailsExpanded && (
          <div className="px-4 pb-3 grid grid-cols-2 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">STARTED</span>
              <div className="font-medium">
                {execution?.startedAt ? format(new Date(execution.startedAt), 'dd/MM/yyyy HH:mm') : 
                 task?.createdAt ? format(new Date(task.createdAt), 'dd/MM/yyyy HH:mm') : 
                 format(new Date(), 'dd/MM/yyyy HH:mm')}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">AGENT</span>
              <div className="font-medium">Claude</div>
            </div>
            <div>
              <span className="text-muted-foreground">CURRENT BRANCH</span>
              <div className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                <span className="font-medium">{branchInfo?.branch || 'main'}</span>
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">MERGE STATUS</span>
              <div className="font-medium flex items-center gap-2">
                {task?.githubState === 'merged' ? (
                  <span className="text-green-500">● Merged</span>
                ) : task?.githubPrNumber ? (
                  <span className="text-yellow-500">● Not merged</span>
                ) : (
                  <span className="text-muted-foreground">● No PR</span>
                )}
                {task?.githubPrNumber && (
                  <button
                    onClick={handleSyncPR}
                    disabled={syncing}
                    className="text-xs px-2 py-0.5 border rounded hover:bg-secondary"
                  >
                    {syncing ? 'Syncing...' : 'Sync'}
                  </button>
                )}
              </div>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">WORKTREE PATH</span>
              <div className="font-mono text-xs mt-1 p-2 bg-muted rounded break-all">
                projects/{projectId}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dev Server Section */}
      <div className="border-b">
        <button
          onClick={() => setDevServerExpanded(!devServerExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50"
        >
          <div className="flex items-center gap-2">
            {devServerExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="font-medium">Dev Server</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Phase 2: Removed Create PR button - now at board level */}
            {execution?.status === 'completed' && prCreated && (
              <div className="flex items-center gap-2 px-3 py-1 text-sm text-green-500">
                <GitPullRequest className="h-3 w-3" />
                PR Created
              </div>
            )}
            {/* Show status when running */}
            {execution?.status === 'running' && (
              <div className="flex items-center gap-2 px-3 py-1 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                AI is generating code...
              </div>
            )}
            {/* Phase 2: Removed New Attempt button */}
          </div>
        </button>
        
        {devServerExpanded && (
          <div className="px-4 pb-3">
            <div className="bg-muted rounded p-3">
              {devServerUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${
                      devServerStatus === 'running' ? 'bg-green-500 animate-pulse' : 
                      devServerStatus === 'starting' ? 'bg-yellow-500 animate-pulse' :
                      devServerStatus === 'error' ? 'bg-red-500' : 'bg-gray-500'
                    }`} />
                    <span className="text-sm font-medium">
                      {devServerStatus === 'running' ? 'Dev Server Running' :
                       devServerStatus === 'starting' ? 'Starting Server...' :
                       devServerStatus === 'error' ? 'Server Error' : 'Server Stopped'}
                    </span>
                  </div>
                  {(devServerStatus === 'running' || devServerStatus === 'stopped') && (
                    <div className="flex items-center justify-between">
                      {devServerStatus === 'running' ? (
                        <>
                          <a
                            href={devServerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-400 flex items-center gap-2 font-mono text-sm"
                          >
                            {devServerUrl}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <button
                            onClick={async () => {
                              // Stop the server
                              setDevServerStatus('stopped');
                              // Keep the URL for restart
                            }}
                            className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                          >
                            Stop
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-muted-foreground">Server stopped</span>
                          <button
                            onClick={() => {
                              // Restart the server
                              setDevServerStarted(false);
                              setShouldStartDevServer(true);
                            }}
                            className="text-xs px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                          >
                            Restart
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {execution?.status === 'running' ? 
                    'Dev server will start after code generation...' : 
                    'No dev server running'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'logs' 
              ? 'border-primary text-foreground' 
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className="flex items-center gap-2">
            <Terminal className="h-4 w-4" />
            Logs
          </span>
        </button>
        <button
          onClick={() => setActiveTab('diffs')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'diffs' 
              ? 'border-primary text-foreground' 
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className="flex items-center gap-2">
            <FileCode className="h-4 w-4" />
            Diffs
            {execution?.changes && execution.changes.length > 0 && (
              <span className="bg-muted px-1.5 py-0.5 rounded text-xs">
                {execution.changes.length}
              </span>
            )}
          </span>
        </button>
      </div>

      {/* Tab Content - Using display instead of conditional rendering to prevent re-renders */}
      <div className="flex-1 overflow-auto">
        <div style={{ display: activeTab === 'logs' ? 'block' : 'none' }}>
          <div className="p-4 space-y-1 font-mono text-sm">
            {execution?.logs && execution.logs.length > 0 ? (
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
        <div style={{ display: activeTab === 'diffs' ? 'block' : 'none' }}>
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium flex items-center gap-2">
                <FileCode className="h-4 w-4" />
                {execution?.changes?.length || 0} files changed
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setExpandAllDiffs(true);
                    // Reset to undefined after a moment to allow manual control
                    setTimeout(() => setExpandAllDiffs(undefined), 100);
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Expand All
                </button>
                <button
                  onClick={() => {
                    setExpandAllDiffs(false);
                    // Reset to undefined after a moment to allow manual control
                    setTimeout(() => setExpandAllDiffs(undefined), 100);
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Collapse All
                </button>
                {/* Phase 2: Removed Commit button - now at board level */}
                {isCommitted && (
                  <span className="px-3 py-1 text-sm text-green-500">
                    ✓ Committed
                  </span>
                )}
              </div>
            </div>
            {/* Status Messages */}
            {commitStatus.type && (
              <div className={`mx-4 mb-3 p-3 rounded-md text-sm ${
                commitStatus.type === 'success' ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300' :
                'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300'
              }`}>
                {commitStatus.message}
              </div>
            )}
            
            {execution?.changes && projectId && (
              <DiffViewer 
                projectId={projectId} 
                taskId={task.id}  // V2: Pass taskId for task-specific diffs
                changes={execution.changes} 
                expandAll={expandAllDiffs}
              />
            )}
          </div>
        </div>
      </div>

      {/* Chat Section */}
      <div className="border-t p-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            placeholder="Ask a follow-up question... Type @ to search files."
            className="flex-1 px-3 py-2 text-sm border rounded-md bg-background"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && chatMessage.trim()) {
                // TODO: Implement chat functionality
                console.log('Send message:', chatMessage);
                setChatMessage('');
              }
            }}
          />
          <button 
            className="p-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            onClick={() => {
              if (chatMessage.trim()) {
                // TODO: Implement chat functionality
                console.log('Send message:', chatMessage);
                setChatMessage('');
              }
            }}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Phase 2: Removed Commit Dialog - commit functionality now at board level */}
    </div>
  );
}