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
}

type ServerStatus = 'idle' | 'starting' | 'running' | 'error' | 'stopping';

export default function DevServerPanel({ projectId, projectPath }: DevServerPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(true); // Start collapsed
  const [serverStatus, setServerStatus] = useState<ServerStatus>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [port, setPort] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  
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

  const startServer = async () => {
    setServerStatus('starting');
    setError(null);
    setLogs(['Starting development server...']);

    try {
      const response = await fetch('/api/workspace/dev-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start server');
      }

      const data = await response.json();
      
      if (data.success) {
        setPort(data.port);
        setServerStatus('running');
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
                onClick={startServer}
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
              <button
                onClick={startServer}
                className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
              >
                Retry
              </button>
            )}
          </div>
        </div>

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