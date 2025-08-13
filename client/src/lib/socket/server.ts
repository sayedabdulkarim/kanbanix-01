import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let io: SocketIOServer | null = null;

export function initSocketServer(httpServer: HTTPServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_URL || 'http://localhost:3000',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Join room for specific project
    socket.on('join-project', (projectId: string) => {
      socket.join(`project-${projectId}`);
      console.log(`Socket ${socket.id} joined project-${projectId}`);
    });

    // Join room for specific task
    socket.on('join-task', (taskId: string) => {
      socket.join(`task-${taskId}`);
      console.log(`Socket ${socket.id} joined task-${taskId}`);
    });

    // Subscribe to agent execution updates
    socket.on('subscribe-execution', async (executionId: string) => {
      socket.join(`execution-${executionId}`);
      console.log(`Socket ${socket.id} subscribed to execution-${executionId}`);
      
      // Send current execution status
      try {
        const execution = await prisma.agentExecution.findUnique({
          where: { id: executionId },
          include: {
            logs: {
              orderBy: { timestamp: 'asc' }
            }
          }
        });
        
        if (execution) {
          socket.emit('execution-update', {
            executionId,
            status: execution.status,
            progress: execution.progress,
            summary: execution.summary,
            logs: execution.logs
          });
        }
      } catch (error) {
        console.error('Error fetching execution:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}

// Emit agent execution updates
export function emitExecutionUpdate(
  executionId: string,
  data: {
    status?: string;
    progress?: number;
    summary?: string;
    log?: any;
    error?: string;
    changes?: any[];
  }
) {
  if (!io) return;
  
  io.to(`execution-${executionId}`).emit('execution-update', {
    executionId,
    ...data,
    timestamp: new Date()
  });
}

// Emit task updates
export function emitTaskUpdate(
  taskId: string,
  projectId: string,
  data: any
) {
  if (!io) return;
  
  io.to(`task-${taskId}`).emit('task-update', data);
  io.to(`project-${projectId}`).emit('task-update', data);
}

// Emit new log entry
export function emitExecutionLog(
  executionId: string,
  log: {
    level: string;
    message: string;
    data?: any;
  }
) {
  if (!io) return;
  
  io.to(`execution-${executionId}`).emit('execution-log', {
    executionId,
    log: {
      ...log,
      timestamp: new Date()
    }
  });
}

export function getIO() {
  return io;
}