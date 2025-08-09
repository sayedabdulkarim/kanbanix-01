'use client';

import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Label from '@radix-ui/react-label';
import * as Select from '@radix-ui/react-select';
import { X, ChevronDown, Check } from 'lucide-react';
import { Task, Column } from '@/types/project';

interface TaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (task: Partial<Task>) => void;
  task?: Task | null;
  columnId: string;
  columns: Column[];
}

export default function TaskModal({
  open,
  onOpenChange,
  onSave,
  task,
  columnId,
  columns,
}: TaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [selectedColumnId, setSelectedColumnId] = useState(columnId);
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState('');

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority || 'medium');
      setSelectedColumnId(task.columnId);
      setLabels(task.labels || []);
    } else {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setSelectedColumnId(columnId);
      setLabels([]);
    }
  }, [task, columnId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const taskData: Partial<Task> = {
      title: title.trim(),
      description: description.trim(),
      priority,
      columnId: selectedColumnId,
      labels,
      status: getStatusFromColumnId(selectedColumnId),
    };

    if (task) {
      taskData.id = task.id;
    }

    onSave(taskData);
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setPriority('medium');
    setLabels([]);
    setLabelInput('');
  };

  const handleAddLabel = () => {
    if (labelInput.trim() && !labels.includes(labelInput.trim())) {
      setLabels([...labels, labelInput.trim()]);
      setLabelInput('');
    }
  };

  const handleRemoveLabel = (label: string) => {
    setLabels(labels.filter(l => l !== label));
  };

  const getStatusFromColumnId = (colId: string): Task['status'] => {
    const statusMap: Record<string, Task['status']> = {
      '1': 'todo',
      '2': 'inProgress',
      '3': 'inReview',
      '4': 'done',
      '5': 'cancelled',
    };
    return statusMap[colId] || 'todo';
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in" />
        <Dialog.Content className="fixed left-[50%] top-[50%] max-h-[85vh] w-[90vw] max-w-[550px] translate-x-[-50%] translate-y-[-50%] rounded-2xl bg-card p-6 shadow-xl animate-in fade-in-0 zoom-in-95 overflow-y-auto">
          <Dialog.Title className="text-xl font-semibold mb-4">
            {task ? 'Edit Task' : 'Create New Task'}
          </Dialog.Title>
          
          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label.Root htmlFor="title" className="text-sm font-medium">
                Title *
              </Label.Root>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Enter task title..."
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label.Root htmlFor="description" className="text-sm font-medium">
                Description
              </Label.Root>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[100px] resize-none"
                placeholder="Add task description..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label.Root className="text-sm font-medium">
                  Column
                </Label.Root>
                <Select.Root value={selectedColumnId} onValueChange={setSelectedColumnId}>
                  <Select.Trigger className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring flex items-center justify-between">
                    <Select.Value>
                      {columns.find(c => c.id === selectedColumnId)?.name}
                    </Select.Value>
                    <Select.Icon>
                      <ChevronDown className="h-4 w-4" />
                    </Select.Icon>
                  </Select.Trigger>
                  
                  <Select.Portal>
                    <Select.Content className="overflow-hidden bg-card rounded-lg shadow-lg border border-border">
                      <Select.Viewport className="p-1">
                        {columns.map((col) => (
                          <Select.Item
                            key={col.id}
                            value={col.id}
                            className="relative flex items-center px-8 py-2 text-sm rounded-md hover:bg-secondary cursor-pointer outline-none"
                          >
                            <Select.ItemText>
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: col.color }}
                                />
                                {col.name}
                              </div>
                            </Select.ItemText>
                            <Select.ItemIndicator className="absolute left-2">
                              <Check className="h-4 w-4" />
                            </Select.ItemIndicator>
                          </Select.Item>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
              </div>

              <div className="space-y-2">
                <Label.Root className="text-sm font-medium">
                  Priority
                </Label.Root>
                <Select.Root value={priority} onValueChange={(value) => setPriority(value as 'low' | 'medium' | 'high')}>
                  <Select.Trigger className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring flex items-center justify-between">
                    <Select.Value />
                    <Select.Icon>
                      <ChevronDown className="h-4 w-4" />
                    </Select.Icon>
                  </Select.Trigger>
                  
                  <Select.Portal>
                    <Select.Content className="overflow-hidden bg-card rounded-lg shadow-lg border border-border">
                      <Select.Viewport className="p-1">
                        <Select.Item
                          value="low"
                          className="relative flex items-center px-8 py-2 text-sm rounded-md hover:bg-secondary cursor-pointer outline-none"
                        >
                          <Select.ItemText>Low</Select.ItemText>
                          <Select.ItemIndicator className="absolute left-2">
                            <Check className="h-4 w-4" />
                          </Select.ItemIndicator>
                        </Select.Item>
                        
                        <Select.Item
                          value="medium"
                          className="relative flex items-center px-8 py-2 text-sm rounded-md hover:bg-secondary cursor-pointer outline-none"
                        >
                          <Select.ItemText>Medium</Select.ItemText>
                          <Select.ItemIndicator className="absolute left-2">
                            <Check className="h-4 w-4" />
                          </Select.ItemIndicator>
                        </Select.Item>
                        
                        <Select.Item
                          value="high"
                          className="relative flex items-center px-8 py-2 text-sm rounded-md hover:bg-secondary cursor-pointer outline-none"
                        >
                          <Select.ItemText>High</Select.ItemText>
                          <Select.ItemIndicator className="absolute left-2">
                            <Check className="h-4 w-4" />
                          </Select.ItemIndicator>
                        </Select.Item>
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
              </div>
            </div>

            <div className="space-y-2">
              <Label.Root className="text-sm font-medium">
                Labels
              </Label.Root>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddLabel();
                    }
                  }}
                  className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Add a label and press Enter"
                />
                <button
                  type="button"
                  onClick={handleAddLabel}
                  className="px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
                >
                  Add
                </button>
              </div>
              {labels.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {labels.map((label) => (
                    <span
                      key={label}
                      className="px-3 py-1 text-sm rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center gap-1"
                    >
                      {label}
                      <button
                        type="button"
                        onClick={() => handleRemoveLabel(label)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  onOpenChange(false);
                }}
                className="flex-1 px-4 py-2 rounded-lg border border-input hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {task ? 'Update Task' : 'Create Task'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}