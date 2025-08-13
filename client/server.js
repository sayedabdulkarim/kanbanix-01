const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const prisma = new PrismaClient();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Initialize Socket.IO
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    path: '/api/socket'
  });

  // Store io instance globally for use in other modules
  global.io = io;

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Join room for specific project
    socket.on('join-project', (projectId) => {
      socket.join(`project-${projectId}`);
      console.log(`Socket ${socket.id} joined project-${projectId}`);
    });

    // Join room for specific task
    socket.on('join-task', (taskId) => {
      socket.join(`task-${taskId}`);
      console.log(`Socket ${socket.id} joined task-${taskId}`);
    });

    // Subscribe to agent execution updates
    socket.on('subscribe-execution', async (executionId) => {
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
          // Parse JSON fields if they're strings
          let changes = execution.changes;
          if (typeof changes === 'string') {
            try {
              changes = JSON.parse(changes);
            } catch (e) {
              changes = [];
            }
          }
          
          socket.emit('execution-update', {
            executionId,
            status: execution.status,
            progress: execution.progress,
            summary: execution.summary,
            changes: changes,
            logs: execution.logs.map(log => ({
              id: log.id,
              level: log.level,
              message: log.message,
              data: typeof log.metadata === 'string' ? JSON.parse(log.metadata || '{}') : log.metadata,
              timestamp: log.timestamp
            }))
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

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log('> Socket.IO server initialized');
  });
});

// Export helper functions for emitting events
module.exports = {
  emitExecutionUpdate: (executionId, data) => {
    if (global.io) {
      global.io.to(`execution-${executionId}`).emit('execution-update', {
        executionId,
        ...data,
        timestamp: new Date()
      });
    }
  },
  
  emitExecutionLog: (executionId, log) => {
    if (global.io) {
      global.io.to(`execution-${executionId}`).emit('execution-log', {
        executionId,
        log: {
          ...log,
          timestamp: new Date()
        }
      });
    }
  },
  
  emitTaskUpdate: (taskId, projectId, data) => {
    if (global.io) {
      global.io.to(`task-${taskId}`).emit('task-update', data);
      global.io.to(`project-${projectId}`).emit('task-update', data);
    }
  }
};