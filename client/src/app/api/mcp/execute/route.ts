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
      enhancedParams.workspacePath = params.workspacePath || path.join(process.cwd(), 'projects', params.projectId);
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
    
    // Track files for change detection
    const fs = require('fs');
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const workspacePath = params.workspacePath || path.join(process.cwd(), 'projects', params.projectId);
    const executionId = params.executionId;
    let beforeFiles: Set<string> = new Set();
    
    // Get list of files before execution
    if (fs.existsSync(workspacePath)) {
      const getAllFiles = (dir: string, fileList: string[] = []): string[] => {
        const files = fs.readdirSync(dir);
        files.forEach((file: string) => {
          const filePath = path.join(dir, file);
          if (fs.statSync(filePath).isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
            getAllFiles(filePath, fileList);
          } else if (!file.startsWith('.')) {
            fileList.push(path.relative(workspacePath, filePath));
          }
        });
        return fileList;
      };
      beforeFiles = new Set(getAllFiles(workspacePath));
    }
    
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
    mcpProcess.stdout.on('data', async (data) => {
      const chunk = data.toString();
      console.log('MCP stdout:', chunk);
      output += chunk;
      
      // Stream logs to execution if executionId provided
      if (executionId) {
        // Parse and log meaningful messages
        const lines = chunk.split('\n').filter(line => line.trim());
        for (const line of lines) {
          // Skip JSON-RPC protocol messages
          if (line.includes('jsonrpc') || line.includes('"id"') || line.includes('"method"')) {
            continue;
          }
          
          // Log installation progress
          if (line.includes('npm install') || line.includes('Installing') || 
              line.includes('added') || line.includes('packages')) {
            await prisma.agentLog.create({
              data: {
                executionId,
                level: 'info',
                message: line.trim(),
                metadata: null
              }
            }).catch((e: any) => console.error('Failed to log:', e));
          }
          // Log file operations
          else if (line.includes('Creating') || line.includes('Writing') || 
                   line.includes('Generated') || line.includes('Created')) {
            await prisma.agentLog.create({
              data: {
                executionId,
                level: 'info',
                message: line.trim(),
                metadata: null
              }
            }).catch((e: any) => console.error('Failed to log:', e));
          }
        }
      }
      
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
                
                // Use changes from the result if provided, otherwise detect
                let changes = result.changes || [];
                
                // If no changes in result, detect file changes
                if (!changes.length && fs.existsSync(workspacePath)) {
                  const getAllFiles = (dir: string, fileList: string[] = []): string[] => {
                    const files = fs.readdirSync(dir);
                    files.forEach((file: string) => {
                      const filePath = path.join(dir, file);
                      if (fs.statSync(filePath).isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
                        getAllFiles(filePath, fileList);
                      } else if (!file.startsWith('.')) {
                        fileList.push(path.relative(workspacePath, filePath));
                      }
                    });
                    return fileList;
                  };
                  const afterFiles = new Set(getAllFiles(workspacePath));
                  
                  afterFiles.forEach((file: string) => {
                    if (!beforeFiles.has(file)) {
                      changes.push({ path: file, type: 'created' });
                    }
                  });
                }
                
                responseReceived = true;
                resolve({ ...result, changes });
              } catch (e) {
                // If not JSON, detect file changes and return
                const changes: any[] = [];
                if (fs.existsSync(workspacePath)) {
                  const getAllFiles = (dir: string, fileList: string[] = []): string[] => {
                    const files = fs.readdirSync(dir);
                    files.forEach((file: string) => {
                      const filePath = path.join(dir, file);
                      if (fs.statSync(filePath).isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
                        getAllFiles(filePath, fileList);
                      } else if (!file.startsWith('.')) {
                        fileList.push(path.relative(workspacePath, filePath));
                      }
                    });
                    return fileList;
                  };
                  const afterFiles = new Set(getAllFiles(workspacePath));
                  
                  afterFiles.forEach((file: string) => {
                    if (!beforeFiles.has(file)) {
                      changes.push({ path: file, type: 'created' });
                    }
                  });
                }
                
                responseReceived = true;
                resolve({ 
                  success: true, 
                  message: text,
                  summary: `Generated code for task`,
                  changes
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

    // Set timeout - increased for create-next-app which can take longer
    const timeout = setTimeout(() => {
      if (!responseReceived) {
        mcpProcess.kill();
        reject(new Error('MCP tool execution timeout'));
      }
    }, 120000); // 120 second timeout for longer operations like create-next-app

    // Handle process close
    mcpProcess.on('close', (code) => {
      clearTimeout(timeout);
      
      if (!responseReceived) {
        // Detect file changes after execution
        const changes: any[] = [];
        if (fs.existsSync(workspacePath)) {
          const getAllFiles = (dir: string, fileList: string[] = []): string[] => {
            const files = fs.readdirSync(dir);
            files.forEach((file: string) => {
              const filePath = path.join(dir, file);
              if (fs.statSync(filePath).isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
                getAllFiles(filePath, fileList);
              } else if (!file.startsWith('.')) {
                fileList.push(path.relative(workspacePath, filePath));
              }
            });
            return fileList;
          };
          const afterFiles = new Set(getAllFiles(workspacePath));
          
          // Find new and modified files
          afterFiles.forEach((file: string) => {
            if (!beforeFiles.has(file)) {
              changes.push({
                path: file,
                type: 'created'
              });
            }
          });
          
          // Find deleted files
          beforeFiles.forEach((file: string) => {
            if (!afterFiles.has(file)) {
              changes.push({
                path: file,
                type: 'deleted'
              });
            }
          });
        }
        
        if (code === 0) {
          // Success - return with detected changes
          resolve({
            success: true,
            message: output || 'Code generated successfully',
            summary: `Generated code for task`,
            changes: changes
          });
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