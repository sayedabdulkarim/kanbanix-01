'use client';

import { useState } from 'react';
import { Task, DiffEntry } from '@/types/project';
import { cn } from '@/lib/utils/cn';
import { format } from 'date-fns';
import { 
  GitBranch, FileText, ChevronDown, 
  ChevronRight, Copy, ToggleLeft, ToggleRight 
} from 'lucide-react';

interface DiffsTabProps {
  task: Task;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
}

export default function DiffsTab({ task, onUpdateTask }: DiffsTabProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');

  const diffs = task.metadata?.diffs || [];

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
        diffs: [...diffs, ...sampleDiffs],
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

  const handleCopyDiff = (diff: DiffEntry) => {
    navigator.clipboard.writeText(diff.changes);
  };

  const getTotalStats = () => {
    return diffs.reduce(
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

        {task.metadata?.branch && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <GitBranch className="h-3 w-3" />
            <span>Branch:</span>
            <code className="px-2 py-0.5 rounded bg-secondary text-xs">
              {task.metadata.branch}
            </code>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {diffs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
            <GitBranch className="h-8 w-8 mb-2" />
            <p>No changes yet</p>
            <button
              onClick={handleAddSampleDiffs}
              className="mt-2 text-primary hover:underline text-sm"
            >
              Add sample diffs
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {diffs.map((diff) => (
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
                        handleCopyDiff(diff);
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