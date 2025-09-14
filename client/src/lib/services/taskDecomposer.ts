import { PrismaClient } from '@prisma/client';

interface Subtask {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  affectedFiles: string[];
  operationType: 'create' | 'modify' | 'delete';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  order: number;
}

interface DecompositionResult {
  taskId: string;
  subtasks: Subtask[];
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
  totalFiles: number;
  requiresBackend: boolean;
}

export class TaskDecomposer {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Decompose a task into atomic subtasks based on project context
   */
  async decomposeTask(
    taskId: string,
    taskTitle: string,
    taskDescription: string,
    projectId: string
  ): Promise<DecompositionResult> {
    console.log(`[TaskDecomposer] Decomposing task: ${taskTitle}`);
    
    // Load project context
    const projectContext = await this.prisma.projectContext.findUnique({
      where: { projectId }
    });

    // Analyze task to identify required operations
    const analysis = await this.analyzeTask(taskTitle, taskDescription, projectContext);
    
    // Generate subtasks based on analysis
    const subtasks = await this.generateSubtasks(analysis, projectContext);
    
    // Order subtasks by dependencies
    const orderedSubtasks = this.orderByDependencies(subtasks);
    
    // Store decomposition in database
    await this.storeDecomposition(taskId, orderedSubtasks);
    
    return {
      taskId,
      subtasks: orderedSubtasks,
      estimatedComplexity: analysis.complexity,
      totalFiles: analysis.affectedFiles.length,
      requiresBackend: analysis.requiresBackend
    };
  }

  /**
   * Analyze task to understand what needs to be done
   */
  private async analyzeTask(
    title: string,
    description: string,
    context: any
  ): Promise<any> {
    const analysis = {
      requiresBackend: false,
      requiresFrontend: false,
      requiresDatabase: false,
      affectedFiles: [] as string[],
      operations: [] as string[],
      complexity: 'simple' as 'simple' | 'moderate' | 'complex'
    };

    const taskLower = `${title} ${description}`.toLowerCase();
    
    // Detect backend requirements
    if (taskLower.includes('backend') || 
        taskLower.includes('api') || 
        taskLower.includes('server') ||
        taskLower.includes('database') ||
        taskLower.includes('crud')) {
      analysis.requiresBackend = true;
      analysis.requiresDatabase = true;
    }
    
    // Detect frontend requirements
    if (taskLower.includes('component') || 
        taskLower.includes('ui') || 
        taskLower.includes('page') ||
        taskLower.includes('form') ||
        taskLower.includes('list')) {
      analysis.requiresFrontend = true;
    }
    
    // Detect specific features
    if (taskLower.includes('todo')) {
      analysis.operations.push('create_todo_model', 'create_todo_api', 'create_todo_ui');
      analysis.affectedFiles.push(
        'prisma/schema.prisma',
        'app/api/todos/route.ts',
        'components/TodoList.tsx',
        'components/TodoItem.tsx'
      );
    }
    
    if (taskLower.includes('counter')) {
      analysis.operations.push('create_counter_component', 'add_counter_state');
      analysis.affectedFiles.push(
        'components/Counter.tsx',
        'app/page.tsx'
      );
    }
    
    if (taskLower.includes('auth')) {
      analysis.operations.push('setup_auth_provider', 'create_login_form', 'add_session_management');
      analysis.requiresBackend = true;
      analysis.complexity = 'complex';
    }
    
    // Determine complexity
    if (analysis.operations.length > 5) {
      analysis.complexity = 'complex';
    } else if (analysis.operations.length > 2) {
      analysis.complexity = 'moderate';
    }
    
    return analysis;
  }

  /**
   * Generate subtasks based on task analysis
   */
  private async generateSubtasks(
    analysis: any,
    context: any
  ): Promise<Subtask[]> {
    const subtasks: Subtask[] = [];
    let subtaskId = 0;
    
    // Backend subtasks
    if (analysis.requiresBackend) {
      // Check if backend exists
      if (!context?.backendType) {
        subtasks.push({
          id: `subtask_${++subtaskId}`,
          name: 'Setup backend infrastructure',
          description: 'Initialize API routes structure',
          dependencies: [],
          affectedFiles: ['app/api/'],
          operationType: 'create',
          status: 'pending',
          order: subtaskId
        });
      }
      
      if (analysis.requiresDatabase) {
        subtasks.push({
          id: `subtask_${++subtaskId}`,
          name: 'Setup database schema',
          description: 'Create or update Prisma schema',
          dependencies: [],
          affectedFiles: ['prisma/schema.prisma'],
          operationType: context?.ormType ? 'modify' : 'create',
          status: 'pending',
          order: subtaskId
        });
        
        subtasks.push({
          id: `subtask_${++subtaskId}`,
          name: 'Run database migration',
          description: 'Apply schema changes to database',
          dependencies: [`subtask_${subtaskId - 1}`],
          affectedFiles: [],
          operationType: 'modify',
          status: 'pending',
          order: subtaskId
        });
      }
    }
    
    // Feature-specific subtasks
    for (const operation of analysis.operations) {
      const subtask = this.createSubtaskForOperation(operation, subtaskId, analysis, context);
      if (subtask) {
        subtasks.push(subtask);
        subtaskId++;
      }
    }
    
    // Frontend integration subtask (always last)
    if (analysis.requiresFrontend) {
      subtasks.push({
        id: `subtask_${++subtaskId}`,
        name: 'Integrate with main application',
        description: 'Update navigation and main page',
        dependencies: subtasks.filter(s => s.operationType === 'create').map(s => s.id),
        affectedFiles: ['app/page.tsx', 'components/navigation.tsx'],
        operationType: 'modify',
        status: 'pending',
        order: subtaskId
      });
    }
    
    return subtasks;
  }

