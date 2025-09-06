'use client';

import { useState, useEffect, useRef } from 'react';
import { Task } from '@/types/project';
import { cn } from '@/lib/utils/cn';
import { format } from 'date-fns';
import { 
  Send, User, Bot, Loader2, 
  FileCode, GitBranch, AlertCircle,
  Paperclip, Code, FileText
} from 'lucide-react';
import { API_ENDPOINTS, apiFetch } from '@/lib/config/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  status?: 'sending' | 'sent' | 'error';
  attachments?: {
    type: 'file' | 'code';
    name: string;
    content?: string;
    path?: string;
  }[];
}

interface ChatTabProps {
  task: Task;
  projectId: string;
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => void;
  onDiffsGenerated?: () => void;
}

export default function ChatTab({ 
  task, 
  projectId,
  onUpdateTask,
  onDiffsGenerated 
}: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load chat history when component mounts
  useEffect(() => {
    loadChatHistory();
  }, [task.id]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadChatHistory = async () => {
    try {
      // Since Task doesn't have metadata field, start with empty chat history
      // In production, you'd fetch from a separate ChatMessage table
      setMessages([]);
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  };

  const saveChatHistory = async (updatedMessages: ChatMessage[]) => {
    try {
      // Since Task doesn't have metadata field, we'll skip saving for now
      // In production, you'd save to a separate ChatMessage table
      console.log('Chat history would be saved here:', updatedMessages.length, 'messages');
    } catch (error) {
      console.error('Error saving chat history:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() && attachedFiles.length === 0) return;
    if (isLoading) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: inputMessage,
      timestamp: new Date(),
      status: 'sending',
      attachments: attachedFiles.map(file => ({
        type: 'file' as const,
        name: file.split('/').pop() || file,
        path: file
      }))
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setAttachedFiles([]);
    setIsLoading(true);

    try {
      // Call AI agent for follow-up changes
      const response = await apiFetch('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          taskId: task.id,
          projectId,
          message: inputMessage,
          attachedFiles,
          context: {
            taskTitle: task.title,
            taskDescription: task.description,
            currentStatus: task.status,
            existingDiffs: task.diffs
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const data = await response.json();
      
      // Update user message status
      setMessages(prev => prev.map(msg => 
        msg.id === userMessage.id 
          ? { ...msg, status: 'sent' }
          : msg
      ));

      // Add AI response
      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        status: 'sent'
      };

      setMessages(prev => {
        const updated = [...prev, assistantMessage];
        saveChatHistory(updated);
        return updated;
      });

      // If AI made changes, notify parent to refresh diffs
      if (data.hasChanges && onDiffsGenerated) {
        onDiffsGenerated();
      }

    } catch (error) {
      console.error('Error sending message:', error);
      
      // Update message status to error
      setMessages(prev => prev.map(msg => 
        msg.id === userMessage.id 
          ? { ...msg, status: 'error' }
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleFileSelect = () => {
    // TODO: Implement file selector/search
    console.log('File selector not yet implemented');
  };

  const renderMessage = (message: ChatMessage) => {
    const isUser = message.role === 'user';
    
    return (
      <div
        key={message.id}
        className={cn(
          "flex gap-3 p-4",
          isUser ? "bg-secondary/30" : "bg-background"
        )}
      >
        <div className={cn(
          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}>
          {isUser ? (
            <User className="h-4 w-4" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
        </div>
        
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">
              {isUser ? 'You' : 'AI Assistant'}
            </span>
            <span className="text-xs text-muted-foreground">
              {format(message.timestamp, 'HH:mm')}
            </span>
            {message.status === 'sending' && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
            {message.status === 'error' && (
              <AlertCircle className="h-3 w-3 text-destructive" />
            )}
          </div>
          
          <div className="text-sm whitespace-pre-wrap">
            {message.content}
          </div>
          
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {message.attachments.map((attachment, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs"
                >
                  {attachment.type === 'file' ? (
                    <FileText className="h-3 w-3" />
                  ) : (
                    <Code className="h-3 w-3" />
                  )}
                  <span>{attachment.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <Bot className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium text-lg mb-2">Start a conversation</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Ask for follow-up changes or modifications to the task. 
              The AI will help you refine and improve the implementation.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {messages.map(renderMessage)}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-border p-4 space-y-3">
        {/* Attached files display */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs"
              >
                <FileCode className="h-3 w-3" />
                <span>{file.split('/').pop()}</span>
                <button
                  onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                  className="ml-1 hover:text-destructive"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input field and buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleFileSelect}
            className="p-2 rounded-md border border-input hover:bg-secondary transition-colors"
            title="Attach files"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          
          <textarea
            ref={inputRef}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask for changes or improvements... (@ to reference files)"
            className="flex-1 px-3 py-2 text-sm border rounded-md bg-background resize-none"
            rows={1}
            disabled={isLoading}
          />
          
          <button
            onClick={handleSendMessage}
            disabled={(!inputMessage.trim() && attachedFiles.length === 0) || isLoading}
            className={cn(
              "px-4 py-2 rounded-md transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className="text-xs text-muted-foreground">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}