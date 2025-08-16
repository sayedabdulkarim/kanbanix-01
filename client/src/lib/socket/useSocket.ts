'use client';

import { useEffect, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import { getWebSocketUrl } from '@/lib/config/api';

let socket: Socket | null = null;

export function useSocket() {
  const [connected, setConnected] = useState(false);
  const [executionUpdates, setExecutionUpdates] = useState<Map<string, any>>(new Map());

  useEffect(() => {
    // Initialize socket connection
    if (!socket) {
      const wsUrl = process.env.NEXT_PUBLIC_SOCKET_URL || getWebSocketUrl() || 'http://localhost:3000';
      socket = io(wsUrl, {
        path: '/api/socket',
        transports: ['websocket', 'polling']
      });

      socket.on('connect', () => {
        console.log('Socket connected');
        setConnected(true);
      });

      socket.on('disconnect', () => {
        console.log('Socket disconnected');
        setConnected(false);
      });
    }

    return () => {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
    };
  }, []);

  // Join project room
  const joinProject = useCallback((projectId: string) => {
    if (socket) {
      socket.emit('join-project', projectId);
    }
  }, []);

  // Join task room
  const joinTask = useCallback((taskId: string) => {
    if (socket) {
      socket.emit('join-task', taskId);
    }
  }, []);

  // Subscribe to execution updates
  const subscribeToExecution = useCallback((executionId: string, onUpdate: (data: any) => void) => {
    if (!socket) return;

    socket.emit('subscribe-execution', executionId);
    
    const handleUpdate = (data: any) => {
      if (data.executionId === executionId) {
        onUpdate(data);
        setExecutionUpdates(prev => {
          const newMap = new Map(prev);
          newMap.set(executionId, data);
          return newMap;
        });
      }
    };

    const handleLog = (data: any) => {
      if (data.executionId === executionId) {
        onUpdate({
          ...data,
          type: 'log'
        });
      }
    };

    socket.on('execution-update', handleUpdate);
    socket.on('execution-log', handleLog);

    // Cleanup
    return () => {
      socket?.off('execution-update', handleUpdate);
      socket?.off('execution-log', handleLog);
    };
  }, []);

  // Subscribe to task updates
  const subscribeToTask = useCallback((taskId: string, onUpdate: (data: any) => void) => {
    if (!socket) return;

    socket.emit('join-task', taskId);
    
    const handleUpdate = (data: any) => {
      if (data.taskId === taskId) {
        onUpdate(data);
      }
    };

    socket.on('task-update', handleUpdate);

    return () => {
      socket?.off('task-update', handleUpdate);
    };
  }, []);

  return {
    connected,
    joinProject,
    joinTask,
    subscribeToExecution,
    subscribeToTask,
    executionUpdates
  };
}

// Hook for execution panel
export function useExecutionSocket(executionId: string | null) {
  const [execution, setExecution] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const { subscribeToExecution } = useSocket();

  useEffect(() => {
    if (!executionId) return;

    const unsubscribe = subscribeToExecution(executionId, (data) => {
      if (data.type === 'log') {
        setLogs(prev => [...prev, data.log]);
      } else {
        setExecution(data);
        if (data.logs) {
          setLogs(data.logs);
        }
      }
    });

    return unsubscribe;
  }, [executionId, subscribeToExecution]);

  return { execution, logs };
}