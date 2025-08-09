'use client';

import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { 
  X, Clock, Calendar, User, Tag, 
  GitBranch, Link2, Play, Square, FileText,
  MessageSquare, Activity as ActivityIcon
} from 'lucide-react';
import { Task } from '@/types/project';
import { cn } from '@/lib/utils/cn';
import { format } from 'date-fns';
import LogsTab from './tabs/LogsTab';
import DiffsTab from './tabs/DiffsTab';
import CommentsTab from './tabs/CommentsTab';
import ActivityTab from './tabs/ActivityTab';

interface TaskDetailsPanelProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onDeleteTask?: (taskId: string) => void;
}

export default function TaskDetailsPanel({
  task,
  open,
  onOpenChange,
  onUpdateTask,
  onDeleteTask,
}: TaskDetailsPanelProps) {
  const [activeTab, setActiveTab] = useState('logs');
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');

  useEffect(() => {
    if (task) {
      setEditedTitle(task.title);
      setEditedDescription(task.description || '');
    }
  }, [task]);

  if (!task) return null;

  const handleSaveEdit = () => {
    onUpdateTask(task.id, {
      title: editedTitle,
      description: editedDescription,
    });
    setIsEditing(false);
  };

  const handleStopDev = () => {
    onUpdateTask(task.id, {
      metadata: {
        ...task.metadata,
        activities: [
          ...(task.metadata?.activities || []),
          {
            id: `activity-${Date.now()}`,
            type: 'updated',
            description: 'Development stopped',
            timestamp: new Date(),
            user: 'Current User',
          },
        ],
      },
    });
  };

  const handleCreatePR = () => {
    const prUrl = `https://github.com/project/pull/new/${task.metadata?.branch || 'main'}`;
    onUpdateTask(task.id, {
      metadata: {
        ...task.metadata,
        prUrl,
        activities: [
          ...(task.metadata?.activities || []),
          {
            id: `activity-${Date.now()}`,
            type: 'updated',
            description: 'Pull request created',
            timestamp: new Date(),
            user: 'Current User',
            details: { prUrl },
          },
        ],
      },
    });
  };

  const getStatusColor = (status: string) => {
    const colors = {
      todo: 'bg-gray-500',
      inProgress: 'bg-blue-500',
      inReview: 'bg-yellow-500',
      done: 'bg-green-500',
      cancelled: 'bg-red-500',
    };
    return colors[status as keyof typeof colors] || 'bg-gray-500';
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high': return 'text-destructive';
      case 'medium': return 'text-accent';
      case 'low': return 'text-muted-foreground';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in" />
        <Dialog.Content className="fixed right-0 top-0 h-full w-[600px] bg-card shadow-xl animate-in slide-in-from-right overflow-hidden flex flex-col">
          <div className="p-6 border-b border-border">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                {isEditing ? (
                  <input
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    className="text-2xl font-semibold bg-transparent border-b border-input focus:outline-none focus:border-primary w-full"
                  />
                ) : (
                  <h2 className="text-2xl font-semibold">{task.title}</h2>
                )}
                <div className="flex items-center gap-3 mt-2">
                  <span className={cn("px-2 py-1 rounded text-xs text-white", getStatusColor(task.status))}>
                    {task.status.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                  {task.priority && (
                    <span className={cn("text-sm", getPriorityColor(task.priority))}>
                      {task.priority} priority
                    </span>
                  )}
                  <span className="text-sm text-muted-foreground">#{task.id.slice(-6)}</span>
                </div>
              </div>
              
              <Dialog.Close className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100">
                <X className="h-5 w-5" />
                <span className="sr-only">Close</span>
              </Dialog.Close>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Created:</span>
                  <span>{format(new Date(task.createdAt), 'MMM d, yyyy')}</span>
                </div>
                {task.startedAt && (
                  <div className="flex items-center gap-2">
                    <Play className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Started:</span>
                    <span>{format(new Date(task.startedAt), 'MMM d, yyyy')}</span>
                  </div>
                )}
                {task.dueDate && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Due:</span>
                    <span>{format(new Date(task.dueDate), 'MMM d, yyyy')}</span>
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                {task.assignee && (
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Assignee:</span>
                    <span>{task.assignee}</span>
                  </div>
                )}
                {task.metadata?.branch && (
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Branch:</span>
                    <span className="font-mono text-xs">{task.metadata.branch}</span>
                  </div>
                )}
                {task.timeSpent && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Time spent:</span>
                    <span>{task.timeSpent}h / {task.timeEstimate || '?'}h</span>
                  </div>
                )}
              </div>
            </div>

            {task.labels && task.labels.length > 0 && (
              <div className="flex items-center gap-2 mt-3">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <div className="flex flex-wrap gap-1">
                  {task.labels.map((label) => (
                    <span
                      key={label}
                      className="px-2 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="px-6 py-3 border-b border-border bg-secondary/50">
            <div className="flex gap-2">
              <button
                onClick={handleStopDev}
                className="px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 text-sm inline-flex items-center gap-1"
              >
                <Square className="h-3 w-3" />
                Stop Dev
              </button>
              <button
                onClick={handleCreatePR}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-sm inline-flex items-center gap-1"
              >
                <GitBranch className="h-3 w-3" />
                Create PR
              </button>
              {task.metadata?.prUrl && (
                <a
                  href={task.metadata.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 text-sm inline-flex items-center gap-1"
                >
                  <Link2 className="h-3 w-3" />
                  View PR
                </a>
              )}
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="px-3 py-1.5 rounded-md border border-input hover:bg-secondary text-sm"
              >
                {isEditing ? 'Cancel' : 'Edit'}
              </button>
              {isEditing && (
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-sm"
                >
                  Save
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
              <Tabs.List className="flex border-b border-border px-6">
                <Tabs.Trigger
                  value="logs"
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition-colors relative",
                    "hover:text-foreground",
                    activeTab === 'logs' 
                      ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary"
                      : "text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Logs
                    {task.metadata?.errors && task.metadata.errors.length > 0 && (
                      <span className="px-1.5 py-0.5 text-xs rounded-full bg-destructive text-destructive-foreground">
                        {task.metadata.errors.length}
                      </span>
                    )}
                  </div>
                </Tabs.Trigger>
                
                <Tabs.Trigger
                  value="diffs"
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition-colors relative",
                    "hover:text-foreground",
                    activeTab === 'diffs' 
                      ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary"
                      : "text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    Diffs
                    {task.metadata?.diffs && task.metadata.diffs.length > 0 && (
                      <span className="px-1.5 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground">
                        {task.metadata.diffs.length}
                      </span>
                    )}
                  </div>
                </Tabs.Trigger>
                
                <Tabs.Trigger
                  value="comments"
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition-colors relative",
                    "hover:text-foreground",
                    activeTab === 'comments' 
                      ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary"
                      : "text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Comments
                    {task.metadata?.comments && task.metadata.comments.length > 0 && (
                      <span className="px-1.5 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground">
                        {task.metadata.comments.length}
                      </span>
                    )}
                  </div>
                </Tabs.Trigger>
                
                <Tabs.Trigger
                  value="activity"
                  className={cn(
                    "px-4 py-2 text-sm font-medium transition-colors relative",
                    "hover:text-foreground",
                    activeTab === 'activity' 
                      ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary"
                      : "text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <ActivityIcon className="h-4 w-4" />
                    Activity
                  </div>
                </Tabs.Trigger>
              </Tabs.List>

              <div className="flex-1 overflow-hidden">
                <Tabs.Content value="logs" className="h-full">
                  <LogsTab task={task} onUpdateTask={onUpdateTask} />
                </Tabs.Content>
                
                <Tabs.Content value="diffs" className="h-full">
                  <DiffsTab task={task} onUpdateTask={onUpdateTask} />
                </Tabs.Content>
                
                <Tabs.Content value="comments" className="h-full">
                  <CommentsTab task={task} onUpdateTask={onUpdateTask} />
                </Tabs.Content>
                
                <Tabs.Content value="activity" className="h-full">
                  <ActivityTab task={task} />
                </Tabs.Content>
              </div>
            </Tabs.Root>
          </div>

          {isEditing && (
            <div className="p-6 border-t border-border">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Description</label>
                  <textarea
                    value={editedDescription}
                    onChange={(e) => setEditedDescription(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[100px] resize-none"
                    placeholder="Add task description..."
                  />
                </div>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}