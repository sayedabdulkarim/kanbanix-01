# SynthAI to Kanbanix - Reusable Components with MCP Integration Plan

## Overview
This document outlines the components from SynthAI that can be reused in Kanbanix, with a focus on **MCP (Model Context Protocol)** integration and **Anthropic Claude** as the exclusive AI provider.

## 1. MCP Integration Architecture

### 1.1 MCP Server Setup
**New for Kanbanix (Building on SynthAI patterns):**
```typescript
// MCP Server Configuration
interface MCPConfig {
  name: "kanbanix-mcp-server";
  version: "1.0.0";
  description: "MCP server for Kanbanix task automation";
  tools: {
    // File operations
    readFile: MCPTool;
    writeFile: MCPTool;
    searchCode: MCPTool;
    
    // Git operations
    gitStatus: MCPTool;
    gitDiff: MCPTool;
    gitCommit: MCPTool;
    
    // Task operations
    analyzeTask: MCPTool;
    generateCode: MCPTool;
    runTests: MCPTool;
    
    // GitHub operations
    createPR: MCPTool;
    reviewCode: MCPTool;
    fetchIssues: MCPTool;
  };
}
```

### 1.2 MCP Tools Definition
```javascript
// mcp-server/tools/index.js
export const tools = {
  // Code Analysis Tools
  analyzeRepository: {
    description: "Analyze repository structure and suggest tasks",
    parameters: {
      path: { type: "string", required: true },
      depth: { type: "number", default: 3 }
    },
    handler: async (params) => {
      // Reuse SynthAI's code analysis logic
      // Return task suggestions based on TODOs, FIXMEs, etc.
    }
  },
  
  // Code Generation Tools
  generateTaskCode: {
    description: "Generate code implementation for a task",
    parameters: {
      taskDescription: { type: "string", required: true },
      targetFile: { type: "string" },
      language: { type: "string" }
    },
    handler: async (params) => {
      // Adapt SynthAI's component generation
      // Generate targeted code for specific task
    }
  },
  
  // Git Integration Tools
  createCommit: {
    description: "Create a git commit with AI-generated message",
    parameters: {
      changes: { type: "array", required: true },
      taskContext: { type: "object" }
    },
    handler: async (params) => {
      // Generate commit message and execute git commit
    }
  }
};
```

## 2. Anthropic Claude Integration (Exclusive)

### 2.1 Claude Configuration
**Replace SynthAI's OpenAI with Anthropic:**
```javascript
// config/ai.config.js
export const aiConfig = {
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-3-opus-20240229', // or claude-3-sonnet for faster/cheaper
  maxTokens: 4096,
  temperature: 0.7,
  
  // Claude-specific settings
  claudeConfig: {
    systemPrompt: `You are an expert software developer integrated into Kanbanix.
    You have access to MCP tools to read files, write code, and manage git operations.
    Always use the provided tools to understand context before generating code.`,
    
    // Use Claude's superior context window
    contextWindow: 200000, // 200k tokens
    
    // Claude's constitutional AI principles
    constitutional: true,
    harmlessness: true
  }
};
```

### 2.2 Anthropic SDK Integration
**From SynthAI (OpenAI) → Kanbanix (Anthropic):**
```javascript
// services/claudeService.js
import Anthropic from '@anthropic-ai/sdk';
import { MCPClient } from '@modelcontextprotocol/sdk';

class ClaudeService {
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    
    this.mcpClient = new MCPClient({
      serverPath: './mcp-server',
      tools: ['readFile', 'writeFile', 'searchCode', 'gitCommit']
    });
  }
  
  async generateWithMCP(taskDescription, context) {
    // Connect Claude with MCP tools
    const messages = [
      {
        role: 'user',
        content: `Task: ${taskDescription}
        
        Use the available MCP tools to:
        1. Analyze the current codebase
        2. Generate appropriate code
        3. Create tests if needed
        4. Prepare commit message
        
        Available tools: ${this.mcpClient.listTools()}`
      }
    ];
    
    const response = await this.anthropic.messages.create({
      model: 'claude-3-opus-20240229',
      max_tokens: 4096,
      messages,
      tools: this.mcpClient.getToolDefinitions(),
      tool_choice: 'auto'
    });
    
    // Process tool calls through MCP
    return this.processMCPToolCalls(response);
  }
}
```

## 3. MCP Server Implementation

### 3.1 Directory Structure
```
kanbanix/
├── mcp-server/
│   ├── package.json
│   ├── server.js           # Main MCP server
│   ├── tools/
│   │   ├── file-tools.js   # File operations
│   │   ├── git-tools.js    # Git operations
│   │   ├── task-tools.js   # Task analysis
│   │   └── github-tools.js # GitHub integration
│   ├── prompts/
│   │   ├── task-analysis.md
│   │   ├── code-generation.md
│   │   └── test-generation.md
│   └── config.json         # MCP configuration
```

