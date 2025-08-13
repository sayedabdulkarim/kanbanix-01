// MCP Execution API - Bridge between client and MCP server
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { spawn } from 'child_process';
import path from 'path';

// POST /api/mcp/execute - Execute MCP tool
export async function POST(request: NextRequest) {
  try {
    // Check for internal API key for server-to-server calls
    const internalKey = request.headers.get('x-internal-key');
    const isInternalCall = internalKey === process.env.INTERNAL_API_KEY || 
                           internalKey === 'kanbanix-internal-mcp-call';
    
    // If not internal call, check session
    if (!isInternalCall) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const { tool, params } = await request.json();

    if (!tool) {
      return NextResponse.json({ 
        error: 'Tool name is required' 
      }, { status: 400 });
    }

    // Add workspace path to params if projectId is provided
    let enhancedParams = { ...params };
    if (params.projectId) {
      enhancedParams.workspacePath = `/tmp/workspace/${params.projectId}`;
    }

    // Execute MCP tool via stdio
    const result = await executeMCPTool(tool, enhancedParams);
    
    return NextResponse.json(result);

  } catch (error: any) {
    console.error('MCP execution error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to execute MCP tool',
      message: error.message
    }, { status: 500 });
  }
}

// Execute MCP tool using stdio communication
async function executeMCPTool(toolName: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    // Path to MCP server relative to client directory
    const mcpServerPath = path.resolve(process.cwd(), '..', 'mcp-server', 'src', 'index.js');
    
    console.log('Executing MCP tool:', toolName, 'at path:', mcpServerPath);
    
    // Spawn MCP server process
    const mcpProcess = spawn('node', [mcpServerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MCP_MODE: 'desktop',
        NODE_ENV: 'development'
      }
    });

    let output = '';
    let errorOutput = '';
    let responseReceived = false;

    // Handle stdout
    mcpProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      console.log('MCP stdout:', chunk);
      output += chunk;
      
      // Try to parse response
      try {
        // Look for the actual tool response in the output
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.includes('"content"') && !responseReceived) {
            // Extract the content from MCP response
            const match = line.match(/"text"\s*:\s*"(.*)"/);
            if (match) {
              const text = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
              try {
                const result = JSON.parse(text);
                responseReceived = true;
                resolve(result);
              } catch (e) {
                // If not JSON, return as is
                responseReceived = true;
                resolve({ 
                  success: true, 
                  message: text,
                  changes: []
                });
              }
            }
          }
        }
      } catch (e) {
        // Continue collecting output
      }
    });

    // Handle stderr
    mcpProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error('MCP stderr:', data.toString());
    });

    // Send request to MCP server
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params
      }
    };

    console.log('Sending MCP request:', JSON.stringify(request));
    mcpProcess.stdin.write(JSON.stringify(request) + '\n');

    // Set timeout
    const timeout = setTimeout(() => {
      if (!responseReceived) {
        mcpProcess.kill();
        reject(new Error('MCP tool execution timeout'));
      }
    }, 30000); // 30 second timeout

    // Handle process close
    mcpProcess.on('close', (code) => {
      clearTimeout(timeout);
      
      if (!responseReceived) {
        if (code === 0 && output) {
          // Try to parse any output we got
          try {
            const result = JSON.parse(output);
            resolve(result);
          } catch (e) {
            resolve({
              success: false,
              message: 'MCP tool completed but output was not valid JSON',
              rawOutput: output,
              changes: []
            });
          }
        } else if (errorOutput) {
          reject(new Error(`MCP process error: ${errorOutput}`));
        } else {
          reject(new Error(`MCP process exited with code ${code}`));
        }
      }
    });

    // Handle process error
    mcpProcess.on('error', (error) => {
      clearTimeout(timeout);
      console.error('MCP process error:', error);
      reject(error);
    });
  });
}