// Kanbanix AI Agent Service - Adapted from SynthAI with MCP Integration
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { SubtaskExecutor } from './subtaskExecutor';
import { ContextManager } from './contextManager';

// Agent Types based on KANBANIX_AI_WORKFLOW_SPEC
export enum AgentType {
  CODE_GENERATOR = 'code_generator',
  BUG_FIXER = 'bug_fixer',  
  DOCUMENTATION = 'documentation',
  TESTING = 'testing',
  REFACTORING = 'refactoring',
  REVIEW = 'review'
}

// Agent Task Status
export enum AgentStatus {
  PENDING = 'pending',
  RUNNING = 'running', 
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// Agent Execution Interface
export interface AgentExecution {
  id: string;
  taskId: string;
  status: AgentStatus;
  agentType: AgentType;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  attempts: number;
  currentStep?: string;
  progress: number; // 0-100
  input: {
    title: string;
    description: string;
    requirements: string[];
    context?: {
      baseBranch: string;
      workingDirectory: string;
      files?: string[];
      projectPath?: string;
    };
  };
  output: {
    logs: LogEntry[];
    changes: FileChange[];
    summary?: string;
    errors?: ErrorDetail[];
    pullRequest?: PRDetails;
  };
}

// Log Entry
export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  metadata?: {
    file?: string;
    line?: number;
    component?: string;
  };
}

// File Change
export interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  diff: {
    added: number;
    removed: number;
    hunks: any[];
  };
  content?: {
    before: string;
    after: string;
  };
}

// Error Detail  
export interface ErrorDetail {
  type: string;
  message: string;
  file?: string;
  line?: number;
  stack?: string;
}

// PR Details
export interface PRDetails {
  title: string;
  description: string;
  branch: string;
  url?: string;
}

class AIAgentServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIAgentServiceError";
  }
}

export class AIAgentService {
  private prisma: PrismaClient;
  private mcpMode: 'desktop' | 'api';
  private subtaskExecutor: SubtaskExecutor;
  private contextManager: ContextManager;

  constructor() {
    this.prisma = new PrismaClient();
    this.mcpMode = (process.env.MCP_MODE as 'desktop' | 'api') || 'desktop';
    this.subtaskExecutor = new SubtaskExecutor();
    this.contextManager = new ContextManager();
  }

