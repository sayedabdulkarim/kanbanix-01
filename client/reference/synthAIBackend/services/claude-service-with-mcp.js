// Enhanced Claude Service with MCP Integration
const Anthropic = require('@anthropic-ai/sdk');
require("dotenv").config();

class ClaudeServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClaudeServiceError";
  }
}

class ClaudeServiceWithMCP {
  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    if (!this.apiKey) {
      throw new ClaudeServiceError(
        "ANTHROPIC_API_KEY environment variable not set"
      );
    }

    // Initialize Anthropic client
    this.anthropic = new Anthropic({
      apiKey: this.apiKey,
    });

    // Define MCP tools that Claude can use
    this.mcpTools = [
      {
        name: 'read_project_file',
        description: 'Read a file from the user project to understand existing code',
        input_schema: {
          type: 'object',
          properties: {
            projectName: {
              type: 'string',
              description: 'Name of the project (e.g., project-663d9257)',
            },
            filePath: {
              type: 'string',
              description: 'Path to the file within the project (e.g., src/app/page.tsx)',
            },
          },
          required: ['projectName', 'filePath'],
        },
      },
      {
        name: 'list_project_files',
        description: 'List all files in a project to understand structure',
        input_schema: {
          type: 'object',
          properties: {
            projectName: {
              type: 'string',
              description: 'Name of the project',
            },
            directory: {
              type: 'string',
              description: 'Directory within the project (optional)',
            },
          },
          required: ['projectName'],
        },
      },
      {
        name: 'search_code',
        description: 'Search for specific patterns or code in the project',
        input_schema: {
          type: 'object',
          properties: {
            projectName: {
              type: 'string',
              description: 'Name of the project',
            },
            pattern: {
              type: 'string',
              description: 'Search pattern',
            },
            fileType: {
              type: 'string',
              description: 'File extension to search in (e.g., tsx, css)',
            },
          },
          required: ['projectName', 'pattern'],
        },
      },
      {
        name: 'check_project_structure',
        description: 'Analyze project configuration and structure',
        input_schema: {
          type: 'object',
          properties: {
            projectName: {
              type: 'string',
              description: 'Name of the project',
            },
          },
          required: ['projectName'],
        },
      },
    ];
  }

  // Handle MCP tool calls from Claude
  async handleToolUse(toolName, toolInput) {
    // In production, this would communicate with the MCP server
    // For now, we'll simulate the responses
    console.log(`MCP Tool Called: ${toolName}`, toolInput);
    
    // This is where you'd actually call your MCP server
    // For demonstration, returning mock data
    switch (toolName) {
      case 'read_project_file':
        return `File content of ${toolInput.filePath}`;
      case 'list_project_files':
        return JSON.stringify(['app/page.tsx', 'components/Todo.tsx']);
      case 'search_code':
        return `Found ${toolInput.pattern} in 3 files`;
      case 'check_project_structure':
        return JSON.stringify({
          framework: 'nextjs',
          hasTailwind: true,
          hasTypeScript: true,
        });
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // Generate code with MCP context
  async generateCodeWithContext(requirements, projectName) {
    try {
      console.log(`Generating code for project: ${projectName}`);
      
      // Build the system prompt with project context
      const systemPrompt = `You are an expert Next.js developer. You have access to tools to read and analyze the user's existing project files. 
      
      When generating code:
      1. First, use the tools to understand the existing project structure
      2. Read relevant files to match the coding style and patterns
      3. Ensure compatibility with existing code
      4. Generate code that integrates seamlessly
      
      The user is using Next.js with TypeScript and Tailwind CSS.`;

      // Create the message with tools
      const message = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4000,
        temperature: 0.7,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Generate code for project "${projectName}" with these requirements: ${requirements}
            
            Please analyze the existing project structure and code before generating new code to ensure compatibility.`,
          },
        ],
        tools: this.mcpTools,
        tool_choice: { type: "auto" },
      });

      // Process the response and handle any tool calls
      let finalContent = '';
      
      for (const content of message.content) {
        if (content.type === 'text') {
          finalContent += content.text;
        } else if (content.type === 'tool_use') {
          // Handle tool use
          console.log(`Claude wants to use tool: ${content.name}`);
          // In production, this would actually call the MCP server
        }
      }

      return finalContent;
    } catch (error) {
      throw new ClaudeServiceError(`Error generating code with MCP: ${error.message}`);
    }
  }

  // Fix errors with MCP context
  async fixErrorWithContext(error, projectName) {
    try {
      const systemPrompt = `You are an expert debugger. You have access to tools to read project files and understand the codebase.
      
      When fixing errors:
      1. Read the files mentioned in the error
      2. Understand the context and dependencies
      3. Provide a precise fix that addresses the root cause
      4. Ensure the fix doesn't break other parts of the code`;

      const message = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2000,
        temperature: 0.3, // Lower temperature for more precise fixes
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Fix this error in project "${projectName}": 
            
            ${error}
            
            Please read the relevant files and provide a precise fix.`,
          },
        ],
        tools: this.mcpTools,
        tool_choice: { type: "auto" },
      });

      // Extract the fix from the response
      let fix = '';
      for (const content of message.content) {
        if (content.type === 'text') {
          fix += content.text;
        }
      }

      return fix;
    } catch (error) {
      throw new ClaudeServiceError(`Error fixing with MCP: ${error.message}`);
    }
  }

  // Original methods remain for backward compatibility
  async generateText(prompt) {
    const message = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    if (!message.content || !message.content[0] || !message.content[0].text) {
      throw new ClaudeServiceError("Invalid response format from Claude API");
    }

    return message.content[0].text;
  }
}

// Export both the new class and maintain compatibility
module.exports = { 
  ClaudeServiceWithMCP, 
  ClaudeServiceError,
  // Also export as LLMService for compatibility
  LLMServiceWithMCP: ClaudeServiceWithMCP,
  LLMServiceError: ClaudeServiceError
};