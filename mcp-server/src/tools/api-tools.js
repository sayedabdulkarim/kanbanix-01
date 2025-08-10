import { mcpConfig, isApiMode } from '../config.js';

export const apiTools = [
  {
    name: 'execute_task_api',
    description: 'Execute a complete task using Claude API (only in API mode)',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID from Kanbanix',
        },
        task_description: {
          type: 'string',
          description: 'Task description to execute',
        },
        context: {
          type: 'object',
          description: 'Additional context (project info, files, etc.)',
        },
      },
      required: ['task_description'],
    },
    handler: async ({ task_id, task_description, context }) => {
      if (!isApiMode()) {
        return 'API execution only available when MCP_MODE=api. Use Claude Desktop for testing individual tools.';
      }

      try {
        const { claudeService } = await import('../claude-service.js');
        
        // Get available tools for Claude
        const { fileTools } = await import('./file-tools.js');
        const { gitTools } = await import('./git-tools.js');
        const { codeTools } = await import('./code-tools.js');
        const { projectTools } = await import('./project-tools.js');
        
        const availableTools = [...fileTools, ...gitTools, ...codeTools, ...projectTools];
        
        const result = await claudeService.executeTask(task_description, availableTools);
        
        return JSON.stringify({
          task_id,
          status: 'completed',
          result: result,
          mode: 'api',
          tools_available: availableTools.length,
        }, null, 2);
        
      } catch (error) {
        return JSON.stringify({
          task_id,
          status: 'failed',
          error: error.message,
          mode: 'api',
        }, null, 2);
      }
    },
  },

  {
    name: 'get_mcp_info',
    description: 'Get information about current MCP configuration and mode',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const { claudeService } = await import('../claude-service.js');
      const info = claudeService.getInfo();
      
      return JSON.stringify({
        ...info,
        config: {
          mode: mcpConfig.mode,
          timeout: mcpConfig.server.timeout,
          debug: mcpConfig.server.debug,
        },
        instructions: {
          desktop_mode: 'Test individual tools directly in Claude Desktop',
          api_mode: 'Use execute_task_api to run complete tasks via Claude API',
          switch_modes: 'Set MCP_MODE=desktop or MCP_MODE=api environment variable',
        },
      }, null, 2);
    },
  },
];