'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
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
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Project, Task, Column } from '@/types/project';
import { cn } from '@/lib/utils/cn';
import BoardColumn from '@/components/kanban/BoardColumn';
import TaskCard from '@/components/kanban/TaskCard';
import TaskModal from '@/components/kanban/TaskModal';
import TaskDetailsSplitView from '@/components/kanban/TaskDetailsSplitView';

interface ProjectData {
  id: string;
  name: string;
  description: string;
  gradient: string;
  columns: Column[];
  tasks: Task[];
}

export default function ProjectBoard() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status } = useSession();
  
  const [project, setProject] = useState<ProjectData | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string>('');
  const [selectedTaskForDetails, setSelectedTaskForDetails] = useState<Task | null>(null);

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
    if (status === 'unauthenticated') {
      router.push('/');
      return;
    }
    
    if (status === 'authenticated' && params.projectId) {
      fetchProject();
    }
  }, [params.projectId, status, router]);

  const fetchProject = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${params.projectId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          router.push('/');
          return;
        }
        throw new Error('Failed to fetch project');
      }
      
      const data = await response.json();
      setProject(data);
      setTasks(data.tasks || []);
      if (data.columns && data.columns.length > 0) {
        setSelectedColumnId(data.columns[0].id);
      }
    } catch (error) {
      console.error('Error fetching project:', error);
      router.push('/');
    } finally {
      setLoading(false);
    }
  };

  if (loading || status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Project not found</p>
          <Link href="/" className="text-primary hover:underline mt-2 inline-block">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const getTasksByColumn = (columnId: string) => {
    return tasks.filter(task => task.columnId === columnId).sort((a, b) => a.order - b.order);
  };

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    
    if (!over) return;
    
    const activeTask = tasks.find(t => t.id === active.id);
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
    
    const activeTask = tasks.find(t => t.id === active.id);
    const overTask = tasks.find(t => t.id === over.id);
    
    if (!activeTask) {
      setActiveId(null);
      return;
    }
    
    // If dropping on another task
    if (overTask && activeTask.columnId === overTask.columnId) {
      const columnTasks = getTasksByColumn(activeTask.columnId);
      const oldIndex = columnTasks.findIndex(t => t.id === activeTask.id);
      const newIndex = columnTasks.findIndex(t => t.id === overTask.id);
      
      if (oldIndex !== newIndex) {
        const newTasks = arrayMove(columnTasks, oldIndex, newIndex);
        // TODO: Update task order in database
        setTasks(prevTasks => {
          const updatedTasks = [...prevTasks];
          newTasks.forEach((task, index) => {
            const taskIndex = updatedTasks.findIndex(t => t.id === task.id);
            if (taskIndex !== -1) {
              updatedTasks[taskIndex] = { ...updatedTasks[taskIndex], order: index };
            }
          });
          return updatedTasks;
        });
      }
    }
    // If dropping on a column
    else if (project.columns.some(col => col.id === over.id)) {
      const newColumnId = over.id as string;
      if (activeTask.columnId !== newColumnId) {
        // TODO: Update task column in database
        setTasks(prevTasks => 
          prevTasks.map(t => 
            t.id === activeTask.id 
              ? { ...t, columnId: newColumnId, order: 0 }
              : t
          )
        );
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

  const handleSaveTask = async (taskData: Partial<Task>) => {
    // TODO: Implement task save to database
    console.log('Save task:', taskData);
    setIsTaskModalOpen(false);
  };

  const handleDeleteTask = async (taskId: string) => {
    if (confirm('Are you sure you want to delete this task?')) {
      // TODO: Implement task delete from database
      setTasks(prevTasks => prevTasks.filter(t => t.id !== taskId));
      if (selectedTaskForDetails?.id === taskId) {
        setSelectedTaskForDetails(null);
      }
    }
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTaskForDetails(task);
  };

  const handleUpdateTaskFromDetails = async (taskId: string, updates: Partial<Task>) => {
    // TODO: Implement task update in database
    setTasks(prevTasks => 
      prevTasks.map(t => 
        t.id === taskId ? { ...t, ...updates } : t
      )
    );
    const updatedTask = tasks.find(t => t.id === taskId);
    if (updatedTask) {
      setSelectedTaskForDetails({ ...updatedTask, ...updates });
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
              onClick={() => handleAddTask(selectedColumnId)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Task
            </button>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-8rem)]">
        <div className={selectedTaskForDetails ? "w-1/2" : "w-full"}>
          <div className="h-full overflow-x-auto overflow-y-hidden">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
            >
              <div className={cn(
                "flex gap-4 p-6 h-full min-w-fit",
                !selectedTaskForDetails && "justify-center"
              )}>
                {project.columns.map((column) => {
                  const columnTasks = getTasksByColumn(column.id);
                  
                  return (
                    <BoardColumn
                      key={column.id}
                      column={column}
                      tasks={columnTasks}
                      onAddTask={() => handleAddTask(column.id)}
                      onEditTask={handleEditTask}
                      onDeleteTask={handleDeleteTask}
                      onTaskClick={handleTaskClick}
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
        </div>

        {selectedTaskForDetails && (
          <div className="w-1/2 h-full border-l border-border overflow-hidden">
            <TaskDetailsSplitView
              task={selectedTaskForDetails}
              onClose={() => setSelectedTaskForDetails(null)}
              onUpdateTask={handleUpdateTaskFromDetails}
              onDeleteTask={handleDeleteTask}
            />
          </div>
        )}
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