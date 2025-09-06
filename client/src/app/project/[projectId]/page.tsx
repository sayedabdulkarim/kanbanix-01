'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowLeft, Plus, Loader2, RefreshCw, GitBranch, GitCommit, GitPullRequest, ExternalLink, PowerOff } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import workspaceService from '@/lib/services/workspaceService';
import { API_ENDPOINTS, apiFetch } from '@/lib/config/api';
import toast from 'react-hot-toast';
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
import CommitModal from '@/components/modals/CommitModal';
import UncommittedChangesModal from '@/components/modals/UncommittedChangesModal';

interface ProjectData {
  id: string;
  name: string;
  description: string;
  gradient: string;
  columns: Column[];
  tasks: Task[];
  githubOwner?: string;
  githubRepo?: string;
  githubRepoUrl?: string;
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
  
  // Phase 3: State for Commit/PR buttons and session management
  const [sessionState, setSessionState] = useState<any>(null);
  const [hasUncommittedChanges, setHasUncommittedChanges] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCreatingPR, setIsCreatingPR] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [prCreated, setPrCreated] = useState(false);
  const [totalCommitsInSession, setTotalCommitsInSession] = useState(0);
  const [isProcessingPRMerge, setIsProcessingPRMerge] = useState(false);
  
  // Add refs to prevent duplicate initialization
  const initializationRef = useRef(false);
  const currentProjectIdRef = useRef<string | null>(null);
  
  // Phase 4: Modal states
  const [isCommitModalOpen, setIsCommitModalOpen] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [showUncommittedModal, setShowUncommittedModal] = useState(false);
  const [uncommittedTasks, setUncommittedTasks] = useState<Task[]>([]);

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
    
    // Check if we need to initialize or if project changed
    const needsInit = status === 'authenticated' && 
                     params.projectId && 
                     !isEndingSession && 
                     (!initializationRef.current || currentProjectIdRef.current !== params.projectId);
    
    if (needsInit) {
      initializationRef.current = true;
      currentProjectIdRef.current = params.projectId;
      initializeProject().finally(() => {
        // Reset initialization flag after completion to allow re-init if needed
        initializationRef.current = false;
      });
    }
  }, [params.projectId, status, router]);

  // State to track if we need to check for merge completion
  const [checkingForMerge, setCheckingForMerge] = useState(false);
  const [lastPRNumber, setLastPRNumber] = useState<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCheckingRef = useRef(false); // Prevent concurrent checks
  const prDetectedAtRef = useRef<Date | null>(null); // Track when PR was first detected

  // Poll for session state changes and PR status
  useEffect(() => {
    if (!project?.id || isEndingSession) return;

    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const checkStatus = async () => {
      // Prevent concurrent checks
      if (isCheckingRef.current || isEndingSession || isProcessingPRMerge) return;
      
      // Skip if document is hidden (user is on another tab)
      if (document.hidden) return;
      
      isCheckingRef.current = true;
      
      try {
      
      // Fetch session state and use the returned value directly
      const currentSessionState = await fetchSessionState();
      
      // Check PR status if PR exists (either in session, tasks in review, or recently moved to done)
      const tasksWithPR = tasks.filter(t => t.githubPrNumber && t.githubPrNumber !== null && t.status === 'inReview');
      const tasksJustMerged = tasks.filter(t => t.githubPrNumber && t.githubPrNumber !== null && t.status === 'done' && t.githubState === 'merged');
      
      // Enhanced debug logging for PR detection
      const tasksInReview = tasks.filter(t => t.status === 'inReview');
      const tasksInDoneWithMergedState = tasks.filter(t => t.status === 'done' && t.githubState === 'merged');
      console.log('[PR Detection Debug]', {
        tasksWithPR: tasksWithPR.length,
        tasksJustMerged: tasksJustMerged.length,
        tasksInDoneWithMergedState: tasksInDoneWithMergedState.length,
        totalTasksInReview: tasksInReview.length,
        taskPRNumbers: tasksWithPR.map(t => t.githubPrNumber),
        mergedTasksPRNumbers: tasksJustMerged.map(t => ({ id: t.id, prNumber: t.githubPrNumber })),
        lastPRNumber,
        sessionPR: currentSessionState?.prNumber,
        isProcessingPRMerge,
        checkingForMerge,
        prDetectedAt: prDetectedAtRef.current ? new Date().getTime() - prDetectedAtRef.current.getTime() : null
      });
      
      // Check if we should look for PR status
      // Check session state, PR created flag, tasks for PR info, and lastPRNumber
      const hasPR = (currentSessionState?.prCreated && currentSessionState?.prNumber) || 
                    currentSessionState?.prNumber || 
                    tasksWithPR.length > 0 ||
                    lastPRNumber !== null;
      
      // Track PR number from any source (prioritize lastPRNumber if set)
      const currentPRNumber = lastPRNumber || currentSessionState?.prNumber || tasksWithPR[0]?.githubPrNumber || null;
      
      console.log('[PR Status Check]', {
        hasPR,
        currentPRNumber,
        checkingForMerge,
        willCheckStatus: hasPR || checkingForMerge
      });
      
      // Track when PR is first detected
      if (currentPRNumber && !prDetectedAtRef.current) {
        prDetectedAtRef.current = new Date();
        console.log('[PR Tracking] PR detected, will monitor for up to 30 minutes');
      } else if (!currentPRNumber && !tasksJustMerged.length) {
        // Only reset if there's no PR AND no recently merged tasks
        if (prDetectedAtRef.current) {
          console.log('[PR Tracking] PR tracking cleared - no active PR');
        }
        prDetectedAtRef.current = null;
      }
      
      // Stop checking after 30 minutes of PR being open (user probably not actively merging)
      if (prDetectedAtRef.current) {
        const minutesElapsed = (Date.now() - prDetectedAtRef.current.getTime()) / 1000 / 60;
        if (minutesElapsed > 30) {
          console.log('[PR Tracking] PR has been open for 30+ minutes, reducing check frequency');
          // Only check when tab becomes visible again
          if (document.hidden) {
            console.log('[PR Tracking] Tab hidden, skipping check');
            return;
          }
        }
      }
      
      // Detect when PR disappears (likely merged)
      if (lastPRNumber && !currentPRNumber && !checkingForMerge) {
        console.log('[PR Status] PR disappeared, checking if it was merged...');
        setCheckingForMerge(true);
      }
      
      setLastPRNumber(currentPRNumber);
      
      // Check PR status if we have one or are checking for merge
      if (hasPR || checkingForMerge) {
        console.log('[PR API Call] Initiating PR status check - hasPR:', hasPR, 'checkingForMerge:', checkingForMerge, 'currentPR:', currentPRNumber);
        
        try {
          const response = await fetch('/api/workspace/check-pr-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: project.id })
          });
          
          if (response.ok) {
            const data = await response.json();
            console.log('[PR API Response]', data);
            
            // Log specific conditions for debugging
            if (data.prExists) {
              console.log(`PR #${data.prNumber} exists, state: ${data.prState}, merged: ${data.prMerged}`);
            }
            
            if (data.prMerged && !isProcessingPRMerge && !data.alreadyProcessed) {
              // PR was JUST merged (not already processed)
              console.log('[PR Merged!] Updating UI and syncing repository...');
              setIsProcessingPRMerge(true);
              setCheckingForMerge(false);
              
              if (data.warning) {
                console.log('[PR Merge Warning]', data.warning);
                toast.warning('PR was merged but had some issues. Updating board...');
              } else {
                toast.success('PR merged! Moving tasks to Done...');
              }
              
              // Sync git repository and refresh data
              setTimeout(async () => {
                try {
                  // Sync the git repository to get latest changes
                  const syncResponse = await fetch('/api/workspace/sync-git', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: project.id })
                  });
                  
                  if (syncResponse.ok) {
                    const syncData = await syncResponse.json();
                    console.log('Git sync result:', syncData);
                  }
                } catch (syncError) {
                  console.error('Error syncing git:', syncError);
                }
                
                // Refresh project and session data
                await fetchProject();
                await fetchSessionState();
                setIsProcessingPRMerge(false);
                
                // Clear PR tracking since merge is complete
                prDetectedAtRef.current = null;
                setLastPRNumber(null);
                
                toast.success('Board updated successfully!');
                console.log('PR merge handled, returning to normal polling');
              }, 2000);
              
              return; // Exit early to prevent further processing
            } else if (data.alreadyProcessed) {
              // PR was already processed in a previous session
              console.log('PR already processed, no action needed');
              setCheckingForMerge(false);
              setIsProcessingPRMerge(false);
              // Clear any PR tracking since it's already done
              prDetectedAtRef.current = null;
              setLastPRNumber(null);
              // Don't refresh or sync - just continue normal operation
            } else if (!data.prExists && checkingForMerge) {
              // We were checking for merge but PR no longer exists
              console.log('PR no longer exists after checking for merge');
              setCheckingForMerge(false);
              
              // Just refresh the data to ensure sync
              await fetchProject();
              await fetchSessionState();
            } else if (data.prExists && !data.prMerged) {
              // PR exists but not merged yet
              console.log(`PR #${data.prNumber} exists but not merged yet`);
            } else {
              // No special condition, reset checking flag if set
              if (checkingForMerge && !data.prExists) {
                setCheckingForMerge(false);
              }
            }
          } else if (response.status === 500) {
            // Server error - don't crash the UI, just log it
            console.error('Server error checking PR status, will retry next poll');
            // Don't throw or redirect, just continue
          }
        } catch (error) {
          console.error('[PR Error] Error checking PR status:', error);
          // Don't throw or redirect, just log and continue
        }
      } else {
        console.log('[PR Check Skipped] No PR to check - hasPR:', hasPR, 'checkingForMerge:', checkingForMerge);
      }
      
      // After PR check, handle merged tasks if they exist
      if (tasksJustMerged.length > 0 && !isProcessingPRMerge && !checkingForMerge) {
        console.log('[Merge Detection] Found merged tasks in done column, updating UI...');
        setIsProcessingPRMerge(true);
        toast.success('PR merged! Tasks moved to Done.');
        
        // Refresh the data to show updated state
        setTimeout(async () => {
          await fetchProject();
          await fetchSessionState();
          setIsProcessingPRMerge(false);
          setCheckingForMerge(false);
          // Clear PR tracking since merge is complete
          prDetectedAtRef.current = null;
          setLastPRNumber(null);
          console.log('[Merge Complete] Regular polling resumed');
        }, 1000);
      }
      
      } finally {
        isCheckingRef.current = false;
      }
    };

    // Initial check
    checkStatus();
    
    // Set up interval with fixed timing (5 seconds)
    intervalRef.current = setInterval(checkStatus, 5000);
    
    // Check immediately when tab becomes visible again
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('Tab became visible, checking for updates...');
        checkStatus();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [project?.id, isEndingSession]); // Only re-run when project changes or session ends

  const initializeProject = async () => {
    try {
      setLoading(true);
      
      // First fetch project data
      await fetchProject();
      
      // Then enter workspace
      await enterWorkspace();
      
      // Fetch initial session state
      await fetchSessionState();
      
    } catch (error) {
      console.error('Error initializing project:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionState = async () => {
    try {
      const response = await fetch(`/api/workspace/session?projectId=${params.projectId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.exists && data.sessionState) {
          setSessionState(data.sessionState);
          setHasUncommittedChanges(data.sessionState.hasUncommittedChanges);
          setPrCreated(data.sessionState.prCreated);
          setTotalCommitsInSession(data.sessionState.totalCommitsInSession);
          return data.sessionState;
        }
      }
    } catch (error) {
      console.error('Error fetching session state:', error);
    }
    return null;
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
      toast.error('Failed to refresh workspace');
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
      
      // Check if any tasks have PR numbers and update tracking
      const tasksWithPR = (data.tasks || []).filter((t: Task) => t.githubPrNumber && t.status === 'inReview');
      if (tasksWithPR.length > 0 && !lastPRNumber) {
        const prNumber = tasksWithPR[0].githubPrNumber;
        console.log(`[fetchProject] Detected PR #${prNumber} from tasks`);
        setLastPRNumber(prNumber);
        if (!prDetectedAtRef.current) {
          prDetectedAtRef.current = new Date();
        }
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
      toast.error('Failed to save task. Please try again.');
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
        toast.error('Failed to delete task. Please try again.');
      }
    }
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTaskForDetails(task);
  };

  // Phase 2: Handle Commit All functionality - Updated to use modal
  const handleCommitAll = async (customMessage?: string) => {
    console.log('handleCommitAll called with:', customMessage);
    if (!project) return;
    
    // If no custom message provided, open modal
    if (!customMessage) {
      console.log('Opening commit modal');
      setIsCommitModalOpen(true);
      return;
    }
    
    console.log('Processing commit with message:', customMessage);
    setIsCommitting(true);
    try {
      // Get all tasks in review
      const tasksInReview = tasks.filter(t => t.status === 'inReview');
      
      if (tasksInReview.length === 0) {
        toast.error('No tasks in review to commit');
        return;
      }
      
      console.log('Calling /api/workspace/commit-all with:', {
        projectId: project.id,
        message: customMessage,
        taskIds: tasksInReview.map(t => t.id)
      });
      
      const response = await fetch('/api/workspace/commit-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          message: customMessage,
          taskIds: tasksInReview.map(t => t.id)
        })
      });
      
      if (response.ok) {
        setHasUncommittedChanges(false);
        setIsCommitModalOpen(false);
        // Refresh session state to get updated commit info
        await fetchSessionState();
        // Show success toast
        toast.success('All changes committed successfully!');
      } else {
        const error = await response.json();
        throw new Error(error.message || 'Failed to commit changes');
      }
    } catch (error: any) {
      console.error('Commit error:', error);
      throw error; // Let modal handle the error
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
      
      const data = await response.json();
      
      // Check if PR was actually created (even if there were task update errors)
      if (response.ok || (data.success && data.pullRequest)) {
        setPrCreated(true);
        
        // Start monitoring for PR immediately
        if (data.pullRequest?.number) {
          setLastPRNumber(data.pullRequest.number);
          prDetectedAtRef.current = new Date();
          console.log(`PR #${data.pullRequest.number} created, starting monitoring`);
        }
        
        // Refresh both session state AND project data to get updated task PR info
        await fetchSessionState();
        await fetchProject(); // This will reload tasks with their updated githubPrNumber
        
        // Open PR URL in new tab
        if (data.pullRequest?.url) {
          console.log('Opening PR URL:', data.pullRequest.url);
          window.open(data.pullRequest.url, '_blank');
        }
        
        toast.success(`Pull request created successfully! PR #${data.pullRequest?.number || ''}`);
        
        // Don't auto-move tasks to done - wait for PR merge
        // Tasks stay in review until PR is actually merged
      } else {
        // Only show error if PR creation truly failed
        toast.error(`Failed to create PR: ${data.error || data.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('PR creation error:', error);
      toast.error('Failed to create pull request');
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
      toast.error('Failed to update task. Please try again.');
    }
  };

  // Handle End Session - cleanup and return to home
  const handleEndSession = async () => {
    // Check for tasks in progress that will lose their work
    try {
      // Only check for tasks in progress (not done or inReview, as they're safe)
      const tasksInProgress = tasks.filter(task => task.status === 'inProgress');
      
      // Check if there are tasks with saved diffs (these will preserve the workspace)
      const tasksWithSavedDiffs = tasks.filter(task => 
        (task.status === 'inReview' || task.status === 'done') && task.diffs
      );
      
      // If there are tasks in progress, show warning modal
      if (tasksInProgress.length > 0) {
        setShowUncommittedModal(true);
        setUncommittedTasks(tasksInProgress);
        setHasUncommittedChanges(true); // In progress tasks always have potential changes
        return;
      }
    } catch (error) {
      console.error('Error checking tasks in progress:', error);
    }
    
    // If no uncommitted changes, proceed with normal confirmation
    const confirmed = confirm(
      'End this session?\n\n' +
      '• Any running dev servers will be stopped\n' +
      '• Tasks in "Done" and "In Review" will keep their saved changes\n' +
      '• You will be redirected to the home page\n\n' +
      'This ensures a fresh start next time you open this project.'
    );
    
    if (!confirmed) return;
    
    await proceedWithEndSession();
  };
  
  const proceedWithEndSession = async () => {
    try {
      // Set flag to stop all polling and workspace operations
      setIsEndingSession(true);
      setWorkspaceLoading(true);
      setShowUncommittedModal(false);
      
      // First, redirect to prevent any further workspace operations
      // This prevents re-cloning while the cleanup is happening
      router.push('/');
      
      // Then call the cleanup endpoint
      const response = await fetch('/api/workspace/end-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project?.id })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Session ended successfully:', result);
      } else {
        const error = await response.json();
        console.error('Failed to end session:', error.message || 'Unknown error');
        toast.error(`Failed to end session: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error ending session:', error);
      toast.error('Failed to end session. Please try again.');
    }
  };

  // Handle Update PR (push new commits)
  const handleUpdatePR = async () => {
    if (!project) return;
    
    setIsCreatingPR(true);
    try {
      const response = await fetch('/api/workspace/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          branch: sessionState?.sessionBranch
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        // Refresh session state to get updated timestamps
        const updatedSession = await fetchSessionState();
        // Open PR to show updates
        const prUrl = updatedSession?.prUrl || sessionState?.prUrl;
        if (prUrl) {
          window.open(prUrl, '_blank');
        }
        toast.success('PR updated with new commits!');
      } else {
        const error = await response.json();
        toast.error(`Failed to update PR: ${error.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error updating PR:', error);
      toast.error('Failed to update pull request');
    } finally {
      setIsCreatingPR(false);
    }
  };
  
  // Phase 4: Determine PR button state
  const getPRButtonState = () => {
    // First check if any task has a PR number (persistent across sessions)
    const tasksWithPR = tasks.filter(t => t.githubPrNumber && t.status === 'inReview');
    const hasPR = tasksWithPR.length > 0 || sessionState?.prCreated;
    
    // Check if PR was merged (session would be reset)
    if (sessionState?.prMerged) {
      // This shouldn't happen as session is reset, but handle it anyway
      return {
        text: 'Create PR',
        action: handleCreatePR,
        disabled: isCreatingPR || hasUncommittedChanges || totalCommitsInSession === 0,
        tooltip: hasUncommittedChanges 
          ? 'Please commit changes first' 
          : totalCommitsInSession === 0
          ? 'No commits to create PR from'
          : 'Create pull request for new work'
      };
    }
    
    if (!hasPR) {
      return {
        text: 'Create PR',
        action: handleCreatePR,
        disabled: isCreatingPR || hasUncommittedChanges || totalCommitsInSession === 0,
        tooltip: hasUncommittedChanges 
          ? 'Please commit changes first' 
          : totalCommitsInSession === 0
          ? 'No commits to create PR from'
          : 'Create pull request'
      };
    }
    
    // PR exists - check if there are new commits
    const hasNewCommits = sessionState?.lastCommitAt > sessionState?.prCreatedAt;
    
    if (hasNewCommits) {
      return {
        text: 'Update PR',
        action: handleUpdatePR,
        disabled: isCreatingPR || hasUncommittedChanges,
        tooltip: hasUncommittedChanges 
          ? 'Please commit changes first'
          : 'Push new commits to existing PR'
      };
    }
    
    // No new commits - just view PR
    // Build PR URL from task info if sessionState doesn't have it
    let prUrl = sessionState?.prUrl;
    if (!prUrl && tasksWithPR.length > 0 && project) {
      const taskWithPR = tasksWithPR[0];
      prUrl = `https://github.com/${project.githubOwner}/${project.githubRepo}/pull/${taskWithPR.githubPrNumber}`;
    }
    
    return {
      text: 'View PR',
      action: () => {
        if (prUrl) {
          window.open(prUrl, '_blank');
        }
      },
      disabled: false,
      tooltip: 'Open pull request in GitHub'
    };
  };
  
  const prButtonState = getPRButtonState();

  return (
    <div className="min-h-screen bg-background">
      {/* Loading overlay for PR merge processing */}
      {isProcessingPRMerge && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-card border border-border rounded-lg p-6 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="font-semibold">Updating Board</p>
              <p className="text-sm text-muted-foreground mt-1">Syncing changes and moving tasks to Done...</p>
            </div>
          </div>
        </div>
      )}
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
              {/* End Session button */}
              <button
                onClick={handleEndSession}
                disabled={workspaceLoading}
                className="p-2 rounded-lg hover:bg-destructive/10 text-destructive transition-colors disabled:opacity-50"
                title="End session and cleanup workspace"
              >
                <PowerOff className="h-5 w-5" />
              </button>
              
              <div className="w-px h-6 bg-border" /> {/* Separator */}
              
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
                onClick={() => handleCommitAll()}
                disabled={isCommitting || tasks.filter(t => t.status === 'inReview').length === 0 || !hasUncommittedChanges}
                className="px-4 py-2 rounded-lg border border-border hover:bg-secondary transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={tasks.filter(t => t.status === 'inReview').length === 0 
                  ? "No tasks in review to commit" 
                  : !hasUncommittedChanges
                  ? "No uncommitted changes"
                  : "Commit all reviewed tasks"}
              >
                <GitCommit className="h-4 w-4" />
                {isCommitting ? 'Committing...' : 'Commit All'}
              </button>
              <button
                onClick={prButtonState.action}
                disabled={prButtonState.disabled}
                className={cn(
                  "px-4 py-2 rounded-lg border transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed",
                  prButtonState.text === 'Update PR' && "border-yellow-500 hover:bg-yellow-500/10",
                  prButtonState.text === 'View PR' && "border-green-500 hover:bg-green-500/10",
                  prButtonState.text === 'Create PR' && "border-border hover:bg-secondary"
                )}
                title={prButtonState.tooltip}
              >
                {prButtonState.text === 'View PR' ? (
                  <ExternalLink className="h-4 w-4" />
                ) : (
                  <GitPullRequest className={cn(
                    "h-4 w-4",
                    prButtonState.text === 'Update PR' && "animate-pulse"
                  )} />
                )}
                {isCreatingPR ? 'Processing...' : prButtonState.text}
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
                  
                  // Mark that we have uncommitted changes when task moves to review
                  if (updatedTask.status === 'inReview') {
                    setHasUncommittedChanges(true);
                    // Also refresh session state to ensure consistency
                    fetchSessionState();
                  }
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
                
                // Mark that we have uncommitted changes when task moves to review
                if (updatedTask.status === 'inReview') {
                  setHasUncommittedChanges(true);
                  // Also refresh session state to ensure consistency
                  fetchSessionState();
                }
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
      
      {/* Commit Modal */}
      <CommitModal
        isOpen={isCommitModalOpen}
        onClose={() => setIsCommitModalOpen(false)}
        onCommit={handleCommitAll}
        tasksToCommit={tasks.filter(t => t.status === 'inReview')}
        projectName={project?.name || ''}
        isLoading={isCommitting}
      />
      
      {/* Uncommitted Changes Warning Modal */}
      <UncommittedChangesModal
        isOpen={showUncommittedModal}
        onClose={() => setShowUncommittedModal(false)}
        onConfirm={proceedWithEndSession}
        uncommittedTasks={uncommittedTasks}
        hasUncommittedChanges={hasUncommittedChanges}
      />
    </div>
  );
}