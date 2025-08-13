// Kanbanix AI Agent Service - Adapted from SynthAI with MCP Integration
import { PrismaClient } from '@prisma/client';
import path from 'path';

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
  SUCCESS = 'success',
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

  constructor() {
    this.prisma = new PrismaClient();
    this.mcpMode = (process.env.MCP_MODE as 'desktop' | 'api') || 'desktop';
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
    const workspacePath = context.workspacePath || path.join(process.cwd(), 'projects', task.projectId);

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
      await this.updateExecutionStatus(executionId, AgentStatus.SUCCESS, {
        completedAt: new Date(),
        progress: 100,
        currentStep: 'Completed',
        summary: result.summary,
        changes: JSON.stringify(result.changes || [])
      });

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
    
    await this.updateProgress(executionId, 30, 'Calling MCP server for code generation');
    
    // Call MCP server (or Claude API based on mode)
    const mcpResult = await this.callMCPTool('generate_task_code', {
      task_title: input.title,
      task_description: input.description,
      context: input.context,
      projectId: execution.task.projectId,
      workspacePath: input.context.workspacePath || `/tmp/workspace/${execution.task.projectId}`
    });

    await this.updateProgress(executionId, 80, 'Processing generated code');
    
    // Log the generation
    await this.addExecutionLog(executionId, 'info', `Generated code for: ${input.title}`);
    
    return {
      summary: `Code generated successfully for task: ${input.title}`,
      changes: mcpResult.changes || []
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
    
    const mcpResult = await this.callMCPTool('fix_bug', {
      bug_description: input.description,
      context: input.context,
      projectId: execution.task.projectId,
      workspacePath: input.context.workspacePath || `/tmp/workspace/${execution.task.projectId}`
    });

    await this.addExecutionLog(executionId, 'info', `Bug fix generated for: ${input.title}`);
    
    return {
      summary: `Bug fix generated for: ${input.title}`,
      changes: mcpResult.changes || []
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
  private async callMCPTool(toolName: string, params: any): Promise<any> {
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
              projectId: params.projectId || params.context?.projectId
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
}