  /**
   * Create subtask for specific operation
   */
  private createSubtaskForOperation(
    operation: string,
    id: number,
    analysis: any,
    context: any
  ): Subtask | null {
    const subtaskMap: Record<string, Partial<Subtask>> = {
      'create_todo_model': {
        name: 'Create Todo model',
        description: 'Define Todo schema in database',
        affectedFiles: ['prisma/schema.prisma'],
        operationType: 'modify'
      },
      'create_todo_api': {
        name: 'Create Todo API endpoints',
        description: 'Implement CRUD operations for todos',
        affectedFiles: ['app/api/todos/route.ts'],
        operationType: 'create'
      },
      'create_todo_ui': {
        name: 'Create Todo UI components',
        description: 'Build TodoList and TodoItem components',
        affectedFiles: ['components/TodoList.tsx', 'components/TodoItem.tsx'],
        operationType: 'create'
      },
      'create_counter_component': {
        name: 'Create Counter component',
        description: 'Build interactive counter with state',
        affectedFiles: ['components/Counter.tsx'],
        operationType: 'create'
      },
      'add_counter_state': {
        name: 'Add counter state management',
        description: 'Implement increment/decrement logic',
        affectedFiles: ['components/Counter.tsx'],
        operationType: 'modify'
      }
    };
    
    const template = subtaskMap[operation];
    if (!template) return null;
    
    return {
      id: `subtask_${id + 1}`,
      name: template.name || operation,
      description: template.description || '',
      dependencies: [],
      affectedFiles: template.affectedFiles || [],
      operationType: template.operationType || 'create',
      status: 'pending',
      order: id + 1
    };
  }

  /**
   * Order subtasks based on dependencies
   */
  private orderByDependencies(subtasks: Subtask[]): Subtask[] {
    const ordered: Subtask[] = [];
    const remaining = [...subtasks];
    const completed = new Set<string>();
    
    while (remaining.length > 0) {
      const next = remaining.findIndex(task => 
        task.dependencies.length === 0 || 
        task.dependencies.every(dep => completed.has(dep))
      );
      
      if (next === -1) {
        // Circular dependency or missing dependency
        console.warn('[TaskDecomposer] Warning: Could not resolve all dependencies');
        ordered.push(...remaining);
        break;
      }
      
      const task = remaining.splice(next, 1)[0];
      task.order = ordered.length + 1;
      ordered.push(task);
      completed.add(task.id);
    }
    
    return ordered;
  }

  /**
   * Store decomposition in database for tracking
   */
  private async storeDecomposition(taskId: string, subtasks: Subtask[]): Promise<void> {
    try {
      // Store as JSON in a new field or related table
      // For now, we'll just log it
      console.log(`[TaskDecomposer] Stored ${subtasks.length} subtasks for task ${taskId}`);
    } catch (error) {
      console.error('[TaskDecomposer] Failed to store decomposition:', error);
    }
  }

  /**
   * Execute subtasks in order with progress tracking
   */
  async executeSubtasks(
    taskId: string,
    projectId: string,
    workspacePath: string,
    onProgress?: (subtask: Subtask, progress: number) => void
  ): Promise<void> {
    const decomposition = await this.getDecomposition(taskId);
    if (!decomposition) {
      throw new Error('No decomposition found for task');
    }
    
    const { subtasks } = decomposition;
    let completed = 0;
    
    for (const subtask of subtasks) {
      try {
        console.log(`[TaskDecomposer] Executing subtask ${subtask.order}/${subtasks.length}: ${subtask.name}`);
        
        // Update status
        subtask.status = 'in_progress';
        if (onProgress) {
          onProgress(subtask, (completed / subtasks.length) * 100);
        }
        
        // Execute based on operation type
        await this.executeSubtask(subtask, projectId, workspacePath);
        
        // Mark complete
        subtask.status = 'completed';
        completed++;
        
        if (onProgress) {
          onProgress(subtask, (completed / subtasks.length) * 100);
        }
      } catch (error) {
        console.error(`[TaskDecomposer] Subtask failed: ${subtask.name}`, error);
        subtask.status = 'failed';
        throw error;
      }
    }
  }

  /**
   * Execute individual subtask
   */
  private async executeSubtask(
    subtask: Subtask,
    projectId: string,
    workspacePath: string
  ): Promise<void> {
    // This will call the MCP tool for actual code generation
    // For now, just simulate execution
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`[TaskDecomposer] ✅ Completed: ${subtask.name}`);
  }

  /**
   * Get stored decomposition for a task
   */
  private async getDecomposition(taskId: string): Promise<DecompositionResult | null> {
    // Retrieve from database
    // For now, return null
    return null;
  }

  async cleanup() {
    await this.prisma.$disconnect();
  }
}