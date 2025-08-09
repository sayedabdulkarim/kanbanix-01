'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Task, LogEntry, ErrorEntry } from '@/types/project';
import { cn } from '@/lib/utils/cn';
import { format } from 'date-fns';
import { 
  Terminal, Search, Copy, Trash2, AlertCircle, 
  ChevronDown, ChevronUp, Zap
} from 'lucide-react';

interface LogsTabProps {
  task: Task;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
}

export default function LogsTab({ task, onUpdateTask }: LogsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [logLevel, setLogLevel] = useState<'all' | 'info' | 'warning' | 'error' | 'debug'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const logsEndRef = useRef<HTMLDivElement>(null);

  const logs = useMemo(() => task.metadata?.logs || [], [task.metadata?.logs]);
  const errors = useMemo(() => task.metadata?.errors || [], [task.metadata?.errors]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.message.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLevel = logLevel === 'all' || log.level === logLevel;
    return matchesSearch && matchesLevel;
  });

  const handleAddSampleLogs = () => {
    const sampleLogs: LogEntry[] = [
      {
        id: `log-${Date.now()}-1`,
        timestamp: new Date(),
        level: 'info',
        message: 'Starting development server...',
      },
      {
        id: `log-${Date.now()}-2`,
        timestamp: new Date(),
        level: 'info',
        message: 'Compiled successfully!',
      },
      {
        id: `log-${Date.now()}-3`,
        timestamp: new Date(),
        level: 'warning',
        message: 'Warning: Each child in a list should have a unique "key" prop.',
        details: 'Check the render method of `TaskCard`.',
      },
      {
        id: `log-${Date.now()}-4`,
        timestamp: new Date(),
        level: 'error',
        message: 'TypeError: Cannot read property \'id\' of undefined',
        details: 'at TaskCard.tsx:45:23',
      },
      {
        id: `log-${Date.now()}-5`,
        timestamp: new Date(),
        level: 'info',
        message: 'Hot Module Replacement enabled.',
      },
    ];

    const sampleErrors: ErrorEntry[] = [
      {
        id: `error-${Date.now()}-1`,
        type: 'type',
        message: 'Cannot read property \'id\' of undefined',
        file: 'TaskCard.tsx',
        line: 45,
        column: 23,
        suggestion: 'Add optional chaining: task?.id',
        confidence: 95,
        timestamp: new Date(),
      },
    ];

    onUpdateTask(task.id, {
      metadata: {
        ...task.metadata,
        logs: [...logs, ...sampleLogs],
        errors: [...errors, ...sampleErrors],
      },
    });
  };

  const handleClearLogs = () => {
    onUpdateTask(task.id, {
      metadata: {
        ...task.metadata,
        logs: [],
        errors: [],
      },
    });
  };

  const handleCopyLogs = () => {
    const logsText = filteredLogs
      .map(log => `[${format(new Date(log.timestamp), 'HH:mm:ss')}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');
    navigator.clipboard.writeText(logsText);
  };

  const handleFixError = (error: ErrorEntry) => {
    alert(`Applying fix: ${error.suggestion}\nFile: ${error.file}:${error.line}:${error.column}`);
    // In a real app, this would apply the fix to the code
  };

  const toggleErrorExpanded = (errorId: string) => {
    const newExpanded = new Set(expandedErrors);
    if (newExpanded.has(errorId)) {
      newExpanded.delete(errorId);
    } else {
      newExpanded.add(errorId);
    }
    setExpandedErrors(newExpanded);
  };

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-red-500';
      case 'warning': return 'text-yellow-500';
      case 'info': return 'text-blue-500';
      case 'debug': return 'text-gray-500';
      default: return 'text-foreground';
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
            />
          </div>
          
          <select
            value={logLevel}
            onChange={(e) => setLogLevel(e.target.value as 'all' | 'info' | 'warning' | 'error' | 'debug')}
            className="px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>

          <button
            onClick={() => setShowTimestamps(!showTimestamps)}
            className={cn(
              "p-2 rounded-lg border transition-colors",
              showTimestamps ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-secondary"
            )}
            title="Toggle timestamps"
          >
            <Terminal className="h-4 w-4" />
          </button>

          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              "p-2 rounded-lg border transition-colors",
              autoScroll ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-secondary"
            )}
            title="Auto-scroll"
          >
            <ChevronDown className="h-4 w-4" />
          </button>

          <button
            onClick={handleCopyLogs}
            className="p-2 rounded-lg border border-input hover:bg-secondary transition-colors"
            title="Copy logs"
          >
            <Copy className="h-4 w-4" />
          </button>

          <button
            onClick={handleClearLogs}
            className="p-2 rounded-lg border border-input hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Clear logs"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {errors.length > 0 && (
          <div className="space-y-2">
            {errors.map((error) => (
              <div
                key={error.id}
                className="p-3 rounded-lg bg-destructive/10 border border-destructive/20"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-destructive" />
                      <span className="text-sm font-medium text-destructive">
                        {error.type.charAt(0).toUpperCase() + error.type.slice(1)} Error
                      </span>
                      {error.file && (
                        <span className="text-xs text-muted-foreground">
                          {error.file}:{error.line}:{error.column}
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-1">{error.message}</p>
                    {expandedErrors.has(error.id) && error.suggestion && (
                      <div className="mt-2 p-2 rounded bg-background/50">
                        <p className="text-xs text-muted-foreground mb-1">Suggested Fix:</p>
                        <p className="text-sm font-mono">{error.suggestion}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => handleFixError(error)}
                            className="px-2 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1"
                          >
                            <Zap className="h-3 w-3" />
                            Apply Fix
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {error.confidence}% confidence
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => toggleErrorExpanded(error.id)}
                    className="p-1 hover:bg-background rounded"
                  >
                    {expandedErrors.has(error.id) ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 font-mono text-sm bg-black/5 dark:bg-black/20">
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Terminal className="h-8 w-8 mb-2" />
            <p>No logs yet</p>
            <button
              onClick={handleAddSampleLogs}
              className="mt-2 text-primary hover:underline text-sm"
            >
              Add sample logs
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                className={cn(
                  "flex items-start gap-2 hover:bg-background/50 px-2 py-1 rounded",
                  log.level === 'error' && "bg-destructive/5"
                )}
              >
                {showTimestamps && (
                  <span className="text-muted-foreground text-xs">
                    [{format(new Date(log.timestamp), 'HH:mm:ss.SSS')}]
                  </span>
                )}
                <span className={cn("text-xs uppercase", getLogLevelColor(log.level))}>
                  [{log.level}]
                </span>
                <span className="flex-1">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}