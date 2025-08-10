// Production Claude Service with Real MCP Integration
const Anthropic = require('@anthropic-ai/sdk');
const { getMCPClient } = require('./mcp-client');
const apiKeyStorage = require('./api-key-storage');
require("dotenv").config();

class ClaudeServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClaudeServiceError";
  }
}

class ClaudeServiceProduction {
  constructor() {
    // MCP client will be initialized when needed
    this.mcpClient = null;
  }

  // Get Anthropic client with user's API key
  getAnthropicClient(socketId) {
    const apiKey = apiKeyStorage.getApiKeyWithFallback(socketId);
    if (!apiKey) {
      throw new ClaudeServiceError(
        "No API key available. Please provide your Anthropic API key."
      );
    }

    return new Anthropic({
      apiKey: apiKey,
    });
  }

  // Initialize MCP client if not already done
  async ensureMCPClient() {
    if (!this.mcpClient) {
      console.log('\n🔌 [Claude Service] Initializing MCP client...');
      this.mcpClient = await getMCPClient();
      console.log('✅ [Claude Service] MCP client initialized');
    }
    return this.mcpClient;
  }

  // Generate code with MCP context for project updates
  async generateCodeForProject(requirements, projectName, socketId) {
    try {
      console.log('\n🎯 [Claude Service] Starting MCP-enhanced code generation');
      console.log(`📁 [Claude Service] Project: ${projectName}`);
      
      // Ensure MCP client is ready
      const mcp = await this.ensureMCPClient();
      
      console.log('🔍 [Claude Service] Analyzing project structure...');
      
      // First, analyze the project structure
      const projectStructure = await mcp.checkProjectStructure(projectName);
      console.log('📊 [Claude Service] Project analysis complete:', {
        framework: projectStructure.framework,
        hasTypeScript: projectStructure.hasTsConfig,
        hasTailwind: projectStructure.hasTailwind,
        componentsCount: projectStructure.components.length
      });
      
      // Build system prompt with project context
      const systemPrompt = `You are an expert ${projectStructure.framework} developer. 
      
      Project details:
      - Framework: ${projectStructure.framework}
      - TypeScript: ${projectStructure.hasTsConfig ? 'Yes' : 'No'}
      - Tailwind CSS: ${projectStructure.hasTailwind ? 'Yes' : 'No'}
      - Components: ${projectStructure.components.join(', ')}
      
      You have access to MCP tools to read project files. Before generating code:
      1. Use read_project_file to understand existing patterns
      2. Use search_code to find related code
      3. Generate code that matches the project's style
      
      CRITICAL RULES:
      - NEVER modify or generate src/app/globals.css - it already has proper Tailwind configuration
      - ALWAYS include all necessary imports at the top of each file
      - Import React hooks when used: import { useState, useEffect } from 'react'
      - Import components with correct paths based on actual file locations
      - Use the MCP tools to find exact component locations before importing
      
      IMPORTANT: Always read relevant files before generating code to ensure compatibility.`;

      // Create conversation with Claude
      const anthropic = this.getAnthropicClient(socketId);
      const message = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4000,
        temperature: 0.7,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Project: ${projectName}
Requirements: ${requirements}

Please analyze the existing code and generate new code that integrates seamlessly.`
          }
        ],
        tools: [
          {
            name: "read_project_file",
            description: "Read a specific file from the project",
            input_schema: {
              type: "object",
              properties: {
                filePath: { type: "string", description: "Path within project (e.g., src/app/page.tsx)" }
              },
              required: ["filePath"]
            }
          },
          {
            name: "search_code",
            description: "Search for code patterns in the project",
            input_schema: {
              type: "object",
              properties: {
                pattern: { type: "string" },
                fileType: { type: "string", description: "File extension (optional)" }
              },
              required: ["pattern"]
            }
          }
        ],
        tool_choice: { type: "auto" }
      });

      // Process initial response
      let allMessages = [
        {
          role: "user",
          content: `Project: ${projectName}
Requirements: ${requirements}

Please analyze the existing code and generate new code that integrates seamlessly.`
        }
      ];
      
      let currentResponse = message;
      let finalResponse = '';
      let toolCallsHandled = false;

      // Handle tool calls in a loop until no more tool calls
      do {
        toolCallsHandled = false;
        let assistantContent = [];
        let toolResults = [];

        for (const content of currentResponse.content) {
          if (content.type === 'text') {
            finalResponse += content.text;
            assistantContent.push(content);
          } else if (content.type === 'tool_use') {
            toolCallsHandled = true;
            assistantContent.push(content);
            
            console.log(`\n🔨 [Claude] Requesting tool: ${content.name}`);
            console.log(`📋 [Claude] Tool arguments:`, JSON.stringify(content.input, null, 2));
            
            try {
              let toolResult;
              let resultContent = '';
              
              switch (content.name) {
                case 'read_project_file':
                  try {
                    resultContent = await mcp.readProjectFile(projectName, content.input.filePath);
                    console.log(`Successfully read file: ${content.input.filePath}`);
                  } catch (error) {
                    resultContent = `Error reading file: ${error.message}`;
                    console.error(`Failed to read file: ${content.input.filePath}`, error);
                  }
                  break;
                  
                case 'search_code':
                  try {
                    resultContent = await mcp.searchCode(
                      projectName, 
                      content.input.pattern, 
                      content.input.fileType
                    );
                    console.log(`Search completed for pattern: ${content.input.pattern}`);
                  } catch (error) {
                    resultContent = `Error searching: ${error.message}`;
                    console.error(`Failed to search for: ${content.input.pattern}`, error);
                  }
                  break;
                  
                default:
                  resultContent = `Unknown tool: ${content.name}`;
              }
              
              toolResults.push({
                type: "tool_result",
                tool_use_id: content.id,
                content: resultContent
              });
              
            } catch (error) {
              console.error(`Error calling MCP tool ${content.name}:`, error);
              toolResults.push({
                type: "tool_result",
                tool_use_id: content.id,
                content: `Error: ${error.message}`,
                is_error: true
              });
            }
          }
        }

        // If we handled tool calls, send results back to Claude
        if (toolCallsHandled && toolResults.length > 0) {
          allMessages.push({ role: "assistant", content: assistantContent });
          allMessages.push({ role: "user", content: toolResults });
          
          // Get Claude's response after processing tool results
          currentResponse = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 4000,
            temperature: 0.7,
            system: systemPrompt,
            messages: allMessages,
            tools: [
              {
                name: "read_project_file",
                description: "Read a specific file from the project",
                input_schema: {
                  type: "object",
                  properties: {
                    filePath: { type: "string", description: "Path within project (e.g., src/app/page.tsx)" }
                  },
                  required: ["filePath"]
                }
              },
              {
                name: "search_code",
                description: "Search for code patterns in the project",
                input_schema: {
                  type: "object",
                  properties: {
                    pattern: { type: "string" },
                    fileType: { type: "string", description: "File extension (optional)" }
                  },
                  required: ["pattern"]
                }
              }
            ],
            tool_choice: { type: "auto" }
          });
        }
      } while (toolCallsHandled);

      console.log(`📄 [Claude Service] Final response length: ${finalResponse.length}`);
      // Log first 500 chars for debugging
      if (finalResponse.length > 0) {
        console.log(`📄 [Claude Service] Response preview: ${finalResponse.substring(0, 500)}...`);
        // Also log if response contains code blocks
        const codeBlockCount = (finalResponse.match(/```/g) || []).length / 2;
        console.log(`📄 [Claude Service] Code blocks found: ${codeBlockCount}`);
      }

      return finalResponse;
      
    } catch (error) {
      throw new ClaudeServiceError(`Error generating code with MCP: ${error.message}`);
    }
  }

  // Fix build errors with MCP context - comprehensive method for build validator
  async fixBuildErrorsWithMCP(buildOutput, prd, projectName, socketId) {
    try {
      console.log('\n🔍 [Claude Service] Starting MCP-enhanced error fixing');
      console.log(`📁 [Claude Service] Project: ${projectName}`);
      
      const mcp = await this.ensureMCPClient();
      
      // Extract error summary
      const errorLines = buildOutput.split('\n').filter(line => 
        line.includes('error') || 
        line.includes('Error') || 
        line.includes('Failed') ||
        line.includes('Type error') ||
        line.includes('Cannot find')
      ).slice(0, 20); // Limit to prevent token overflow
      
      const errorSummary = errorLines.join('\n');
      console.log('🐛 [Claude Service] Analyzing errors:', errorLines.length, 'error lines found');
      
      const systemPrompt = `You are an expert Next.js developer fixing build errors. 
      
      You have access to MCP tools to read project files. Use them to:
      1. Read files mentioned in errors to understand the actual code
      2. Search for components/functions that are missing imports
      3. Understand the project structure before making fixes
      
      CRITICAL RULES:
      - NEVER modify src/app/globals.css - it's already configured correctly
      - ALWAYS include all necessary imports at the top of files
      - When you see "Cannot find name 'ComponentName'", use search_code to find where it's defined
      - Read existing files before modifying them to preserve their structure
      - DO NOT add external dependencies - use only React built-ins
      - Preserve all existing 'use client' directives
      
      IMPORT PATTERNS:
      - For missing components: First search for them, then add correct import based on actual location
      - Use relative imports with correct paths
      - Match the export style (default vs named) when importing`;

      const userPrompt = `Fix these build errors for project "${projectName}":

ERROR SUMMARY:
${errorSummary}

PROJECT PRD:
${prd}

FULL BUILD OUTPUT:
${buildOutput.substring(0, 4000)}...

Return ONLY a valid JSON object with this structure:
{
  "files": [
    {
      "path": "src/components/Example.tsx",
      "content": "// Complete fixed file content here",
      "description": "Brief description of what was fixed"
    }
  ],
  "summary": "Brief summary of all fixes applied"
}`;

      // Create conversation with Claude using MCP tools
      const anthropic = this.getAnthropicClient(socketId);
      const message = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 8000,
        temperature: 0.3,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ],
        tools: [
          {
            name: "read_project_file",
            description: "Read a specific file from the project",
            input_schema: {
              type: "object",
              properties: {
                filePath: { type: "string", description: "Path within project (e.g., src/app/page.tsx)" }
              },
              required: ["filePath"]
            }
          },
          {
            name: "search_code",
            description: "Search for code patterns in the project",
            input_schema: {
              type: "object",
              properties: {
                pattern: { type: "string" },
                fileType: { type: "string", description: "File extension (optional)" }
              },
              required: ["pattern"]
            }
          },
          {
            name: "list_project_files",
            description: "List files in a directory",
            input_schema: {
              type: "object",
              properties: {
                directory: { type: "string", description: "Directory path (e.g., src/components)" }
              },
              required: ["directory"]
            }
          }
        ],
        tool_choice: { type: "auto" }
      });

      // Process response with tool handling
      let allMessages = [{ role: "user", content: userPrompt }];
      let currentResponse = message;
      let finalResponse = '';
      let toolCallsHandled = false;

      // Handle tool calls in a loop
      do {
        toolCallsHandled = false;
        let assistantContent = [];
        let toolResults = [];

        for (const content of currentResponse.content) {
          if (content.type === 'text') {
            finalResponse += content.text;
            assistantContent.push(content);
          } else if (content.type === 'tool_use') {
            toolCallsHandled = true;
            assistantContent.push(content);
            
            console.log(`\n🔨 [Claude Error Fixer] Requesting tool: ${content.name}`);
            console.log(`📋 [Claude Error Fixer] Tool arguments:`, JSON.stringify(content.input, null, 2));
            
            try {
              let resultContent = '';
              
              switch (content.name) {
                case 'read_project_file':
                  try {
                    resultContent = await mcp.readProjectFile(projectName, content.input.filePath);
                    console.log(`✅ [Claude Error Fixer] Read file: ${content.input.filePath}`);
                  } catch (error) {
                    resultContent = `Error reading file: ${error.message}`;
                  }
                  break;
                  
                case 'search_code':
                  try {
                    resultContent = await mcp.searchCode(
                      projectName, 
                      content.input.pattern, 
                      content.input.fileType
                    );
                    console.log(`✅ [Claude Error Fixer] Searched for: ${content.input.pattern}`);
                  } catch (error) {
                    resultContent = `Error searching: ${error.message}`;
                  }
                  break;
                  
                case 'list_project_files':
                  try {
                    const files = await mcp.listProjectFiles(projectName, content.input.directory);
                    // Convert to string for Claude API
                    resultContent = JSON.stringify(files, null, 2);
                    console.log(`✅ [Claude Error Fixer] Listed files in: ${content.input.directory}`);
                  } catch (error) {
                    resultContent = `Error listing files: ${error.message}`;
                  }
                  break;
              }
              
              toolResults.push({
                type: "tool_result",
                tool_use_id: content.id,
                content: resultContent
              });
              
            } catch (error) {
              console.error(`❌ [Claude Error Fixer] Tool error:`, error);
              toolResults.push({
                type: "tool_result",
                tool_use_id: content.id,
                content: `Error: ${error.message}`,
                is_error: true
              });
            }
          }
        }

        // If we handled tool calls, continue the conversation
        if (toolCallsHandled && toolResults.length > 0) {
          allMessages.push({ role: "assistant", content: assistantContent });
          allMessages.push({ role: "user", content: toolResults });
          
          currentResponse = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 8000,
            temperature: 0.3,
            system: systemPrompt,
            messages: allMessages,
            tools: [
              {
                name: "read_project_file",
                description: "Read a specific file from the project",
                input_schema: {
                  type: "object",
                  properties: {
                    filePath: { type: "string" }
                  },
                  required: ["filePath"]
                }
              },
              {
                name: "search_code",
                description: "Search for code patterns in the project",
                input_schema: {
                  type: "object",
                  properties: {
                    pattern: { type: "string" },
                    fileType: { type: "string" }
                  },
                  required: ["pattern"]
                }
              },
              {
                name: "list_project_files",
                description: "List files in a directory",
                input_schema: {
                  type: "object",
                  properties: {
                    directory: { type: "string" }
                  },
                  required: ["directory"]
                }
              }
            ],
            tool_choice: { type: "auto" }
          });
        }
      } while (toolCallsHandled);

      console.log('📝 [Claude Error Fixer] Parsing fixes from response');
      
      // Parse JSON from response
      try {
        const jsonMatch = finalResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          console.log(`✅ [Claude Error Fixer] Generated ${parsed.files?.length || 0} fixes`);
          return parsed;
        }
      } catch (e) {
        console.error('❌ [Claude Error Fixer] Failed to parse JSON:', e);
      }
      
      // Try direct parsing if no regex match
      try {
        const parsed = JSON.parse(finalResponse);
        return parsed;
      } catch (e) {
        throw new Error(`Failed to parse fixes: ${e.message}`);
      }
      
    } catch (error) {
      console.error('❌ [Claude Error Fixer] Error:', error);
      throw new ClaudeServiceError(`Error fixing build errors with MCP: ${error.message}`);
    }
  }

  // Original generateText method for backward compatibility
  async generateText(prompt, socketId) {
    try {
      const anthropic = this.getAnthropicClient(socketId);
      const message = await anthropic.messages.create({
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
    } catch (error) {
      throw new ClaudeServiceError(`Error generating text: ${error.message}`);
    }
  }

  // Extract code blocks (keeping for compatibility)
  _extractCodeBlocks(text) {
    if (typeof text !== "string") {
      throw new Error("Generated code must be a string");
    }

    function extractBlock(pattern) {
      const regex = new RegExp(pattern, "is");
      const matches = text.match(regex);
      return matches ? matches[1].trim() : null;
    }

    const html = extractBlock(/```html\s*([\s\S]*?)\s*```/);
    const css = extractBlock(/```css\s*([\s\S]*?)\s*```/);
    const javascript = extractBlock(/```javascript\s*([\s\S]*?)\s*```/);

    if (!html && !css && !javascript) {
      throw new Error("No code blocks found in generated text");
    }

    return {
      html: html || "",
      css: css || "",
      javascript: javascript || "",
    };
  }

  // Generate method for backward compatibility
  async generate(prompt) {
    const response = await this.generateText(prompt);
    return this._extractCodeBlocks(response);
  }
}

// Export for use in services
module.exports = { 
  ClaudeServiceProduction,
  ClaudeServiceError,
  // Also export as standard names for compatibility
  ClaudeService: ClaudeServiceProduction,
  LLMService: ClaudeServiceProduction,
  LLMServiceError: ClaudeServiceError
};