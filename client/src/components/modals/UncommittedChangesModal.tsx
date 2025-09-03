'use client';

import { useState } from 'react';
import { AlertTriangle, GitBranch, X } from 'lucide-react';
import { Task } from '@/types/project';

interface UncommittedChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  uncommittedTasks: Task[];
  hasUncommittedChanges: boolean;
}

export default function UncommittedChangesModal({
  isOpen,
  onClose,
  onConfirm,
  uncommittedTasks,
  hasUncommittedChanges
}: UncommittedChangesModalProps) {
  const [understanding, setUnderstanding] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (understanding) {
      onConfirm();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      
      <div className="relative bg-background border border-border rounded-lg shadow-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-background border-b border-border p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Tasks In Progress</h2>
                <p className="text-sm text-muted-foreground">
                  You have tasks with uncommitted work
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-secondary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Warning Message */}
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              <strong>Warning:</strong> Tasks in progress will lose their uncommitted changes and be reset to TODO status.
            </p>
          </div>

          {/* In Progress Tasks List */}
          {uncommittedTasks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <GitBranch className="h-4 w-4" />
                Tasks in progress ({uncommittedTasks.length})
              </h3>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {uncommittedTasks.map(task => (
                  <div 
                    key={task.id} 
                    className="flex items-center justify-between p-2 rounded bg-secondary/50 text-sm"
                  >
                    <span className="font-medium truncate flex-1">{task.title}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      task.status === 'done' ? 'bg-green-500/20 text-green-600' :
                      task.status === 'inReview' ? 'bg-yellow-500/20 text-yellow-600' :
                      'bg-blue-500/20 text-blue-600'
                    }`}>
                      {task.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* What will happen */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">What will happen:</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-start gap-2">
                <span className="text-red-500 mt-0.5">✕</span>
                <span>Tasks in progress will <strong className="text-foreground">lose all uncommitted changes</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-yellow-500 mt-0.5">⚠</span>
                <span>The workspace <strong className="text-foreground">may be removed</strong> if no saved changes exist</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">→</span>
                <span>In Progress tasks will be <strong className="text-foreground">reset to TODO</strong> status</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Tasks in "Done" and "In Review" will <strong className="text-foreground">keep their saved changes</strong></span>
              </li>
            </ul>
          </div>

          {/* Recommendation */}
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <p className="text-sm text-green-600 dark:text-green-400">
              <strong>Recommended:</strong> Move tasks to "In Review" to save their changes before ending the session.
            </p>
          </div>

          {/* Confirmation Checkbox */}
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              id="understand"
              checked={understanding}
              onChange={(e) => setUnderstanding(e.target.checked)}
              className="mt-1"
            />
            <label htmlFor="understand" className="text-sm text-muted-foreground">
              I understand that all uncommitted changes will be permanently lost and cannot be recovered.
            </label>
          </div>
        </div>

        <div className="sticky bottom-0 bg-background border-t border-border p-4">
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-input hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!understanding}
              className="flex-1 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Delete Workspace & End Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}