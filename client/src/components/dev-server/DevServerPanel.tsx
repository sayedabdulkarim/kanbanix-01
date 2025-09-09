'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  Play, 
  Square, 
  RefreshCw, 
  ChevronUp, 
  ChevronDown,
  AlertCircle,
  CheckCircle,
  Loader2,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface DevServerPanelProps {
  projectId: string;
  projectPath: string;
  onTaskCreated?: () => void;
}

type ServerStatus = 'idle' | 'starting' | 'running' | 'error' | 'stopping';

export default function DevServerPanel({ projectId, projectPath, onTaskCreated }: DevServerPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(true); // Start collapsed
  const [serverStatus, setServerStatus] = useState<ServerStatus>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [port, setPort] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildErrors, setBuildErrors] = useState<string[]>([]);
  const [showFixTaskCreated, setShowFixTaskCreated] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (!isCollapsed && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isCollapsed]);

  // Check server status on mount
  useEffect(() => {
    checkServerStatus();
  }, [projectId]);

  const checkServerStatus = async () => {
    try {
      const response = await fetch(`/api/workspace/dev-server?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.running) {
          setServerStatus('running');
          setPort(data.port);
          setLogs(prev => [...prev, `✅ Dev server already running on port ${data.port}`]);
        }
      }
    } catch (error) {
      console.error('Error checking server status:', error);
    }
  };

  const startServer = async (skipValidation = false) => {
    setServerStatus('starting');
    setError(null);
    setBuildErrors([]);
    setShowFixTaskCreated(false);
    setLogs([skipValidation ? 'Starting development server (skipping validation)...' : 'Running build validation...']);

    try {
      const response = await fetch('/api/workspace/dev-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, skipValidation })
      });

      const data = await response.json();
      
      if (!response.ok) {
        // Check if we have build errors
        if (data.buildErrors && data.buildErrors.length > 0) {
          setBuildErrors(data.buildErrors);
          setError('Build errors detected');
          setServerStatus('error');
          setLogs(prev => [
            ...prev, 
            `❌ Dev server failed due to build errors:`,
            ...data.buildErrors.map((err: string) => `  • ${err.trim()}`).slice(0, 5),
            data.buildErrors.length > 5 ? `  ... and ${data.buildErrors.length - 5} more errors` : '',
            '',
            '💡 Click "Create Fix Task" to automatically fix these errors'
          ].filter(Boolean));
        } else {
          throw new Error(data.error || 'Failed to start server');
        }
        return;
      }
      
      if (data.success) {
        setPort(data.port);
        setServerStatus('running');
        setBuildErrors([]);
        setLogs(prev => [
          ...prev, 
          `✅ Server ${data.status === 'running' ? 'already running' : 'started'} on port ${data.port}`,
          `📦 Command: ${data.command}`,
          `🔗 URL: ${data.url}`,
          data.message || ''
        ].filter(Boolean));
        
        // If server was already running, show that info
        if (data.message?.includes('already running')) {
          setLogs(prev => [...prev, '💡 Hot-reload enabled - changes will update automatically']);
        }
      }
    } catch (error: any) {
      setError(error.message);
      setServerStatus('error');
      setLogs(prev => [...prev, `❌ Failed to start server: ${error.message}`]);
      
      // Suggest fixes based on error
      if (error.message.includes('package.json')) {
        setLogs(prev => [...prev, '💡 Tip: Make sure the project is properly initialized']);
      } else if (error.message.includes('dependencies')) {
        setLogs(prev => [...prev, '💡 Tip: Try running "npm install" first']);
      }
    }
  };

  const stopServer = async () => {
    setServerStatus('stopping');
    setLogs(prev => [...prev, 'Stopping server...']);

    try {
      const response = await fetch(`/api/workspace/dev-server?projectId=${projectId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to stop server');
      }

      setServerStatus('idle');
      setPort(null);
      setLogs(prev => [...prev, '✅ Server stopped']);
    } catch (error: any) {
      setError(error.message);
      setLogs(prev => [...prev, `❌ Error stopping server: ${error.message}`]);
    }
  };

  const restartServer = async () => {
    await stopServer();
    setTimeout(() => startServer(), 1000);
  };

  const openInBrowser = () => {
    if (port) {
      window.open(`http://localhost:${port}`, '_blank');
    }
  };

  const createFixTask = async () => {
    if (buildErrors.length === 0) return;
    
    setIsCreatingTask(true);
    
    try {
      // Get project details first
      const projectResponse = await fetch(`/api/projects/${projectId}`);
      if (!projectResponse.ok) throw new Error('Failed to fetch project');
      const project = await projectResponse.json();
      
      // Find the TODO column
      const todoColumn = project.columns.find((col: any) => 
        col.name.toLowerCase().includes('todo') || 
        col.name.toLowerCase().includes('to do')
      );
      
      if (!todoColumn) {
        throw new Error('Could not find TODO column');
      }
      
      // Micro Agent style prompt - minimal and focused
      const errorDescription = `The following build failed:

${buildErrors.map((err, i) => `${i + 1}. ${err.trim()}`).join('\n\n')}

Please fix the code to make the build pass.
Only fix the errors shown above. Do not create new directories.
The project uses the app directory (Next.js 13+).`;

      // Create the task
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Fix build errors for dev server',
          description: errorDescription,
          columnId: todoColumn.id,
          projectId: projectId,
          priority: 'high',
          status: 'todo'
        })
      });
      
      if (!response.ok) throw new Error('Failed to create task');
      
      const newTask = await response.json();
      
      // Show success message
      setShowFixTaskCreated(true);
      setLogs(prev => [
        ...prev,
        '',
        '✅ Fix task created successfully!',
        '→ Move the task to "In Progress" to start fixing',
        '→ After completion, try running the server again'
      ]);
      
      // Notify parent component to refresh the board
      if (onTaskCreated) {
        onTaskCreated();
      }
      
      // Hide the message after 5 seconds
      setTimeout(() => setShowFixTaskCreated(false), 5000);
      
    } catch (error: any) {
      console.error('Error creating fix task:', error);
      setLogs(prev => [...prev, `❌ Failed to create fix task: ${error.message}`]);
    } finally {
      setIsCreatingTask(false);
    }
  };

  const getStatusIcon = () => {
    switch (serverStatus) {
      case 'idle':
        return <Terminal className="h-4 w-4" />;
      case 'starting':
      case 'stopping':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'running':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusColor = () => {
    switch (serverStatus) {
      case 'running':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      case 'starting':
      case 'stopping':
        return 'text-yellow-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className={cn(
      "fixed bottom-0 left-0 right-0 z-40 bg-background border-t border-border transition-all duration-300",
      isCollapsed ? "h-12" : "h-80"
    )}>
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border bg-secondary/50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="font-medium text-sm">Dev Server</span>
            <span className={cn("text-xs", getStatusColor())}>
              {serverStatus === 'running' && port ? `Port ${port}` : serverStatus}
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {serverStatus === 'idle' && (
              <button
                onClick={() => startServer()}
                className="p-1.5 rounded hover:bg-secondary transition-colors"
                title="Start server"
              >
                <Play className="h-4 w-4" />
              </button>
            )}
            
            {serverStatus === 'running' && (
              <>
                <button
                  onClick={stopServer}
                  className="p-1.5 rounded hover:bg-secondary transition-colors"
                  title="Stop server"
                >
                  <Square className="h-4 w-4" />
                </button>
                <button
                  onClick={restartServer}
                  className="p-1.5 rounded hover:bg-secondary transition-colors"
                  title="Restart server"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  onClick={openInBrowser}
                  className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Open in Browser
                </button>
              </>
            )}

            {serverStatus === 'error' && (
              <>
                <button
                  onClick={() => startServer()}
                  className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
                >
                  Retry
                </button>
                {buildErrors.length > 0 && (
                  <>
                    <button
                      onClick={createFixTask}
                      disabled={isCreatingTask}
                      className="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                    >
                      {isCreatingTask ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        '🔧 Create Fix Task'
                      )}
                    </button>
                    <button
                      onClick={() => startServer(true)}
                      className="px-2 py-1 text-xs rounded bg-yellow-600 text-white hover:bg-yellow-700"
                      title="Start server without build validation"
                    >
                      ⚡ Skip Validation
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        
        {/* Success message when task is created */}
        {showFixTaskCreated && (
          <div className="absolute top-2 right-12 bg-green-500 text-white px-3 py-1 rounded-md text-xs animate-fade-in">
            ✅ Fix task created in TODO column!
          </div>
        )}

        {/* Collapse/Expand Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 rounded hover:bg-secondary transition-colors"
        >
          {isCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Logs Area */}
      {!isCollapsed && (
        <div className="h-[calc(100%-3rem)] overflow-y-auto bg-black/90 text-green-400 font-mono text-xs p-4">
          {logs.map((log, index) => (
            <div key={index} className="mb-1">
              {log}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}