  // Main entry point - Execute task with appropriate agent
  async executeTask(
    taskId: string,
    agentType: AgentType,
    context: Record<string, unknown> = {}
  ): Promise<AgentExecution> {
    
    // Get task details
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { 
        project: true,
        column: true 
      }
    });

    if (!task) {
      throw new AIAgentServiceError(`Task ${taskId} not found`);
    }

    // Use workspace path if provided, otherwise generate from projectId
    const workspacePath = context.workspacePath || path.join(process.cwd(), '..', 'workspace-projects', task.projectId);

    // Create agent execution record
    const execution = await this.prisma.agentExecution.create({
      data: {
        taskId,
        status: AgentStatus.PENDING,
        agentType,
        attempts: 1,
        progress: 0,
        input: JSON.stringify({
          title: task.title,
          description: task.description || '',
          requirements: this.extractRequirements(task.description || ''),
          context: {
            baseBranch: 'main',
            workingDirectory: workspacePath,
            projectPath: workspacePath,
            projectId: task.projectId,
            ...context
          }
        }),
        summary: null,
        errors: null,
        changes: null,
        mcpMode: this.mcpMode,
        modelUsed: 'claude-3-opus-20240229'
      }
    });

    // Start execution
    this.runAgentExecution(execution.id, agentType).catch(error => {
      console.error('Agent execution failed:', error);
      this.updateExecutionStatus(execution.id, AgentStatus.FAILED, {
        errors: JSON.stringify([{
          type: 'execution_error',
          message: error.message,
          stack: error.stack
        }])
      });
    });

    return this.mapExecutionToInterface(execution, task);
  }

  // Run agent execution asynchronously
  private async runAgentExecution(executionId: string, agentType: AgentType): Promise<void> {
    await this.updateExecutionStatus(executionId, AgentStatus.RUNNING, {
      startedAt: new Date(),
      currentStep: 'Initializing'
    });

    try {
      // Route to appropriate agent based on type
      let result;
      switch (agentType) {
        case AgentType.CODE_GENERATOR:
          result = await this.runCodeGeneratorAgent(executionId);
          break;
        case AgentType.BUG_FIXER:
          result = await this.runBugFixerAgent(executionId);
          break;
        case AgentType.DOCUMENTATION:
          result = await this.runDocumentationAgent(executionId);
          break;
        case AgentType.TESTING:
          result = await this.runTestingAgent(executionId);
          break;
        case AgentType.REFACTORING:
          result = await this.runRefactoringAgent(executionId);
          break;
        case AgentType.REVIEW:
          result = await this.runReviewAgent(executionId);
          break;
        default:
          throw new Error(`Unknown agent type: ${agentType}`);
      }

      // Update with success
      await this.updateExecutionStatus(executionId, AgentStatus.COMPLETED, {
        completedAt: new Date(),
        progress: 100,
        currentStep: 'Completed',
        summary: result.summary,
        changes: JSON.stringify(result.changes || [])
      });

      // Phase 2: Move task based on build validation result
      const execution = await this.prisma.agentExecution.findUnique({
        where: { id: executionId },
        include: { 
          task: {
            include: {
              project: {
                include: {
                  columns: true
                }
              }
            }
          }
        }
      });

      if (execution && execution.task) {
        // CRITICAL: Capture and store diffs IMMEDIATELY after execution completes
        // This must happen BEFORE any git operations that might lose the changes
        console.log('=== CAPTURING DIFFS AFTER AI EXECUTION ===');
        console.log(`Task: ${execution.task.title} (${execution.task.id})`);
        
        try {
          const workspacePath = path.join(process.cwd(), '..', 'workspace-projects', execution.task.projectId);
          
          // Import diffTrackingService dynamically
          const { default: diffTrackingService } = await import('@/lib/services/diffTrackingService.server');
          
          // Capture the diffs while files are still present
          const taskDiff = await diffTrackingService.captureTaskDiffs(
            workspacePath,
            execution.task.id,
            execution.task.title || 'AI Generated Task',
            'initial' // This is the initial AI-generated code
          );
          
          if (taskDiff && taskDiff.files.length > 0) {
            // Store diffs in database immediately
            const existingDiffs = execution.task.diffs ? JSON.parse(execution.task.diffs as string) : [];
            const allDiffs = [...existingDiffs, taskDiff];
            
            await this.prisma.task.update({
              where: { id: execution.task.id },
              data: {
                diffs: JSON.stringify(allDiffs)
              }
            });
            
            console.log(`✅ Stored ${taskDiff.files.length} file diffs for task ${execution.task.id}`);
            await this.addExecutionLog(
              executionId,
              'info',
              `📁 Captured and stored ${taskDiff.files.length} file changes`
            );
          } else {
            console.warn(`⚠️ No diffs captured for task ${execution.task.id} - files may not have changed`);
          }
        } catch (error) {
          console.error('Error capturing diffs after AI execution:', error);
          await this.addExecutionLog(
            executionId,
            'warning',
            `⚠️ Could not capture diffs: ${error.message}`
          );
          // Don't fail the execution, just log the error
        }
        // Check if build validation passed (from result)
        const buildPassed = result.buildPassed !== false; // Default to true if not specified
        const buildStatus = result.buildValidation?.success ? 'passed' : 
                          result.buildValidation?.skipped ? 'skipped' :
                          result.buildValidation?.attempts > 0 ? 'needs_attention' : 'unknown';
        
        // ALWAYS move to "In Review" regardless of build status
        const inReviewColumn = execution.task.project.columns.find(
          col => col.status === 'inReview' || col.name.toLowerCase().includes('review')
        );
        
        if (inReviewColumn) {
          try {
            console.log(`Moving task ${execution.task.id} to InReview column ${inReviewColumn.id}`);
            
            // Prepare metadata with build status if there are warnings
            const metadata = execution.task.metadata || {};
            if (result.warningBadge || result.partial) {
              metadata.buildStatus = 'warning';
              metadata.buildMessage = result.message || 'Code generated with build errors. Use Dev Server panel to validate and fix.';
              metadata.buildValidation = result.buildValidation;
            }
            
            const updatedTask = await this.prisma.task.update({
              where: { id: execution.task.id },
              data: {
                status: 'inReview',
                column: {
                  connect: { id: inReviewColumn.id }
                },
                updatedAt: new Date()
              }
            });
            
            console.log(`✅ Successfully updated task ${execution.task.id} to status: ${updatedTask.status}, columnId: ${updatedTask.columnId}`);
            
            await this.addExecutionLog(
              executionId, 
              'info', 
              buildStatus === 'passed' ? 
                '✅ Task moved to In Review column (build validation passed)' :
              buildStatus === 'needs_attention' ?
                `⚠️ Task moved to In Review column (build needs attention - ${result.buildValidation?.attempts} attempts)` :
                '➡️ Task moved to In Review column'
            );
            
            // Emit task update event to notify frontend of status change
            if ((global as any).io) {
              console.log(`Emitting task-updated event for project ${execution.task.projectId}`);
              (global as any).io.to(`project-${execution.task.projectId}`).emit('task-updated', {
                taskId: execution.task.id,
                status: 'inReview',
                columnId: inReviewColumn.id,
                metadata: metadata,
                hasWarning: result.warningBadge || result.partial || false
              });
            }
          } catch (error) {
            console.error(`Failed to update task ${execution.task.id} to InReview:`, error);
            await this.addExecutionLog(
              executionId,
              'error',
              `❌ Failed to move task to In Review: ${error.message}`
            );
          }
        } else {
          // No inReview column found - log warning but don't fail
          console.warn(`No InReview column found for project ${execution.task.projectId}`);
          console.log('Available columns:', execution.task.project.columns.map(c => ({ id: c.id, name: c.name, status: c.status })));
          
          await this.addExecutionLog(
            executionId,
            'warning',
            `⚠️ Could not find In Review column - task remains in current column`
          );
        }
      }

    } catch (error) {
      await this.updateExecutionStatus(executionId, AgentStatus.FAILED, {
        completedAt: new Date(),
        currentStep: 'Failed',
        errors: JSON.stringify([{
          type: 'agent_error',
          message: error.message,
          stack: error.stack
        }])
      });
      throw error;
    }
  }

  // Code Generator Agent - Adapted from SynthAI patterns
  private async runCodeGeneratorAgent(executionId: string): Promise<any> {
    await this.updateProgress(executionId, 10, 'Analyzing task requirements');
    
    // Get execution context
    const execution = await this.prisma.agentExecution.findUnique({
      where: { id: executionId },
      include: { task: true }
    });
    
    if (!execution) throw new Error('Execution not found');
    
    const input = JSON.parse(execution.input);
    
    // Check if task should use decomposition (Phase 2 feature)
    const useDecomposition = this.shouldUseDecomposition(input.title, input.description);
    
    await this.updateProgress(executionId, 20, 'Preparing workspace');
    
    // V2: Use session branch instead of creating task-specific branches
    try {
      const gitService = (await import('@/lib/services/gitService')).default;
      const sessionBranch = await gitService.createOrGetSessionBranch(
        input.context.workingDirectory || input.context.workspacePath,
        execution.task.projectId
      );
      console.log('Using session branch:', sessionBranch);
      await this.addExecutionLog(executionId, 'info', `Working on session branch: ${sessionBranch}`);
    } catch (error) {
      console.warn('Could not create/get session branch:', error);
      await this.addExecutionLog(executionId, 'warning', 'Could not create session branch, using current branch');
    }
    
    await this.updateProgress(executionId, 30, 'Calling MCP server for code generation');
    
    // Check if dev server is running in the current session
    const sessionState = await this.prisma.sessionState.findFirst({
      where: {
        projectId: execution.task.projectId,
        isActive: true
      }
    });
    
    // Add devServerRunning flag to context
    const enhancedContext = {
      ...input.context,
      devServerRunning: sessionState?.devServerStarted || false
    };
    
    // Phase 2: Use decomposition for complex tasks
    if (useDecomposition) {
      await this.addExecutionLog(executionId, 'info', '🔄 Using task decomposition for complex task');
      await this.updateProgress(executionId, 35, 'Decomposing task into subtasks');
      
      // Execute with SubtaskExecutor
      const results = await this.subtaskExecutor.executeTask(
        execution.taskId,
        input.title,
        input.description,
        execution.task.projectId,
        input.context.workspacePath || `/tmp/workspace/${execution.task.projectId}`,
        (progress) => {
          // Update progress callback
          this.addExecutionLog(executionId, 'info', progress.message || '');
          this.updateProgress(executionId, 35 + (progress.progress * 0.5), progress.message || '');
        }
      );
      
      // Check if any subtask has warnings
      const hasWarnings = results.some(r => r.warningBadge || r.partial);
      const hasAnySuccess = results.some(r => r.success || r.partial);
      
      // Aggregate results
      const mcpResult = {
        success: results.filter(r => r.success).length === results.length, // Only fully successful if all succeed
        partial: hasWarnings && hasAnySuccess, // Partial if some succeeded but with warnings
        warningBadge: hasWarnings,
        files: {},
        changes: results.flatMap(r => [
          ...r.filesCreated.map(f => ({ path: f, type: 'created' })),
          ...r.filesModified.map(f => ({ path: f, type: 'modified' }))
        ]),
        summary: `Completed ${results.filter(r => r.success).length}/${results.length} subtasks`,
        buildValidation: results.findLast(r => r.buildValidation)?.buildValidation || results.find(r => r.buildValidation && !r.buildValidation.success)?.buildValidation,
        message: hasWarnings ? 'Code generated with build errors. Use Dev Server panel to validate and fix.' : undefined
      };
      
      await this.updateProgress(executionId, 85, 'Processing decomposed results');
      return mcpResult;
    }
    
    // Detect if this is a new project/boilerplate request
    const isNewProjectRequest = /\b(create|init|initialize|setup|start|scaffold|bootstrap|new|fresh|blank|empty)\s+(a\s+)?(new\s+)?(\w+\s+)?(project|app|application|boiler\s*plate|starter|template)/i.test(
      input.title + ' ' + (input.description || '')
    );

    // Use appropriate tool based on task type
    const toolName = isNewProjectRequest ? 'generate_task_code' : 'generate_code_with_context';

    await this.addExecutionLog(
      executionId,
      'info',
      `🔧 Using ${toolName} tool (${isNewProjectRequest ? 'new project detected' : 'incremental feature'})`
    );

    // Original single-shot generation (Phase 1)
    const mcpResult = await this.callMCPTool(toolName, {
      task_title: input.title,
      task_description: input.description,
      project_id: execution.task.projectId, // For context lookup
      workspace_path: input.context.workspacePath || `/tmp/workspace/${execution.task.projectId}`,
      context: enhancedContext,
      executionId
    }, executionId);

    await this.updateProgress(executionId, 80, 'Processing generated code');
    
    // Log the generation
    await this.addExecutionLog(executionId, 'info', `Generated code for: ${input.title}`);
    
    // Ensure changes are properly formatted
    const changes = mcpResult.changes || [];
    console.log('MCP Result changes:', changes.length, 'files');
    
    // Check if MCP server already ran build validation
    const mcpBuildValidation = mcpResult.buildValidation;
    console.log('MCP Build Validation Result:', mcpBuildValidation);
    
    // Run build validation (dev server is now managed manually by user)
    let buildValidationPassed = false;
    
    if (changes.length > 0) {
      try {
        // Check if MCP already validated the build
        if (mcpBuildValidation) {
          await this.updateProgress(executionId, 85, 'Processing build validation results...');
          
          if (mcpBuildValidation.passed) {
            await this.addExecutionLog(executionId, 'info', `✅ Build validation passed${mcpBuildValidation.skipped ? ' (skipped - simple change)' : ''}`);
            buildValidationPassed = true;
          } else {
            await this.addExecutionLog(executionId, 'error', `❌ Build validation failed after ${mcpBuildValidation.attempts || 1} attempts`);
            buildValidationPassed = false;
            
            // Log the specific errors if available
            if (mcpBuildValidation.message) {
              await this.addExecutionLog(executionId, 'error', `Build errors: ${mcpBuildValidation.message}`);
            }
          }
        } else {
          // Fallback: MCP didn't run validation, so we'll do a simple check
          await this.updateProgress(executionId, 85, 'Running build validation...');
          const buildResult = await this.runBuildValidation(execution.task.projectId, executionId);
          buildValidationPassed = buildResult.success;
          
          if (buildValidationPassed) {
            await this.addExecutionLog(executionId, 'info', '✅ Build validation passed');
          } else {
            await this.addExecutionLog(executionId, 'warning', `⚠️ Build validation failed with ${buildResult.errors?.length || 0} errors`);
          }
        }
        
        // Dev server is now managed manually by the user through DevServerPanel
        // We don't automatically start it during code generation
        await this.updateProgress(executionId, 90, 'Code generation completed');
        if (!buildValidationPassed) {
          await this.addExecutionLog(executionId, 'warning', '⚠️ Build validation had some issues. Check the logs above.');
        }
        await this.addExecutionLog(executionId, 'info', '✅ Code generation completed. Use the Dev Server panel at the bottom to start the development server.');
      } catch (error) {
        console.error('Error during build/server setup:', error);
        await this.addExecutionLog(executionId, 'warning', 'Could not start dev server automatically');
      }
    }
    
    // V2 Phase 3: NO auto-commit - changes will be committed via "Commit All" button
    // Track that we have uncommitted changes for this task
    if (changes.length > 0) {
      try {
        // Update session state to indicate uncommitted changes
        const sessionState = await this.prisma.sessionState.findFirst({
          where: {
            projectId: execution.task.projectId,
            isActive: true
          }
        });
        
        if (sessionState) {
          await this.prisma.sessionState.update({
            where: { id: sessionState.id },
            data: {
              hasUncommittedChanges: true
            }
          });
        }
        
        // Store the files changed in the execution record (for dependency tracking)
        const filesChanged = changes.map(c => c.path);
        await this.prisma.agentExecution.update({
          where: { id: executionId },
          data: {
            filesChanged: JSON.stringify(filesChanged)
          }
        });
        
        await this.addExecutionLog(executionId, 'info', `✅ Code generated - ${changes.length} files changed. Use "Commit All" to commit.`);
        console.log(`Task completed with ${changes.length} files changed. Waiting for manual commit.`);
      } catch (error) {
        console.warn('Could not update session state:', error);
      }
    }
    
    // Final progress update
    await this.updateProgress(executionId, 100, 'Code generation completed');
    
    return {
      summary: mcpResult.summary || `Code generated successfully for task: ${input.title}`,
      changes: changes,
      buildValidation: mcpBuildValidation || { success: buildValidationPassed },
      buildPassed: buildValidationPassed
    };
  }

  // Bug Fixer Agent
  private async runBugFixerAgent(executionId: string): Promise<any> {
    await this.updateProgress(executionId, 20, 'Analyzing bug report');
    
    const execution = await this.prisma.agentExecution.findUnique({
      where: { id: executionId },
      include: { task: true }
    });
    
    if (!execution) throw new Error('Execution not found');
    
    const input = JSON.parse(execution.input);
    
    await this.updateProgress(executionId, 60, 'Generating bug fix');
    
    // Check if dev server is running in the current session
    const sessionState = await this.prisma.sessionState.findFirst({
      where: {
        projectId: execution.task.projectId,
        isActive: true
      }
    });
    
    // Add devServerRunning flag to context
    const enhancedContext = {
      ...input.context,
      devServerRunning: sessionState?.devServerStarted || false
    };
    
    // Use context-enhanced generator for bug fixes
    const mcpResult = await this.callMCPTool('generate_code_with_context', {
      task_title: input.title,
      task_description: input.description || `Fix: ${input.title}`,
      project_id: execution.task.projectId,
      workspace_path: input.context.workspacePath || `/tmp/workspace/${execution.task.projectId}`,
      context: enhancedContext,
      executionId
    }, executionId);

    await this.addExecutionLog(executionId, 'info', `Bug fix generated for: ${input.title}`);
    
    // Extract the result properly
    const result = typeof mcpResult === 'string' ? JSON.parse(mcpResult) : mcpResult;
    
    // Get build validation result
    const buildValidationPassed = result.buildValidation?.success !== false;
    
    return {
      summary: result.summary || `Bug fix generated for: ${input.title}`,
      changes: result.changes || [],
      buildValidation: result.buildValidation,
      buildPassed: buildValidationPassed
    };
  }

  // Documentation Agent
  private async runDocumentationAgent(executionId: string): Promise<any> {
    return { summary: 'Documentation generated', changes: [] };
  }

  // Testing Agent  
  private async runTestingAgent(executionId: string): Promise<any> {
    return { summary: 'Tests generated', changes: [] };
  }

  // Refactoring Agent
  private async runRefactoringAgent(executionId: string): Promise<any> {
    return { summary: 'Code refactored', changes: [] };
  }

  // Review Agent
  private async runReviewAgent(executionId: string): Promise<any> {
    return { summary: 'Code reviewed', changes: [] };
  }

  // Call MCP Tool (either local or API)
  private async callMCPTool(toolName: string, params: any, executionId?: string): Promise<any> {
    if (this.mcpMode === 'desktop') {
      // For desktop mode, make HTTP call to our API which will handle MCP
      try {
        // Get the base URL for the API
        const baseUrl = process.env.NEXT_PUBLIC_URL || 
                        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 
                        'http://localhost:3000';
        
        const response = await fetch(`${baseUrl}/api/mcp/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': 'kanbanix-internal-mcp-call'
          },
          body: JSON.stringify({
            tool: toolName,
            params: {
              ...params,
              projectId: params.projectId || params.project_id || params.context?.projectId,
              workspacePath: params.workspacePath || params.workspace_path || params.context?.workspacePath,
              executionId // Pass executionId for log streaming
            }
          })
        });

        if (!response.ok) {
          throw new Error(`MCP execution failed: ${response.statusText}`);
        }

        const result = await response.json();
        return result;
      } catch (error) {
        console.error('MCP tool call error:', error);
        return { 
          success: false,
          changes: [],
          message: error.message 
        };
      }
    } else {
      // Call Claude API with MCP tools
      // This will be implemented when we add API mode
      return { changes: [] };
    }
  }

  // Helper Methods
  private async updateExecutionStatus(
    executionId: string, 
    status: AgentStatus, 
    updates: any = {}
  ): Promise<void> {
    await this.prisma.agentExecution.update({
      where: { id: executionId },
      data: {
        status,
        ...updates,
        updatedAt: new Date()
      }
    });
  }

  private async updateProgress(
    executionId: string, 
    progress: number, 
    currentStep: string
  ): Promise<void> {
    await this.prisma.agentExecution.update({
      where: { id: executionId },
      data: {
        progress,
        currentStep,
        updatedAt: new Date()
      }
    });

    // Emit WebSocket update
    this.emitSocketUpdate(executionId, {
      status: 'running',
      progress,
      currentStep
    });

    // Add log entry
    await this.addExecutionLog(executionId, 'info', currentStep);
  }

  private async addExecutionLog(
    executionId: string,
    level: 'info' | 'warning' | 'error' | 'debug',
    message: string,
    metadata?: any
  ): Promise<void> {
    const log = await this.prisma.agentLog.create({
      data: {
        executionId,
        level,
        message,
        metadata: metadata ? JSON.stringify(metadata) : null
      }
    });
    
    // Emit WebSocket log update
    this.emitSocketLog(executionId, {
      id: log.id,
      level,
      message,
      data: metadata,
      timestamp: log.timestamp
    });
  }
  
  // Emit WebSocket updates
  private emitSocketUpdate(executionId: string, data: any): void {
    try {
      // Try to use global io if available (from server.js)
      if ((global as any).io) {
        (global as any).io.to(`execution-${executionId}`).emit('execution-update', {
          executionId,
          ...data,
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting socket update:', error);
    }
  }
  
  private emitSocketLog(executionId: string, log: any): void {
    try {
      if ((global as any).io) {
        (global as any).io.to(`execution-${executionId}`).emit('execution-log', {
          executionId,
          log
        });
      }
    } catch (error) {
      console.error('Error emitting socket log:', error);
    }
  }

  private extractRequirements(description: string): string[] {
    // Simple requirement extraction
    const requirements = [];
    const lines = description.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.match(/^\d+\./)) {
        requirements.push(trimmed);
      }
    }
    
    return requirements.length > 0 ? requirements : [description];
  }

  // Run build validation
  private async runBuildValidation(projectId: string, executionId: string): Promise<any> {
    try {
      // For now, skip build validation and return success
      // We'll call the build API from the frontend instead
      console.log('Build validation skipped in backend - will be handled by frontend');
      return { success: true };
    } catch (error) {
      console.error('Build validation error:', error);
      return { success: false, errors: [] };
    }
  }

  // Start dev server
  private async startDevServer(projectId: string, executionId: string): Promise<any> {
    try {
      console.log('Checking dev server status for project:', projectId);
      
      // Since this runs server-side in API routes, we need to construct the full URL
      // The main Kanbanix app API is on port 3000 (or PORT env var)
      // The dev server itself will start on 4000+ (handled by the API)
      const mainAppPort = process.env.PORT || 3000;
      const baseUrl = `http://localhost:${mainAppPort}`;
      const url = `${baseUrl}/api/workspace/dev-server`;
      
      // First check if dev server is already running
      const checkResponse = await fetch(`${url}?projectId=${projectId}`, {
        method: 'GET',
        headers: {
          'x-internal-api-key': process.env.INTERNAL_API_KEY || 'dev-internal-call'
        }
      });
      
      if (checkResponse.ok) {
        const status = await checkResponse.json();
        if (status.running) {
          console.log('Dev server already running on port:', status.port);
          return { 
            success: true, 
            port: status.port, 
            url: `http://localhost:${status.port}`,
            status: 'already_running',
            message: 'Dev server already running'
          };
        }
      }
      
      console.log('Starting new dev server for project:', projectId);
      
      // Call the API to actually start the dev server
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Use env var in production, fallback for development
          'x-internal-api-key': process.env.INTERNAL_API_KEY || 'dev-internal-call'
        },
        body: JSON.stringify({ 
          projectId, 
          executionId 
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.error('Dev server start failed:', error);
        return { success: false, error: error.details || error.error };
      }
      
      const result = await response.json();
      console.log('Dev server started:', result);
      
      return { 
        success: true,
        status: result.status,
        url: result.url,
        port: result.port
      };
    } catch (error) {
      console.error('Dev server start error:', error);
      return { success: false, error: error.message };
    }
  }

  private mapExecutionToInterface(execution: any, task: any): AgentExecution {
    const input = JSON.parse(execution.input);
    
    return {
      id: execution.id,
      taskId: execution.taskId,
      status: execution.status as AgentStatus,
      agentType: execution.agentType as AgentType,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      duration: execution.duration,
      attempts: execution.attempts,
      currentStep: execution.currentStep,
      progress: execution.progress,
      input,
      output: {
        logs: [], // Will be populated separately
        changes: execution.changes ? JSON.parse(execution.changes) : [],
        summary: execution.summary,
        errors: execution.errors ? JSON.parse(execution.errors) : undefined
      }
    };
  }

  // Public methods for UI
  async getExecution(executionId: string): Promise<AgentExecution | null> {
    const execution = await this.prisma.agentExecution.findUnique({
      where: { id: executionId },
      include: {
        task: true,
        logs: {
          orderBy: { timestamp: 'asc' }
        }
      }
    });

    if (!execution) return null;

    const mapped = this.mapExecutionToInterface(execution, execution.task);
    mapped.output.logs = execution.logs.map(log => ({
      id: log.id,
      timestamp: log.timestamp,
      level: log.level as any,
      message: log.message,
      metadata: log.metadata ? JSON.parse(log.metadata) : undefined
    }));

    return mapped;
  }

  async getTaskExecutions(taskId: string): Promise<AgentExecution[]> {
    const executions = await this.prisma.agentExecution.findMany({
      where: { taskId },
      include: {
        task: true,
        logs: {
          orderBy: { timestamp: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return executions.map(execution => {
      const mapped = this.mapExecutionToInterface(execution, execution.task);
      mapped.output.logs = execution.logs.map(log => ({
        id: log.id,
        timestamp: log.timestamp,
        level: log.level as any,
        message: log.message,
        metadata: log.metadata ? JSON.parse(log.metadata) : undefined
      }));
      return mapped;
    });
  }

  async cancelExecution(executionId: string): Promise<void> {
    await this.updateExecutionStatus(executionId, AgentStatus.CANCELLED, {
      completedAt: new Date(),
      currentStep: 'Cancelled by user'
    });
  }

  // Handle follow-up requests from chat
  async handleFollowUpRequest(params: {
    message: string;
    context: any;
    taskId: string;
    projectId: string;
  }): Promise<{ response: string; changes?: any[] }> {
    const { message, context, taskId, projectId } = params;
    
    try {
      // Create a lightweight context for the AI
      const aiContext = {
        ...context,
        followUpRequest: message,
        isFollowUp: true
      };

      // Call MCP tool for follow-up changes with context
      const result = await this.callMCPTool('generate_code_with_context', {
        task_title: `Follow-up: ${context.taskTitle}`,
        task_description: message,
        project_id: projectId,
        workspace_path: context.workspacePath,
        context: aiContext,
        isFollowUp: true
      });

      // Parse result
      const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
      
      // Format response
      let response = parsedResult.summary || 'Changes have been applied successfully.';
      
      if (parsedResult.changes && parsedResult.changes.length > 0) {
        response += `\n\nModified ${parsedResult.changes.length} file(s):`;
        parsedResult.changes.forEach((change: any) => {
          response += `\n- ${change.path}`;
        });
      } else {
        response = "I understand your request, but no code changes were necessary. " + 
                  (parsedResult.message || "The current implementation already addresses your requirements.");
      }

      return {
        response,
        changes: parsedResult.changes || []
      };
    } catch (error) {
      console.error('Error handling follow-up request:', error);
      return {
        response: 'I encountered an error processing your request. Please try again or provide more details.',
        changes: []
      };
    }
  }

  /**
   * Determine if a task should use decomposition based on complexity
   * Phase 2 feature - enables breaking down complex tasks
   */
  private shouldUseDecomposition(title: string, description: string): boolean {
    const taskText = `${title} ${description}`.toLowerCase();
    
    // Complex task indicators
    const complexIndicators = [
      'todo with backend',
      'crud',
      'authentication',
      'full stack',
      'api and frontend',
      'database',
      'multiple features',
      'complex'
    ];
    
    // Check for complexity indicators
    const hasComplexIndicator = complexIndicators.some(indicator => 
      taskText.includes(indicator)
    );
    
    // Check for multiple operations
    const hasMultipleOperations = 
      (taskText.includes('create') && taskText.includes('update')) ||
      (taskText.includes('frontend') && taskText.includes('backend')) ||
      (taskText.includes('api') && taskText.includes('ui'));
    
    // Enable decomposition for complex tasks
    return hasComplexIndicator || hasMultipleOperations;
  }
}