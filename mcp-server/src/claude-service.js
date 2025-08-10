import { mcpConfig, isApiMode } from './config.js';

let anthropic = null;

// Initialize Anthropic SDK only in API mode
if (isApiMode()) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({
      apiKey: mcpConfig.claude.apiKey,
    });
    console.error('Anthropic SDK initialized for API mode');
  } catch (error) {
    console.error('Failed to initialize Anthropic SDK:', error);
  }
}

export class ClaudeService {
  constructor() {
    this.mode = mcpConfig.mode;
  }

  // Execute a task with Claude (only works in API mode)
  async executeTask(taskDescription, availableTools) {
    if (!isApiMode()) {
      throw new Error('executeTask only available in API mode. Use Claude Desktop for testing.');
    }

    if (!anthropic) {
      throw new Error('Anthropic SDK not initialized. Check your ANTHROPIC_API_KEY.');
    }

    const systemPrompt = `You are Claude integrated with Kanbanix via MCP (Model Context Protocol).

Available MCP Tools:
${availableTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}

When given a task:
1. Use MCP tools to understand the current codebase
2. Plan your approach step by step
3. Use tools to implement changes
4. Verify your changes work
5. Provide a summary of what you did

Always use the MCP tools rather than guessing about file contents or structure.`;

    try {
      const response = await anthropic.messages.create({
        model: mcpConfig.claude.model,
        max_tokens: mcpConfig.claude.maxTokens,
        temperature: mcpConfig.claude.temperature,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Task: ${taskDescription}

Please analyze this task and use the available MCP tools to understand the codebase and implement the solution.`
          }
        ],
        tools: availableTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
        tool_choice: 'auto',
      });

      return response;
    } catch (error) {
      throw new Error(`Claude API error: ${error.message}`);
    }
  }

  // Get current mode info
  getInfo() {
    return {
      mode: this.mode,
      model: isApiMode() ? mcpConfig.claude.model : 'Claude Desktop',
      apiConfigured: isApiMode() ? !!anthropic : false,
    };
  }
}

export const claudeService = new ClaudeService();