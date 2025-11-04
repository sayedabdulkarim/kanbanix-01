// MCP Configuration - easily switch between desktop and API modes
export const mcpConfig = {
  // Mode: 'desktop' for Claude Desktop testing, 'api' for production
  mode: process.env.MCP_MODE || 'desktop',
  
  // Claude API configuration (only used in 'api' mode)
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
    maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '4096'),
    temperature: parseFloat(process.env.CLAUDE_TEMPERATURE || '0.7'),
  },
  
  // Server configuration
  server: {
    timeout: parseInt(process.env.MCP_TIMEOUT || '120000'),
    debug: process.env.NODE_ENV === 'development',
  },
  
  // Security settings
  security: {
    allowedPaths: [
      process.env.PROJECT_ROOT || process.cwd(),
      '/tmp/kanbanix-mcp'
    ],
    maxFileSize: '10MB',
    rateLimits: {
      toolCallsPerMinute: 100,
      filesPerExecution: 50,
    }
  }
};

// Helper to check if we're in desktop mode
export const isDesktopMode = () => mcpConfig.mode === 'desktop';

// Helper to check if we're in API mode
export const isApiMode = () => mcpConfig.mode === 'api';

// Log current configuration
if (mcpConfig.server.debug) {
  console.error(`MCP Server starting in ${mcpConfig.mode} mode`);
  if (isApiMode()) {
    console.error(`Claude model: ${mcpConfig.claude.model}`);
  }
}