'use client';

import { useState, useEffect } from 'react';
import { X, GitCommit, AlertCircle } from 'lucide-react';
import { Task } from '@/types/project';

interface CommitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCommit: (message: string) => Promise<void>;
  tasksToCommit: Task[];
  projectName: string;
  isLoading?: boolean;
}

export default function CommitModal({
  isOpen,
  onClose,
  onCommit,
  tasksToCommit,
  projectName,
  isLoading = false
}: CommitModalProps) {
  const [commitMessage, setCommitMessage] = useState('');
  const [error, setError] = useState('');
  
  // Generate default commit message
  useEffect(() => {
    if (tasksToCommit.length > 0) {
      const taskTitles = tasksToCommit.map(t => `- ${t.title}`).join('\n');
      const defaultMessage = tasksToCommit.length === 1
        ? `feat: ${tasksToCommit[0].title}`
        : `feat: Complete ${tasksToCommit.length} tasks\n\n${taskTitles}`;
      console.log('Setting default message:', defaultMessage);
      setCommitMessage(defaultMessage);
    }
  }, [tasksToCommit]);

  // Debug state
  useEffect(() => {
    console.log('CommitModal state:', {
      isOpen,
      commitMessage,
      messageLength: commitMessage.length,
      trimmedLength: commitMessage.trim().length,
      isLoading,
      tasksCount: tasksToCommit.length,
      buttonDisabled: isLoading || !commitMessage.trim()
    });
  }, [isOpen, commitMessage, isLoading, tasksToCommit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('CommitModal: handleSubmit called with message:', commitMessage);
    setError('');
    
    if (!commitMessage.trim()) {
      setError('Commit message is required');
      return;
    }
    
    if (commitMessage.length < 3) {
      setError('Commit message must be at least 3 characters');
      return;
    }
    
    try {
      console.log('CommitModal: Calling onCommit with message:', commitMessage);
      await onCommit(commitMessage);
      onClose();
    } catch (err: any) {
      console.error('CommitModal: Error during commit:', err);
      setError(err.message || 'Failed to commit changes');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <GitCommit className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Commit Changes</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-1 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content - Form spans content and footer */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Tasks to commit */}
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Tasks to be committed ({tasksToCommit.length})
              </label>
              <div className="bg-secondary/50 rounded-lg p-3 space-y-2 max-h-32 overflow-y-auto">
                {tasksToCommit.map(task => (
                  <div key={task.id} className="flex items-center gap-2 text-sm">
                    <div className="w-2 h-2 bg-green-500 rounded-full" />
                    <span>{task.title}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Commit message */}
            <div>
              <label htmlFor="commit-message" className="text-sm font-medium text-muted-foreground mb-2 block">
                Commit message
              </label>
              <textarea
                id="commit-message"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                className="w-full h-32 px-3 py-2 bg-background border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Enter commit message..."
                disabled={isLoading}
                autoFocus
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-muted-foreground">
                  {commitMessage.length} characters
                </span>
                <span className="text-xs text-muted-foreground">
                  Use conventional commits (feat:, fix:, docs:, etc.)
                </span>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                <span className="text-sm text-red-500">{error}</span>
              </div>
            )}
          </div>

          {/* Footer - inside form */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-sm rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              onClick={(e) => {
                console.log('Submit button clicked');
                handleSubmit(e);
              }}
              disabled={isLoading || !commitMessage.trim()}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Committing...
                </>
              ) : (
                <>
                  <GitCommit className="h-4 w-4" />
                  Commit Changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}