### 3.2 MCP Server Setup
```javascript
// mcp-server/server.js
import { MCPServer } from '@modelcontextprotocol/sdk';
import { fileTools } from './tools/file-tools.js';
import { gitTools } from './tools/git-tools.js';
import { taskTools } from './tools/task-tools.js';

const server = new MCPServer({
  name: 'kanbanix-mcp',
  version: '1.0.0',
  tools: {
    ...fileTools,
    ...gitTools,
    ...taskTools
  }
});

// Tool implementations adapted from SynthAI
server.tool('generateCode', async (params) => {
  // Reuse SynthAI's code generation logic
  // But with task-specific context
  const { taskDescription, context } = params;
  
  // 1. Analyze existing code structure
  const codeContext = await analyzeCodebase(context.projectPath);
  
  // 2. Generate code using Claude
  const generatedCode = await generateTaskImplementation(
    taskDescription,
    codeContext
  );
  
  // 3. Validate and format
  return formatAndValidate(generatedCode);
});

server.start();
```

## 4. Prompt Engineering for Claude + MCP

### 4.1 System Prompts (Adapted from SynthAI)
```markdown
<!-- prompts/system-prompt.md -->
You are Claude, integrated into Kanbanix via MCP (Model Context Protocol).

## Your Capabilities:
1. Read and analyze code files using MCP tools
2. Generate code implementations for tasks
3. Create and run tests
4. Manage git operations
5. Interact with GitHub APIs

## Your Workflow:
1. When given a task, first use `searchCode` tool to understand the codebase
2. Use `readFile` to examine relevant files
3. Generate implementation that matches existing patterns
4. Use `writeFile` to save changes
5. Use `runTests` to validate changes
6. Use `gitCommit` with descriptive message

## Code Generation Rules:
- Match existing code style and conventions
- Include proper error handling
- Add comments for complex logic
- Generate tests alongside implementation
- Follow security best practices

Always think step-by-step and use tools to gather context before generating code.
```

### 4.2 Task-Specific Prompts
```javascript
// Reuse SynthAI prompt patterns but adapt for tasks
const taskPrompts = {
  implementation: (task, context) => `
    Task: ${task.title}
    Description: ${task.description}
    
    Context from MCP tools:
    - Project structure: ${context.structure}
    - Related files: ${context.relatedFiles}
    - Dependencies: ${context.dependencies}
    
    Generate implementation that:
    1. Solves the task requirements
    2. Follows existing code patterns
    3. Includes error handling
    4. Has appropriate tests
    
    Use MCP tools to read files and write your implementation.
  `,
  
  bugFix: (issue, context) => `
    Bug Report: ${issue.title}
    Error: ${issue.errorMessage}
    Stack Trace: ${issue.stackTrace}
    
    Use MCP tools to:
    1. Locate the bug in the codebase
    2. Understand the root cause
    3. Generate a fix
    4. Verify the fix doesn't break other features
  `
};
```

## 5. API Endpoints with MCP

### 5.1 Task Execution Endpoints
```typescript
// api/ai/tasks/[taskId]/execute/route.ts
export async function POST(request: Request) {
  const { taskId } = await params;
  const task = await getTask(taskId);
  
  // Initialize MCP session
  const mcpSession = await initializeMCPSession({
    projectPath: task.project.path,
    availableTools: ['readFile', 'writeFile', 'searchCode', 'gitCommit']
  });
  
  // Execute task with Claude + MCP
  const result = await claudeService.executeTaskWithMCP({
    task,
    mcpSession,
    autoCommit: request.body.autoCommit || false
  });
  
  // Stream results back
  return new Response(result.stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}
```

## 6. Frontend Integration with MCP Status

### 6.1 Task Card with MCP Indicators
```jsx
// components/TaskCard.jsx
function TaskCard({ task }) {
  const [mcpStatus, setMCPStatus] = useState(null);
  
  return (
    <div className="task-card">
      {task.aiEnabled && (
        <div className="mcp-status">
          <MCPIndicator status={mcpStatus} />
          {mcpStatus === 'running' && (
            <div className="mcp-tools-in-use">
              <span>🔧 Reading files...</span>
              <span>📝 Generating code...</span>
              <span>✅ Running tests...</span>
            </div>
          )}
        </div>
      )}
      
      <AIActions>
        <button onClick={() => executeWithMCP(task.id)}>
          🤖 Execute with Claude + MCP
        </button>
      </AIActions>
    </div>
  );
}
```

## 7. Database Schema for MCP Tracking

