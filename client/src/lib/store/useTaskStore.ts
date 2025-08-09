import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Task } from '@/types/project';

interface TaskStore {
  tasks: Task[];
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'modifiedAt'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  moveTask: (taskId: string, newColumnId: string, newOrder: number) => void;
  getTasksByProject: (projectId: string) => Task[];
  getTasksByColumn: (projectId: string, columnId: string) => Task[];
  reorderTasks: (projectId: string, columnId: string, tasks: Task[]) => void;
}

export const useTaskStore = create<TaskStore>()(
  persist(
    (set, get) => ({
      tasks: [],
      
      addTask: (taskData) => {
        const newTask: Task = {
          ...taskData,
          id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          createdAt: new Date(),
          modifiedAt: new Date(),
        };
        
        set((state) => ({
          tasks: [...state.tasks, newTask],
        }));
      },
      
      updateTask: (id, updates) => {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id
              ? { ...task, ...updates, modifiedAt: new Date() }
              : task
          ),
        }));
      },
      
      deleteTask: (id) => {
        set((state) => ({
          tasks: state.tasks.filter((task) => task.id !== id),
        }));
      },
      
      moveTask: (taskId, newColumnId, newOrder) => {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === taskId
              ? { 
                  ...task, 
                  columnId: newColumnId, 
                  order: newOrder,
                  status: getStatusFromColumnId(newColumnId),
                  modifiedAt: new Date() 
                }
              : task
          ),
        }));
      },
      
      getTasksByProject: (projectId) => {
        return get().tasks.filter((task) => task.projectId === projectId);
      },
      
      getTasksByColumn: (projectId, columnId) => {
        return get().tasks
          .filter((task) => task.projectId === projectId && task.columnId === columnId)
          .sort((a, b) => a.order - b.order);
      },
      
      reorderTasks: (projectId, columnId, reorderedTasks) => {
        set((state) => {
          const otherTasks = state.tasks.filter(
            (task) => !(task.projectId === projectId && task.columnId === columnId)
          );
          
          const updatedTasks = reorderedTasks.map((task, index) => ({
            ...task,
            order: index,
            modifiedAt: new Date(),
          }));
          
          return {
            tasks: [...otherTasks, ...updatedTasks],
          };
        });
      },
    }),
    {
      name: 'kanbanix-tasks',
    }
  )
);

function getStatusFromColumnId(columnId: string): Task['status'] {
  const statusMap: Record<string, Task['status']> = {
    '1': 'todo',
    '2': 'inProgress',
    '3': 'inReview',
    '4': 'done',
    '5': 'cancelled',
  };
  return statusMap[columnId] || 'todo';
}