'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useProjectStore } from '@/lib/store/useProjectStore';
import { useTaskStore } from '@/lib/store/useTaskStore';
import { Project, Task } from '@/types/project';
import BoardColumn from '@/components/kanban/BoardColumn';
import TaskCard from '@/components/kanban/TaskCard';
import TaskModal from '@/components/kanban/TaskModal';

export default function ProjectBoard() {
  const params = useParams();
  const router = useRouter();
  const { getProject } = useProjectStore();
  const { 
    getTasksByProject, 
    getTasksByColumn, 
    addTask, 
    updateTask, 
    deleteTask,
    moveTask,
    reorderTasks 
  } = useTaskStore();
  
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [mounted, setMounted] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string>('1');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && params.projectId) {
      const foundProject = getProject(params.projectId as string);
      if (foundProject) {
        setProject(foundProject);
      } else {
        router.push('/');
      }
    }
  }, [params.projectId, getProject, router, mounted]);

  if (!mounted || !project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  const projectTasks = getTasksByProject(project.id);
  const activeTask = activeId ? projectTasks.find(t => t.id === activeId) : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    
    if (!over) return;
    
    const activeTask = projectTasks.find(t => t.id === active.id);
    if (!activeTask) return;
    
    const overColumnId = over.id as string;
    
    // Check if we're dragging over a column
    if (project.columns.some(col => col.id === overColumnId)) {
      if (activeTask.columnId !== overColumnId) {
        moveTask(activeTask.id, overColumnId, 0);
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over) {
      setActiveId(null);
      return;
    }
    
    const activeTask = projectTasks.find(t => t.id === active.id);
    const overTask = projectTasks.find(t => t.id === over.id);
    
    if (!activeTask) {
      setActiveId(null);
      return;
    }
    
    // If dropping on another task
    if (overTask && activeTask.columnId === overTask.columnId) {
      const columnTasks = getTasksByColumn(project.id, activeTask.columnId);
      const oldIndex = columnTasks.findIndex(t => t.id === activeTask.id);
      const newIndex = columnTasks.findIndex(t => t.id === overTask.id);
      
      if (oldIndex !== newIndex) {
        const newTasks = arrayMove(columnTasks, oldIndex, newIndex);
        reorderTasks(project.id, activeTask.columnId, newTasks);
      }
    }
    // If dropping on a column
    else if (project.columns.some(col => col.id === over.id)) {
      const newColumnId = over.id as string;
      if (activeTask.columnId !== newColumnId) {
        moveTask(activeTask.id, newColumnId, 0);
      }
    }
    
    setActiveId(null);
  };

  const handleAddTask = (columnId: string) => {
    setSelectedColumnId(columnId);
    setSelectedTask(null);
    setIsTaskModalOpen(true);
  };

  const handleEditTask = (task: Task) => {
    setSelectedTask(task);
    setSelectedColumnId(task.columnId);
    setIsTaskModalOpen(true);
  };

  const handleSaveTask = (taskData: Partial<Task>) => {
    if (taskData.id) {
      updateTask(taskData.id, taskData);
    } else {
      addTask({
        ...taskData,
        projectId: project.id,
        order: getTasksByColumn(project.id, taskData.columnId!).length,
      } as Omit<Task, 'id' | 'createdAt' | 'modifiedAt'>);
    }
  };

  const handleDeleteTask = (taskId: string) => {
    if (confirm('Are you sure you want to delete this task?')) {
      deleteTask(taskId);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="p-2 rounded-lg hover:bg-secondary transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Link href="/" className="hover:text-foreground transition-colors">
                    Projects
                  </Link>
                  <span>/</span>
                  <span className="text-foreground">{project.name}</span>
                </nav>
                <h1 className="text-xl font-semibold">{project.name}</h1>
              </div>
            </div>
            
            <button 
              onClick={() => handleAddTask('1')}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Task
            </button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            {project.columns.map((column) => {
              const columnTasks = getTasksByColumn(project.id, column.id);
              
              return (
                <BoardColumn
                  key={column.id}
                  column={column}
                  tasks={columnTasks}
                  onAddTask={() => handleAddTask(column.id)}
                  onEditTask={handleEditTask}
                  onDeleteTask={handleDeleteTask}
                />
              );
            })}
          </div>
          
          <DragOverlay
            dropAnimation={{
              sideEffects: defaultDropAnimationSideEffects({
                styles: {
                  active: {
                    opacity: '0.5',
                  },
                },
              }),
            }}
          >
            {activeTask ? (
              <div className="rotate-3 opacity-90">
                <TaskCard task={activeTask} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <TaskModal
        open={isTaskModalOpen}
        onOpenChange={setIsTaskModalOpen}
        onSave={handleSaveTask}
        task={selectedTask}
        columnId={selectedColumnId}
        columns={project.columns}
      />
    </div>
  );
}