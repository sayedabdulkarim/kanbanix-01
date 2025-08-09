'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MoreVertical, Clock, AlertCircle, CheckCircle, Edit2, Trash2 } from 'lucide-react';
import { Task } from '@/types/project';
import { cn } from '@/lib/utils/cn';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface TaskCardProps {
  task: Task;
  onEdit?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
}

export default function TaskCard({ task, onEdit, onDelete }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high':
        return 'text-destructive';
      case 'medium':
        return 'text-accent';
      case 'low':
        return 'text-muted-foreground';
      default:
        return 'text-muted-foreground';
    }
  };

  const getPriorityIcon = (priority?: string) => {
    switch (priority) {
      case 'high':
        return <AlertCircle className="h-3 w-3" />;
      case 'medium':
        return <Clock className="h-3 w-3" />;
      case 'low':
        return <CheckCircle className="h-3 w-3" />;
      default:
        return null;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "group relative bg-card rounded-lg border border-border p-3 cursor-move hover:shadow-md transition-all",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm mb-1 truncate">{task.title}</h4>
          {task.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {task.description}
            </p>
          )}
        </div>
        
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-secondary"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="min-w-[160px] bg-card rounded-lg p-1 shadow-lg border border-border"
              sideOffset={5}
            >
              <DropdownMenu.Item
                className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-secondary rounded-md outline-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit?.(task);
                }}
              >
                <Edit2 className="h-4 w-4" />
                Edit Task
              </DropdownMenu.Item>
              
              <DropdownMenu.Item
                className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-destructive/10 text-destructive rounded-md outline-none"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(task.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete Task
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-2">
          {task.priority && (
            <div className={cn("flex items-center gap-1", getPriorityColor(task.priority))}>
              {getPriorityIcon(task.priority)}
              <span className="text-xs capitalize">{task.priority}</span>
            </div>
          )}
        </div>

        {task.labels && task.labels.length > 0 && (
          <div className="flex gap-1">
            {task.labels.slice(0, 2).map((label) => (
              <span
                key={label}
                className="px-2 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground"
              >
                {label}
              </span>
            ))}
            {task.labels.length > 2 && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground">
                +{task.labels.length - 2}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}