```sql
-- MCP execution tracking
CREATE TABLE mcp_executions (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES tasks(id),
  session_id VARCHAR(255),
  tools_used JSONB, -- Track which MCP tools were used
  claude_model VARCHAR(50),
  token_usage JSONB,
  execution_log JSONB,
  generated_files JSONB,
  status VARCHAR(50),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- MCP tool usage analytics
CREATE TABLE mcp_tool_usage (
  id UUID PRIMARY KEY,
  execution_id UUID REFERENCES mcp_executions(id),
  tool_name VARCHAR(100),
  parameters JSONB,
  result JSONB,
  duration_ms INTEGER,
  timestamp TIMESTAMP
);
```

## 8. Environment Variables

```env
# Anthropic Configuration (NO OpenAI)
ANTHROPIC_API_KEY=sk-ant-xxxxx
CLAUDE_MODEL=claude-3-opus-20240229
CLAUDE_MAX_TOKENS=4096
CLAUDE_TEMPERATURE=0.7

# MCP Configuration
MCP_SERVER_PORT=3001
MCP_SERVER_HOST=localhost
MCP_ENABLED=true
MCP_TOOLS_PATH=./mcp-server/tools
MCP_TIMEOUT=120000

# Feature Flags
AI_PROVIDER=anthropic  # ONLY Anthropic
ENABLE_MCP=true
AUTO_EXECUTE_ON_DRAG=false  # Start with manual
STREAM_RESPONSES=true
```

## 9. Implementation Phases with MCP

### Phase 1: MCP Server Setup (Week 1)
1. Set up MCP server structure
2. Implement basic file and git tools
3. Test MCP-Claude communication
4. Create simple task execution flow

### Phase 2: Adapt SynthAI Components (Week 2)
1. Port code generation logic to MCP tools
2. Adapt prompts for Claude (from GPT-4)
3. Implement streaming with MCP events
4. Add MCP status indicators to UI

### Phase 3: Full Integration (Week 3)
1. Auto-execution on drag with MCP
2. Real-time MCP tool usage display
3. Git integration through MCP
4. Error handling and rollback

### Phase 4: Advanced MCP Features (Week 4)
1. Multi-tool orchestration
2. Parallel tool execution
3. Context caching between executions
4. Learning from successful patterns

## 10. Key Differences from Original Plan

### What's New with MCP:
- **Tool-based approach**: Claude uses MCP tools instead of direct code generation
- **Better context**: MCP tools provide real codebase understanding
- **Traceable actions**: Every tool use is logged and auditable
- **Rollback capability**: MCP tracks all changes for easy rollback
- **Real-time feedback**: Users see which tools Claude is using

### What We Keep from SynthAI:
- Code formatting and validation utilities
- UI components (adapted for MCP status)
- Streaming response handling
- Error handling patterns
- Test generation logic

### What We Replace:
- OpenAI → Anthropic Claude (exclusively)
- Direct API calls → MCP tool orchestration
- Static prompts → Dynamic MCP-aware prompts
- Simple generation → Multi-step tool execution

## 11. Security with MCP

```javascript
// MCP Security Configuration
const mcpSecurity = {
  // Sandbox file operations
  allowedPaths: [
    process.env.PROJECT_ROOT,
    '/tmp/kanbanix-mcp'
  ],
  
  // Restricted operations
  blockedCommands: [
    'rm -rf',
    'sudo',
    'chmod 777'
  ],
  
  // Rate limiting per user
  rateLimits: {
    toolCallsPerMinute: 100,
    filesPerExecution: 50,
    maxFileSize: '10MB'
  },
  
  // Audit logging
  auditLog: true,
  logPath: './logs/mcp-audit.log'
};
```

## 12. Testing Strategy with MCP

### MCP-Specific Tests:
```javascript
// tests/mcp-integration.test.js
describe('MCP Integration', () => {
  test('Claude can use file reading tools', async () => {
    const result = await mcpClient.execute({
      tool: 'readFile',
      params: { path: 'test.js' }
    });
    expect(result.success).toBe(true);
  });
  
  test('Tool execution is logged', async () => {
    await executeTaskWithMCP(taskId);
    const logs = await getMCPLogs(taskId);
    expect(logs.toolsUsed).toContain('readFile');
  });
  
  test('Rollback works after failed execution', async () => {
    // Test that MCP can rollback changes
  });
});
```

## 13. Success Metrics with MCP

1. **MCP Tool Usage**: Average 5-10 tools per task execution
2. **Context Accuracy**: 90% relevant file identification
3. **Code Quality**: Generated code passes tests 80% of time
4. **Execution Time**: < 30 seconds for average task
5. **Rollback Success**: 100% clean rollback capability

## Next Steps

1. **Set up MCP server** in Kanbanix project
2. **Configure Anthropic Claude** (get API key)
3. **Create basic MCP tools** (file, git operations)
4. **Test Claude-MCP communication**
5. **Port SynthAI components** with MCP awareness
6. **Implement first automated task**
7. **Add UI indicators** for MCP status
8. **Test end-to-end flow**