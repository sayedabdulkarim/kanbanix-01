#!/usr/bin/env node

// Load environment variables FIRST, before anything else
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from the mcp-server directory (with override)
dotenv.config({
  path: path.resolve(__dirname, '..', '.env'),
  override: true  // Force override existing env vars
});

// Debug: Log loaded environment variables
console.error('[ENV DEBUG] CLAUDE_MODEL:', process.env.CLAUDE_MODEL);
console.error('[ENV DEBUG] ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'SET' : 'NOT SET');
console.error('[ENV DEBUG] MCP_MODE:', process.env.MCP_MODE);

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import configuration and services (AFTER loading env vars)
import { mcpConfig, isDesktopMode, isApiMode } from './config.js';
import { claudeService } from './claude-service.js';

// Import tools
import { fileTools } from './tools/file-tools.js';
import { gitTools } from './tools/git-tools.js';
import { codeTools } from './tools/code-tools.js';
import { projectTools } from './tools/project-tools.js';
import { apiTools } from './tools/api-tools.js';
import { githubAwareTools } from './tools/github-aware-tools.js';
import { testTools } from './tools/test-tools.js';
import { smartFileDetectorTools } from './tools/smart-file-detector.js';
import { contextAwareTools } from './tools/context-aware-tools.js';
import { contextEnhancedGenerator } from './tools/context-enhanced-generator.js';

// Combine all tools
const allTools = [
  ...fileTools,
  ...gitTools,
  ...codeTools,
  ...projectTools,
  ...apiTools,
  ...githubAwareTools,
  ...testTools,
  ...smartFileDetectorTools,
  ...contextAwareTools,
  ...contextEnhancedGenerator,
];

// Create server instance
const server = new Server(
  {
    name: 'kanbanix-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  const tool = allTools.find(t => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  
  try {
    const result = await tool.handler(args);
    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Kanbanix MCP server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});