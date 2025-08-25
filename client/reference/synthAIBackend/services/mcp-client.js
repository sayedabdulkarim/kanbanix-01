// MCP Client for connecting Claude to MCP Server
const { spawn } = require('child_process');
const path = require('path');

class MCPClient {
  constructor() {
    this.mcpProcess = null;
    this.handlers = new Map();
    this.requestId = 0;
  }

  // Start the MCP server
  async start() {
    return new Promise((resolve, reject) => {
      const mcpServerPath = path.join(__dirname, '../mcp/server-simple.js');
      
      console.log('\n🚀 [MCP] Starting MCP server...');
      console.log(`📁 [MCP] Server path: ${mcpServerPath}`);
      
      // Spawn the MCP server process
      this.mcpProcess = spawn('node', [mcpServerPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'development' }
      });

      this.mcpProcess.stdout.on('data', (data) => {
        this.handleResponse(data.toString());
      });

      this.mcpProcess.stderr.on('data', (data) => {
        const message = data.toString();
        if (message.includes('MCP Server started successfully')) {
          console.log('✅ [MCP] Server started successfully!');
          resolve();
        } else {
          console.error('❌ [MCP] Server error:', message);
        }
      });

      this.mcpProcess.on('error', (error) => {
        console.error('❌ [MCP] Failed to start server:', error);
        reject(error);
      });

      this.mcpProcess.on('close', (code) => {
        console.log(`🔚 [MCP] Server exited with code ${code}`);
      });
    });
  }

  // Stop the MCP server
  stop() {
    if (this.mcpProcess) {
      this.mcpProcess.kill();
      this.mcpProcess = null;
    }
  }

  // Call an MCP tool
  async callTool(toolName, args) {
    return new Promise((resolve, reject) => {
      const requestId = ++this.requestId;
      
      console.log(`\n🔧 [MCP] Calling tool: ${toolName}`);
      console.log(`📤 [MCP] Request ID: ${requestId}`);
      console.log(`📦 [MCP] Arguments:`, JSON.stringify(args, null, 2));
      
      // Store the handler for this request
      this.handlers.set(requestId, { resolve, reject });
      
      // Send request to MCP server
      const request = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args
        }
      };
      
      this.mcpProcess.stdin.write(JSON.stringify(request) + '\n');
      
      // Set timeout
      setTimeout(() => {
        if (this.handlers.has(requestId)) {
          this.handlers.delete(requestId);
          console.error(`⏱️ [MCP] Tool call timeout: ${toolName} (ID: ${requestId})`);
          reject(new Error(`MCP tool call timeout: ${toolName}`));
        }
      }, 30000); // 30 second timeout
    });
  }

  // Handle responses from MCP server
  handleResponse(data) {
    try {
      const lines = data.trim().split('\n');
      for (const line of lines) {
        if (line) {
          const response = JSON.parse(line);
          if (response.id && this.handlers.has(response.id)) {
            const handler = this.handlers.get(response.id);
            this.handlers.delete(response.id);
            
            if (response.error) {
              console.error(`❌ [MCP] Tool error (ID: ${response.id}):`, response.error.message);
              handler.reject(new Error(response.error.message));
            } else {
              console.log(`✅ [MCP] Tool response received (ID: ${response.id})`);
              // Log first 200 chars of response for debugging
              const preview = JSON.stringify(response.result).substring(0, 200);
              console.log(`📥 [MCP] Response preview: ${preview}${JSON.stringify(response.result).length > 200 ? '...' : ''}`);
              handler.resolve(response.result);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ [MCP] Error parsing response:', error);
      console.error('📄 [MCP] Raw data:', data);
    }
  }

  // Convenience methods for common tools
  async readProjectFile(projectName, filePath) {
    const result = await this.callTool('read_project_file', { projectName, filePath });
    return result.content[0].text;
  }

  async listProjectFiles(projectName, directory) {
    const result = await this.callTool('list_project_files', { projectName, directory });
    return JSON.parse(result.content[0].text);
  }

  async searchCode(projectName, pattern, fileType) {
    const result = await this.callTool('search_code', { projectName, pattern, fileType });
    return result.content[0].text;
  }

  async checkProjectStructure(projectName) {
    const result = await this.callTool('check_project_structure', { projectName });
    return JSON.parse(result.content[0].text);
  }

  async runBuild(projectName) {
    const result = await this.callTool('run_build', { projectName });
    return result.content[0].text;
  }

  async readErrorLog(projectName, errorType) {
    const result = await this.callTool('read_error_log', { projectName, errorType });
    return result.content[0].text;
  }
}

// Singleton instance
let mcpClient = null;

// Get or create MCP client instance
async function getMCPClient() {
  if (!mcpClient) {
    console.log('\n🔄 [MCP] Creating new MCP client instance...');
    mcpClient = new MCPClient();
    await mcpClient.start();
    console.log('✅ [MCP] MCP client ready for use!');
  } else {
    console.log('♻️ [MCP] Reusing existing MCP client instance');
  }
  return mcpClient;
}

module.exports = {
  MCPClient,
  getMCPClient
};