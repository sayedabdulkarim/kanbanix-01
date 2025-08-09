'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { Task, Column } from '@/types/project';
import TaskCard from './TaskCard';
import { cn } from '@/lib/utils/cn';

interface BoardColumnProps {
  column: Column;
  tasks: Task[];
  onAddTask?: () => void;
  onEditTask?: (task: Task) => void;
  onDeleteTask?: (taskId: string) => void;
}

export default function BoardColumn({
  column,
  tasks,
  onAddTask,
  onEditTask,
  onDeleteTask,
}: BoardColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: column.id,
  });

  return (
    <div
      className={cn(
        "flex-shrink-0 w-80 transition-all",
        isOver && "ring-2 ring-primary ring-opacity-50 rounded-lg"
      )}
    >
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: column.color }}
              />
              <h3 className="font-medium">{column.name}</h3>
              <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-secondary text-secondary-foreground">
                {tasks.length}
              </span>
            </div>
            
            <button
              onClick={onAddTask}
              className="p-1 rounded hover:bg-secondary transition-colors"
              title={`Add task to ${column.name}`}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          ref={setNodeRef}
          className="p-2 min-h-[400px] max-h-[calc(100vh-250px)] overflow-y-auto"
        >
          <SortableContext
            items={tasks.map(t => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {tasks.length > 0 ? (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onEdit={onEditTask}
                    onDelete={onDeleteTask}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <p className="text-sm mb-2">No tasks yet</p>
                <button
                  onClick={onAddTask}
                  className="text-primary hover:underline text-sm"
                >
                  Add your first task
                </button>
              </div>
            )}
          </SortableContext>
        </div>
      </div>
    </div>
  );
}