import { TaskDecomposer } from './taskDecomposer';
import { ContextManager } from './contextManager';

interface ExecutionResult {
  subtaskId: string;
  success: boolean;
  filesCreated: string[];
  filesModified: string[];
  error?: string;
  output?: string;
}

interface SubtaskProgress {
  subtaskId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message?: string;
}

export class SubtaskExecutor {
  private decomposer: TaskDecomposer;
  private contextManager: ContextManager;
  
  constructor() {
    this.decomposer = new TaskDecomposer();
    this.contextManager = new ContextManager();
  }

  /**
   * Execute a task by decomposing it into subtasks and running them sequentially
   */
  async executeTask(
    taskId: string,
    taskTitle: string,
    taskDescription: string,
    projectId: string,
    workspacePath: string,
    onProgress?: (progress: SubtaskProgress) => void
  ): Promise<ExecutionResult[]> {
    console.log(`[SubtaskExecutor] Starting execution of task: ${taskTitle}`);
    
    // Step 1: Load project context
    const context = await this.contextManager.loadContext(projectId);
    console.log(`[SubtaskExecutor] Loaded context for ${context.projectType} project`);
    
    // Step 2: Decompose task into subtasks
    const decomposition = await this.decomposer.decomposeTask(
      taskId,
      taskTitle,
      taskDescription,
      projectId
    );
    
    console.log(`[SubtaskExecutor] Decomposed into ${decomposition.subtasks.length} subtasks`);
    
    // Step 3: Execute subtasks in order
    const results: ExecutionResult[] = [];
    let completedCount = 0;
    
    for (const subtask of decomposition.subtasks) {
      // Update progress
      if (onProgress) {
        onProgress({
          subtaskId: subtask.id,
          name: subtask.name,
          status: 'running',
          progress: (completedCount / decomposition.subtasks.length) * 100,
          message: `Executing: ${subtask.description}`
        });
      }
      
      try {
        // Execute subtask based on its type
        const result = await this.executeSubtask(
          subtask,
          projectId,
          workspacePath,
          context
        );
        
        results.push(result);
        completedCount++;
        
        // Update context after successful execution
        await this.updateContextAfterSubtask(projectId, result);
        
        // Update progress
        if (onProgress) {
          onProgress({
            subtaskId: subtask.id,
            name: subtask.name,
            status: 'completed',
            progress: (completedCount / decomposition.subtasks.length) * 100,
            message: `✅ Completed: ${subtask.name}`
          });
        }
      } catch (error: any) {
        console.error(`[SubtaskExecutor] Subtask failed: ${subtask.name}`, error);
        
        results.push({
          subtaskId: subtask.id,
          success: false,
          filesCreated: [],
          filesModified: [],
          error: error.message
        });
        
        if (onProgress) {
          onProgress({
            subtaskId: subtask.id,
            name: subtask.name,
            status: 'failed',
            progress: (completedCount / decomposition.subtasks.length) * 100,
            message: `❌ Failed: ${error.message}`
          });
        }
        
        // Decide whether to continue or stop
        if (subtask.dependencies.length > 0) {
          console.log('[SubtaskExecutor] Stopping execution due to failed dependency');
          break;
        }
      }
    }
    
    // Step 4: Save final context
    if (results.filter(r => r.success).length > 0) {
      await this.contextManager.saveContext(projectId, {
        taskId,
        title: taskTitle,
        subtasks: decomposition.subtasks.length,
        completed: results.filter(r => r.success).length,
        filesCreated: results.flatMap(r => r.filesCreated),
        filesModified: results.flatMap(r => r.filesModified)
      });
    }
    
    console.log(`[SubtaskExecutor] Task execution complete. ${results.filter(r => r.success).length}/${decomposition.subtasks.length} subtasks succeeded`);
    
    return results;
  }

  /**
   * Execute individual subtask
   */
  private async executeSubtask(
    subtask: any,
    projectId: string,
    workspacePath: string,
    context: any
  ): Promise<ExecutionResult> {
    console.log(`[SubtaskExecutor] Executing subtask: ${subtask.name}`);
    
    // Prepare subtask-specific prompt
    const prompt = this.buildSubtaskPrompt(subtask, context);
    
    // Call MCP tool with context
    const response = await this.callMCPTool(
      'generate_code_with_context',
      {
        task_title: subtask.name,
        task_description: prompt,
        project_id: projectId,
        projectId: projectId,  // Add both formats for compatibility
        workspace_path: workspacePath,
        workspacePath: workspacePath  // Add camelCase version expected by MCP execute
      }
    );
    
    if (response.success) {
      return {
        subtaskId: subtask.id,
        success: true,
        filesCreated: response.changes?.filter((c: any) => c.type === 'created').map((c: any) => c.path) || [],
        filesModified: response.changes?.filter((c: any) => c.type === 'modified').map((c: any) => c.path) || [],
        output: response.summary
      };
    } else {
      throw new Error(response.error || 'Subtask execution failed');
    }
  }

  /**
   * Build context-aware prompt for subtask
   */
  private buildSubtaskPrompt(subtask: any, context: any): string {
    let prompt = subtask.description;
    
    // Add context about what needs to be done
    if (subtask.operationType === 'modify') {
      prompt += `\n\nIMPORTANT: This file already exists. You must MODIFY it, not replace it.`;
      prompt += `\nPreserve all existing functionality and add new features incrementally.`;
    }
    
    if (subtask.operationType === 'create') {
      prompt += `\n\nThis is a NEW file/component. Follow the project's existing patterns.`;
    }
    
    // Add file-specific instructions
    if (subtask.affectedFiles.length > 0) {
      prompt += `\n\nFiles to work with: ${subtask.affectedFiles.join(', ')}`;
    }
    
    // Add dependency information
    if (subtask.dependencies.length > 0) {
      prompt += `\n\nThis subtask depends on previous subtasks being completed.`;
      prompt += `\nAssume the dependencies have been successfully implemented.`;
    }
    
    return prompt;
  }

  /**
   * Call MCP tool
   */
  private async callMCPTool(tool: string, params: any): Promise<any> {
    try {
      // When running server-side, we need to use the full URL
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const response = await fetch(`${baseUrl}/api/mcp/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add internal API key for server-to-server calls
          'x-internal-key': process.env.INTERNAL_API_KEY || 'kanbanix-internal-mcp-call'
        },
        body: JSON.stringify({
          tool,
          params
        })
      });
      
      if (!response.ok) {
        throw new Error(`MCP call failed: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error: any) {
      console.error('[SubtaskExecutor] MCP call failed:', error);
      throw error;
    }
  }

  /**
   * Update context after subtask execution
   */
  private async updateContextAfterSubtask(
    projectId: string,
    result: ExecutionResult
  ): Promise<void> {
    if (!result.success) return;
    
    try {
      // Save updated context if files were created/modified
      if (result.filesCreated.length > 0 || result.filesModified.length > 0) {
        await this.contextManager.saveContext(projectId, {
          filesCreated: result.filesCreated,
          filesModified: result.filesModified
        });
      }
    } catch (error) {
      console.error('[SubtaskExecutor] Failed to update context:', error);
    }
  }
}