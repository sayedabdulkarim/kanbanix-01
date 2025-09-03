'use client';

import { useState, useEffect } from 'react';
import { Task, DiffEntry, TaskDiff, FileDiff } from '@/types/project';
import { cn } from '@/lib/utils/cn';
import { format } from 'date-fns';
import { 
  GitBranch, FileText, ChevronDown, 
  ChevronRight, Copy, ToggleLeft, ToggleRight,
  Clock, AlertCircle 
} from 'lucide-react';

interface DiffsTabProps {
  task: Task;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
}

export default function DiffsTab({ task, onUpdateTask }: DiffsTabProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [taskDiffs, setTaskDiffs] = useState<TaskDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  // Legacy diffs from metadata (for backward compatibility)
  const metadataDiffs = task.metadata?.diffs || [];

  // Fetch diffs from database
  useEffect(() => {
    const fetchDiffs = async () => {
      // Only fetch if task has commitSha or diffs stored
      if (!task.diffs && !task.commitSha) return;
      
      setLoading(true);
      try {
        // First try to parse diffs from task object (already fetched from DB)
        if (task.diffs) {
          const parsedDiffs = JSON.parse(task.diffs);
          setTaskDiffs(parsedDiffs);
          // Select latest version by default
          if (parsedDiffs.length > 0) {
            setSelectedVersion(parsedDiffs[parsedDiffs.length - 1].version);
          }
        } else if (task.commitSha) {
          // If no diffs but has commitSha, try to fetch from API
          const response = await fetch(`/api/tasks/${task.id}/diffs`);
          if (response.ok) {
            const data = await response.json();
            if (data.diffs) {
              const parsedDiffs = JSON.parse(data.diffs);
              setTaskDiffs(parsedDiffs);
              if (parsedDiffs.length > 0) {
                setSelectedVersion(parsedDiffs[parsedDiffs.length - 1].version);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error fetching diffs:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDiffs();
  }, [task.id, task.diffs, task.commitSha]);

  // Get the selected version's diff or all diffs
  const currentDiff = selectedVersion 
    ? taskDiffs.find(d => d.version === selectedVersion)
    : taskDiffs[taskDiffs.length - 1];

  const handleAddSampleDiffs = () => {
    const sampleDiffs: DiffEntry[] = [
      {
        id: `diff-${Date.now()}-1`,
        fileName: 'TaskCard.tsx',
        filePath: 'src/components/kanban/TaskCard.tsx',
        additions: 15,
        deletions: 8,
        changes: `@@ -42,10 +42,17 @@ export default function TaskCard({ task, onEdit, onDelete }: TaskCardProps) {
-  const handleClick = () => {
-    // Old implementation
-    console.log('Task clicked');
-  };
+  const handleClick = () => {
+    // New implementation with proper handling
+    if (onEdit) {
+      onEdit(task);
+    }
+  };
+
+  const getPriorityIcon = (priority?: string) => {
+    switch (priority) {
+      case 'high': return <AlertCircle className="h-3 w-3" />;
+      case 'medium': return <Clock className="h-3 w-3" />;
+      case 'low': return <CheckCircle className="h-3 w-3" />;
+      default: return null;
+    }
+  };`,
        timestamp: new Date(),
      },
      {
        id: `diff-${Date.now()}-2`,
        fileName: 'useTaskStore.ts',
        filePath: 'src/lib/store/useTaskStore.ts',
        additions: 22,
        deletions: 5,
        changes: `@@ -15,7 +15,24 @@ export const useTaskStore = create<TaskStore>()(
-      tasks: [],
+      tasks: [],
+      
+      addTask: (taskData) => {
+        const newTask: Task = {
+          ...taskData,
+          id: \`task-\${Date.now()}-\${Math.random().toString(36).substr(2, 9)}\`,
+          createdAt: new Date(),
+          modifiedAt: new Date(),
+        };
+        
+        set((state) => ({
+          tasks: [...state.tasks, newTask],
+        }));
+      },`,
        timestamp: new Date(Date.now() - 1000 * 60 * 5), // 5 minutes ago
      },
    ];

    onUpdateTask(task.id, {
      metadata: {
        ...task.metadata,
        diffs: [...metadataDiffs, ...sampleDiffs],
      },
    });
  };

  const toggleFileExpanded = (fileId: string) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(fileId)) {
      newExpanded.delete(fileId);
    } else {
      newExpanded.add(fileId);
    }
    setExpandedFiles(newExpanded);
  };

  const handleCopyDiff = (changes: string) => {
    navigator.clipboard.writeText(changes);
  };

  const getTotalStats = () => {
    // If we have task diffs from DB, use those
    if (currentDiff) {
      return {
        additions: currentDiff.totalAdditions,
        deletions: currentDiff.totalDeletions,
        files: currentDiff.files.length
      };
    }
    
    // Fallback to metadata diffs
    return metadataDiffs.reduce(
      (acc, diff) => ({
        additions: acc.additions + diff.additions,
        deletions: acc.deletions + diff.deletions,
        files: acc.files + 1,
      }),
      { additions: 0, deletions: 0, files: 0 }
    );
  };

  const stats = getTotalStats();

  const renderDiffLine = (line: string, index: number) => {
    const isAddition = line.startsWith('+') && !line.startsWith('+++');
    const isDeletion = line.startsWith('-') && !line.startsWith('---');
    const isContext = line.startsWith('@@');

    return (
      <div
        key={index}
        className={cn(
          "px-2 py-0.5 font-mono text-xs",
          isAddition && "bg-green-500/10 text-green-600 dark:text-green-400",
          isDeletion && "bg-red-500/10 text-red-600 dark:text-red-400",
          isContext && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
          !isAddition && !isDeletion && !isContext && "text-muted-foreground"
        )}
      >
        <span className="select-none mr-2 opacity-50">{index + 1}</span>
        {line}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {stats.files} file{stats.files !== 1 ? 's' : ''} changed
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-green-600 dark:text-green-400">
                +{stats.additions}
              </span>
              <span className="text-red-600 dark:text-red-400">
                -{stats.deletions}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode(viewMode === 'unified' ? 'split' : 'unified')}
              className="p-2 rounded-lg border border-input hover:bg-secondary transition-colors"
              title={`Switch to ${viewMode === 'unified' ? 'split' : 'unified'} view`}
            >
              {viewMode === 'unified' ? (
                <ToggleLeft className="h-4 w-4" />
              ) : (
                <ToggleRight className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {(task.metadata?.branch || task.githubBranch) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            <span>Branch:</span>
            <code className="px-2 py-0.5 rounded bg-secondary text-xs">
              {task.metadata?.branch || task.githubBranch}
            </code>
          </div>
        )}
        
        {task.commitSha && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
            <span>Commit:</span>
            <code className="px-2 py-0.5 rounded bg-secondary text-xs">
              {task.commitSha}
            </code>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-muted-foreground">Loading diffs...</div>
          </div>
        ) : taskDiffs.length > 0 ? (
          // Display task diffs from database
          <div>
            {/* Version selector if multiple versions exist */}
            {taskDiffs.length > 1 && (
              <div className="p-3 border-b border-border bg-secondary/30">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Diff History</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {taskDiffs.map((diff) => (
                    <button
                      key={diff.id}
                      onClick={() => setSelectedVersion(diff.version)}
                      className={cn(
                        "px-3 py-1 rounded-md text-xs transition-colors",
                        selectedVersion === diff.version
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary hover:bg-secondary/80"
                      )}
                    >
                      v{diff.version} - {diff.type}
                      <span className="ml-1 opacity-75">
                        ({format(new Date(diff.timestamp), 'MMM d, HH:mm')})
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {/* Display warning if task was affected by other tasks */}
            {task.affectedByTasks && (
              <div className="p-3 bg-yellow-500/10 border-b border-yellow-500/20">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">
                      This task was affected by follow-up changes
                    </p>
                    <p className="text-muted-foreground mt-1">
                      Task IDs: {task.affectedByTasks}
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            {/* Display files from selected diff version */}
            {currentDiff && (
              <div className="divide-y divide-border">
                {currentDiff.files.map((file) => (
                  <div key={`${file.filePath}-${currentDiff.version}`} className="bg-card">
                    <div
                      className="flex items-center justify-between p-3 hover:bg-secondary/50 cursor-pointer"
                      onClick={() => toggleFileExpanded(`${file.filePath}-${currentDiff.version}`)}
                    >
                      <div className="flex items-center gap-2">
                        {expandedFiles.has(`${file.filePath}-${currentDiff.version}`) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono text-sm">{file.fileName}</span>
                        <span className="text-xs text-muted-foreground">
                          {file.filePath}
                        </span>
                        <span className={cn(
                          "text-xs px-2 py-0.5 rounded",
                          file.status === 'added' && "bg-green-500/20 text-green-600",
                          file.status === 'modified' && "bg-blue-500/20 text-blue-600",
                          file.status === 'deleted' && "bg-red-500/20 text-red-600"
                        )}>
                          {file.status}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-green-600 dark:text-green-400">
                            +{file.additions}
                          </span>
                          <span className="text-red-600 dark:text-red-400">
                            -{file.deletions}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyDiff(file.changes);
                          }}
                          className="p-1 rounded hover:bg-secondary"
                          title="Copy diff"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    
                    {expandedFiles.has(`${file.filePath}-${currentDiff.version}`) && (
                      <div className="border-t border-border bg-black/5 dark:bg-black/20 overflow-x-auto">
                        {file.changes.split('\n').map((line, index) => renderDiffLine(line, index))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : metadataDiffs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
            <GitBranch className="h-8 w-8 mb-2" />
            <p>No changes yet</p>
            {task.status === 'todo' && (
              <button
                onClick={handleAddSampleDiffs}
                className="mt-2 text-primary hover:underline text-sm"
              >
                Add sample diffs
              </button>
            )}
          </div>
        ) : (
          // Fallback to legacy metadata diffs
          <div className="divide-y divide-border">
            {metadataDiffs.map((diff) => (
              <div key={diff.id} className="bg-card">
                <div
                  className="flex items-center justify-between p-3 hover:bg-secondary/50 cursor-pointer"
                  onClick={() => toggleFileExpanded(diff.id)}
                >
                  <div className="flex items-center gap-2">
                    {expandedFiles.has(diff.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-sm">{diff.fileName}</span>
                    <span className="text-xs text-muted-foreground">
                      {diff.filePath}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-green-600 dark:text-green-400">
                        +{diff.additions}
                      </span>
                      <span className="text-red-600 dark:text-red-400">
                        -{diff.deletions}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyDiff(diff.changes);
                      }}
                      className="p-1 rounded hover:bg-secondary"
                      title="Copy diff"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(diff.timestamp), 'MMM d, HH:mm')}
                    </span>
                  </div>
                </div>
                
                {expandedFiles.has(diff.id) && (
                  <div className="border-t border-border bg-black/5 dark:bg-black/20 overflow-x-auto">
                    {diff.changes.split('\n').map((line, index) => renderDiffLine(line, index))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}