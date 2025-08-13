'use client';

import { useEffect, useState } from 'react';
import { X, Terminal, CheckCircle, XCircle, Loader2, Clock, FileCode } from 'lucide-react';
import { format } from 'date-fns';
import { useExecutionSocket } from '@/lib/socket/useSocket';

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
  onClose: () => void;
}

export default function AgentExecutionPanel({ taskId, onClose }: AgentExecutionPanelProps) {
  const [execution, setExecution] = useState<AgentExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [executionId, setExecutionId] = useState<string | null>(null);
  
  // Use WebSocket for real-time updates
  const { execution: socketExecution, logs: socketLogs } = useExecutionSocket(executionId);

  // Initial fetch to get execution ID
  useEffect(() => {
    fetchInitialExecution();
  }, [taskId]);

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
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
          </div>
          <div className="text-sm text-muted-foreground">
            Started: {format(new Date(execution.startedAt), 'HH:mm:ss')}
            {execution.completedAt && (
              <> • Completed: {format(new Date(execution.completedAt), 'HH:mm:ss')}</>
            )}
          </div>
        </div>
        
        {/* Progress Bar */}
        {execution.status === 'running' && execution.progress !== undefined && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{execution.currentStep || 'Processing...'}</span>
              <span className="font-medium">{execution.progress}%</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-500 ease-out"
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

      {/* Changes */}
      {execution.changes && execution.changes.length > 0 && (
        <div className="p-4 border-b">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <FileCode className="h-4 w-4" />
            Changes ({execution.changes.length} files)
          </h4>
          <div className="space-y-2">
            {execution.changes.map((change: any, index: number) => (
              <div key={index} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded">
                <span className="font-mono">{change.path}</span>
                <span className={`px-2 py-1 rounded text-xs ${
                  change.type === 'created' ? 'bg-green-500/20 text-green-500' :
                  change.type === 'modified' ? 'bg-blue-500/20 text-blue-500' :
                  'bg-red-500/20 text-red-500'
                }`}>
                  {change.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
    </div>
  );
}