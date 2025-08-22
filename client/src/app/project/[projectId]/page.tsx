'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Plus, Loader2, RefreshCw, GitBranch, GitCommit, GitPullRequest } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import workspaceService from '@/lib/services/workspaceService';
import { API_ENDPOINTS, apiFetch } from '@/lib/config/api';
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
import TaskExecutionPanel from '@/components/kanban/TaskExecutionPanel';

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
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceStatus, setWorkspaceStatus] = useState<any>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string>('');
  const [selectedTaskForDetails, setSelectedTaskForDetails] = useState<Task | null>(null);
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);
  const [taskExecutions, setTaskExecutions] = useState<Record<string, any>>({});
  
  // Phase 2: State for Commit/PR buttons
  const [hasUncommittedChanges, setHasUncommittedChanges] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCreatingPR, setIsCreatingPR] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');

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

  // Cleanup workspace on unmount or when leaving the page
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const tasksInProgress = tasks.filter(t => t.status === 'inProgress');
      if (tasksInProgress.length > 0) {
        e.preventDefault();
        e.returnValue = 'You have tasks in progress. Are you sure you want to leave?';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tasks]);

  // Navigation guard for workspace cleanup
  const handleLeaveProject = useCallback(async () => {
    const tasksInProgress = tasks.filter(t => t.status === 'inProgress');
    
    if (tasksInProgress.length > 0) {
      const confirmed = confirm(
        `You have ${tasksInProgress.length} task(s) in progress. They will be reset to TODO if you leave. Continue?`
      );
      if (!confirmed) return false;
    }

    try {
      setWorkspaceLoading(true);
      await workspaceService.leaveWorkspace(params.projectId as string);
      return true;
    } catch (error) {
      console.error('Error leaving workspace:', error);
      return true; // Allow navigation even if cleanup fails
    } finally {
      setWorkspaceLoading(false);
    }
  }, [tasks, params.projectId]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/');
      return;
    }
    
    if (status === 'authenticated' && params.projectId) {
      initializeProject();
    }
  }, [params.projectId, status, router]);

  const initializeProject = async () => {
    try {
      setLoading(true);
      
      // First fetch project data
      await fetchProject();
      
      // Then enter workspace
      await enterWorkspace();
      
    } catch (error) {
      console.error('Error initializing project:', error);
    } finally {
      setLoading(false);
    }
  };

  const enterWorkspace = async () => {
    try {
      setWorkspaceLoading(true);
      const result = await workspaceService.enterWorkspace(params.projectId as string);
      console.log('Workspace entered:', result);
      
      // Fetch workspace status
      const status = await workspaceService.getWorkspaceStatus(params.projectId as string);
      setWorkspaceStatus(status);
    } catch (error) {
      console.error('Error entering workspace:', error);
      // Show warning but don't block UI
      console.warn('Continuing without workspace. GitHub operations will be limited.');
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const refreshWorkspace = async () => {
    try {
      setWorkspaceLoading(true);
      const result = await workspaceService.refreshWorkspace(params.projectId as string);
      
      if (result.hasUncommittedChanges) {
        const discard = confirm('You have uncommitted changes. Discard them and pull latest?');
        if (discard) {
          await workspaceService.refreshWorkspace(params.projectId as string, true);
        }
      }
      
      // Update workspace status
      const status = await workspaceService.getWorkspaceStatus(params.projectId as string);
      setWorkspaceStatus(status);
    } catch (error) {
      console.error('Error refreshing workspace:', error);
      alert('Failed to refresh workspace');
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const fetchProject = async () => {
    try {
      const response = await apiFetch(API_ENDPOINTS.projects.get(params.projectId));
      
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

  const pollExecutionStatus = async (taskId: string) => {
    try {
      const response = await apiFetch(API_ENDPOINTS.tasks.execution(taskId));
      if (response.ok) {
        const execution = await response.json();
        setTaskExecutions(prev => ({ ...prev, [taskId]: execution }));
        
        // Continue polling if still running
        if (execution && execution.status === 'running') {
          setTimeout(() => pollExecutionStatus(taskId), 2000);
        } else if (execution && (execution.status === 'completed' || execution.status === 'failed')) {
          // Phase 2: Refresh project data to get updated task status after AI completion
          if (execution.status === 'completed') {
            // Fetch updated project data to reflect task move to In Review
            await fetchProject();
          }
          
          // Clear executing task when done
          if (executingTaskId === taskId) {
            setTimeout(() => setExecutingTaskId(null), 3000);
          }
        }
      }
    } catch (error) {
      console.error('Error polling execution status:', error);
    }
  };

  const moveTask = async (taskId: string, newColumnId: string, newOrder: number) => {
    try {
      // Find the task to get its current status
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      
      // Find the new column to determine status
      const newColumn = project?.columns.find(col => col.id === newColumnId);
      let newStatus = task.status;
      
      // Map column name to status
      if (newColumn) {
        const columnNameLower = newColumn.name.toLowerCase();
        if (columnNameLower.includes('backlog')) {
          newStatus = 'backlog';
        } else if (columnNameLower.includes('to do') || columnNameLower === 'todo') {
          newStatus = 'todo';
        } else if (columnNameLower.includes('in progress') || columnNameLower === 'in progress') {
          newStatus = 'inProgress';
        } else if (columnNameLower.includes('in review') || columnNameLower === 'review') {
          newStatus = 'inReview';
        } else if (columnNameLower.includes('done') || columnNameLower === 'completed') {
          newStatus = 'done';
        }
      }
      
      const response = await apiFetch(API_ENDPOINTS.tasks.update(taskId), {
        method: 'PUT',
        body: JSON.stringify({
          columnId: newColumnId,
          status: newStatus,
          order: newOrder,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to move task');
      }

      const updatedTask = await response.json();
      setTasks(prevTasks =>
        prevTasks.map(t => t.id === taskId ? { ...updatedTask, status: newStatus } : t)
      );
      
      // If task moved to "In Progress", track it as executing
      if (newStatus === 'inProgress') {
        setExecutingTaskId(taskId);
        pollExecutionStatus(taskId);
      }
    } catch (error) {
      console.error('Error moving task:', error);
    }
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
        // Don't call moveTask here - it will be called in handleDragEnd
        // This prevents duplicate API calls
        // moveTask(activeTask.id, overColumnId, 0);
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
        // Use the existing moveTask function which handles everything
        // including status updates, AI triggers, and local state
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

  const handleSaveTask = async (taskData: Partial<Task>) => {
    try {
      if (selectedTask) {
        // Update existing task
        const response = await apiFetch(API_ENDPOINTS.tasks.update(selectedTask.id), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(taskData),
        });

        if (!response.ok) {
          throw new Error('Failed to update task');
        }

        const updatedTask = await response.json();
        setTasks(prevTasks =>
          prevTasks.map(t => t.id === selectedTask.id ? updatedTask : t)
        );
        
        // Update selected task if it's being viewed in details
        if (selectedTaskForDetails?.id === selectedTask.id) {
          setSelectedTaskForDetails(updatedTask);
        }
      } else {
        // Create new task
        const response = await apiFetch(API_ENDPOINTS.tasks.create, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...taskData,
            projectId: project?.id,
            columnId: selectedColumnId,
            order: getTasksByColumn(selectedColumnId).length,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to create task');
        }

        const newTask = await response.json();
        setTasks(prevTasks => [...prevTasks, newTask]);
      }

      setIsTaskModalOpen(false);
    } catch (error) {
      console.error('Error saving task:', error);
      alert('Failed to save task. Please try again.');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (confirm('Are you sure you want to delete this task?')) {
      try {
        const response = await apiFetch(API_ENDPOINTS.tasks.update(taskId), {
          method: 'DELETE',
        });

        if (!response.ok) {
          throw new Error('Failed to delete task');
        }

        setTasks(prevTasks => prevTasks.filter(t => t.id !== taskId));
        if (selectedTaskForDetails?.id === taskId) {
          setSelectedTaskForDetails(null);
        }
      } catch (error) {
        console.error('Error deleting task:', error);
        alert('Failed to delete task. Please try again.');
      }
    }
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTaskForDetails(task);
  };

  // Phase 2: Handle Commit All functionality
  const handleCommitAll = async () => {
    if (!project) return;
    
    setIsCommitting(true);
    try {
      // Get all tasks in review
      const tasksInReview = tasks.filter(t => t.status === 'inReview');
      
      if (tasksInReview.length === 0) {
        alert('No tasks in review to commit');
        return;
      }
      
      // Create commit message with all task titles
      const taskTitles = tasksInReview.map(t => `- ${t.title}`).join('\n');
      const message = `feat: Complete multiple tasks\n\n${taskTitles}`;
      
      const response = await fetch('/api/workspace/commit-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          message,
          taskIds: tasksInReview.map(t => t.id)
        })
      });
      
      if (response.ok) {
        setHasUncommittedChanges(false);
        alert('All changes committed successfully!');
      } else {
        const error = await response.json();
        alert(`Failed to commit: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Commit error:', error);
      alert('Failed to commit changes');
    } finally {
      setIsCommitting(false);
    }
  };

  // Phase 2: Handle Create PR functionality
  const handleCreatePR = async () => {
    if (!project) return;
    
    setIsCreatingPR(true);
    try {
      const response = await fetch('/api/workspace/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          title: `Update: ${project.name}`,
          description: 'Pull request created from Kanbanix board'
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        alert(`Pull request created successfully! PR #${data.pullRequest?.number || ''}`);
        
        // Move all in-review tasks to done
        const inReviewTasks = tasks.filter(t => t.status === 'inReview');
        const doneColumn = project.columns.find(c => c.status === 'done' || c.name.toLowerCase() === 'done');
        
        if (doneColumn) {
          setTasks(prevTasks => 
            prevTasks.map(t => 
              inReviewTasks.find(rt => rt.id === t.id) 
                ? { ...t, status: 'done', columnId: doneColumn.id }
                : t
            )
          );
        }
      } else {
        const error = await response.json();
        alert(`Failed to create PR: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('PR creation error:', error);
      alert('Failed to create pull request');
    } finally {
      setIsCreatingPR(false);
    }
  };

  const handleUpdateTaskFromDetails = async (taskId: string, updates: Partial<Task>) => {
    try {
      const response = await apiFetch(API_ENDPOINTS.tasks.update(taskId), {
        method: 'PUT',
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error('Failed to update task');
      }

      const updatedTask = await response.json();
      setTasks(prevTasks => 
        prevTasks.map(t => 
          t.id === taskId ? updatedTask : t
        )
      );
      
      // Update selected task details if it's being viewed
      if (selectedTaskForDetails?.id === taskId) {
        setSelectedTaskForDetails(updatedTask);
      }
    } catch (error) {
      console.error('Error updating task:', error);
      alert('Failed to update task. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={async () => {
                  const canLeave = await handleLeaveProject();
                  if (canLeave) {
                    router.push('/');
                  }
                }}
                className="p-2 rounded-lg hover:bg-secondary transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Link href="/" className="hover:text-foreground transition-colors">
                    Projects
                  </Link>
                  <span>/</span>
                  <span className="text-foreground">{project.name}</span>
                </nav>
                <div className="flex items-center gap-4">
                  <h1 className="text-xl font-semibold">{project.name}</h1>
                  {workspaceStatus?.workspace?.git && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <GitBranch className="h-4 w-4" />
                      <span>{workspaceStatus.workspace.git.branch}</span>
                      {workspaceStatus.workspace.git.hasUncommittedChanges && (
                        <span className="text-yellow-500">• Modified</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={refreshWorkspace}
                disabled={workspaceLoading}
                className="p-2 rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
                title="Refresh workspace"
              >
                <RefreshCw className={cn("h-5 w-5", workspaceLoading && "animate-spin")} />
              </button>
              
              {/* Phase 2: Board-level Commit and PR buttons */}
              <button
                onClick={handleCommitAll}
                disabled={isCommitting || tasks.filter(t => t.status === 'inReview').length === 0}
                className="px-4 py-2 rounded-lg border border-border hover:bg-secondary transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={tasks.filter(t => t.status === 'inReview').length === 0 
                  ? "No tasks in review to commit" 
                  : "Commit all reviewed tasks"}
              >
                <GitCommit className="h-4 w-4" />
                {isCommitting ? 'Committing...' : 'Commit All'}
              </button>
              <button
                onClick={handleCreatePR}
                disabled={isCreatingPR || hasUncommittedChanges || tasks.filter(t => t.status === 'inReview').length > 0}
                className="px-4 py-2 rounded-lg border border-border hover:bg-secondary transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={hasUncommittedChanges 
                  ? "Please commit changes first" 
                  : tasks.filter(t => t.status === 'inReview').length > 0
                  ? "Please commit all reviewed tasks first"
                  : "Create pull request"}
              >
                <GitPullRequest className="h-4 w-4" />
                {isCreatingPR ? 'Creating...' : 'Create PR'}
              </button>
              
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
      </div>

      <div className="flex h-[calc(100vh-8rem)]">
        <div className={cn(
          "transition-all duration-300",
          selectedTaskForDetails ? "w-1/2" : 
          executingTaskId ? "w-2/3" : "w-full"
        )}>
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
                      taskExecutions={taskExecutions}
                      executingTaskId={executingTaskId}
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
            {selectedTaskForDetails.status === 'inReview' || taskExecutions[selectedTaskForDetails.id] ? (
              <TaskExecutionPanel
                task={selectedTaskForDetails}
                projectId={params.projectId as string}
                repoUrl={project.repoUrl}
                onClose={() => setSelectedTaskForDetails(null)}
                onTaskUpdate={(updatedTask) => {
                  // Find the In Review column
                  const inReviewColumn = project.columns.find(col => 
                    col.name.toLowerCase().includes('review')
                  );
                  
                  // Update the task with the correct columnId
                  const taskWithColumn = {
                    ...updatedTask,
                    columnId: inReviewColumn?.id || updatedTask.columnId
                  };
                  
                  // Update the task in state
                  setTasks(prevTasks => 
                    prevTasks.map(t => 
                      t.id === taskWithColumn.id ? taskWithColumn : t
                    )
                  );
                  // Also update selectedTaskForDetails to reflect the new status
                  setSelectedTaskForDetails(taskWithColumn);
                }}
              />
            ) : (
              <TaskDetailsSplitView
                task={selectedTaskForDetails}
                onClose={() => setSelectedTaskForDetails(null)}
                onUpdateTask={handleUpdateTaskFromDetails}
                onDeleteTask={handleDeleteTask}
              />
            )}
          </div>
        )}
        
        {executingTaskId && !selectedTaskForDetails && (
          <div className="w-1/3 h-full border-l border-border overflow-hidden">
            <TaskExecutionPanel
              task={tasks.find(t => t.id === executingTaskId)}
              projectId={params.projectId as string}
              repoUrl={project.repoUrl}
              onClose={() => setExecutingTaskId(null)}
              onTaskUpdate={(updatedTask) => {
                // Find the In Review column
                const inReviewColumn = project.columns.find(col => 
                  col.name.toLowerCase().includes('review')
                );
                
                // Update the task with the correct columnId
                const taskWithColumn = {
                  ...updatedTask,
                  columnId: inReviewColumn?.id || updatedTask.columnId
                };
                
                // Update the task in state
                setTasks(prevTasks => 
                  prevTasks.map(t => 
                    t.id === taskWithColumn.id ? taskWithColumn : t
                  )
                );
              }}
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