'use client';

import { useState } from 'react';
import { Task, Comment } from '@/types/project';
import { cn } from '@/lib/utils/cn';
import { formatDistanceToNow } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import { MessageSquare, Send, Edit2, Trash2 } from 'lucide-react';

interface CommentsTabProps {
  task: Task;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
}

export default function CommentsTab({ task, onUpdateTask }: CommentsTabProps) {
  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const comments = task.metadata?.comments || [];

  const handleAddComment = () => {
    if (!newComment.trim()) return;

    const comment: Comment = {
      id: `comment-${Date.now()}`,
      author: 'Current User',
      content: newComment.trim(),
      timestamp: new Date(),
    };

    onUpdateTask(task.id, {
      metadata: {
        ...task.metadata,
        comments: [...comments, comment],
        activities: [
          ...(task.metadata?.activities || []),
          {
            id: `activity-${Date.now()}`,
            type: 'commented',
            description: 'Added a comment',
            timestamp: new Date(),
            user: 'Current User',
          },
        ],
      },
    });

    setNewComment('');
  };

  const handleEditComment = (commentId: string) => {
    const comment = comments.find(c => c.id === commentId);
    if (comment) {
      setEditingCommentId(commentId);
      setEditingContent(comment.content);
    }
  };

  const handleSaveEdit = () => {
    if (!editingContent.trim() || !editingCommentId) return;

    const updatedComments = comments.map(comment =>
      comment.id === editingCommentId
        ? { ...comment, content: editingContent.trim(), edited: true, editedAt: new Date() }
        : comment
    );

    onUpdateTask(task.id, {
      metadata: {
        ...task.metadata,
        comments: updatedComments,
      },
    });

    setEditingCommentId(null);
    setEditingContent('');
  };

  const handleDeleteComment = (commentId: string) => {
    if (!confirm('Are you sure you want to delete this comment?')) return;

    const updatedComments = comments.filter(c => c.id !== commentId);

    onUpdateTask(task.id, {
      metadata: {
        ...task.metadata,
        comments: updatedComments,
      },
    });
  };

  const getAuthorInitials = (author: string) => {
    return author
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getAuthorColor = (author: string) => {
    const colors = [
      'bg-blue-500',
      'bg-green-500',
      'bg-purple-500',
      'bg-yellow-500',
      'bg-pink-500',
      'bg-indigo-500',
    ];
    const index = author.charCodeAt(0) % colors.length;
    return colors[index];
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4">
        {comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquare className="h-8 w-8 mb-2" />
            <p>No comments yet</p>
            <p className="text-sm mt-1">Be the first to comment</p>
          </div>
        ) : (
          <div className="space-y-4">
            {comments.map((comment) => (
              <div key={comment.id} className="flex gap-3">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0",
                  getAuthorColor(comment.author)
                )}>
                  {getAuthorInitials(comment.author)}
                </div>
                
                <div className="flex-1">
                  <div className="bg-secondary rounded-lg p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="font-medium text-sm">{comment.author}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {formatDistanceToNow(new Date(comment.timestamp), { addSuffix: true })}
                        </span>
                        {comment.edited && (
                          <span className="text-xs text-muted-foreground ml-1">(edited)</span>
                        )}
                      </div>
                      
                      {comment.author === 'Current User' && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleEditComment(comment.id)}
                            className="p-1 rounded hover:bg-background transition-colors"
                            title="Edit comment"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteComment(comment.id)}
                            className="p-1 rounded hover:bg-background hover:text-destructive transition-colors"
                            title="Delete comment"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                    
                    {editingCommentId === comment.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm resize-none"
                          rows={3}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleSaveEdit}
                            className="px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-sm"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingCommentId(null);
                              setEditingContent('');
                            }}
                            className="px-3 py-1 rounded-md border border-input hover:bg-secondary text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown>{comment.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-border">
        <div className="flex gap-2">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
            CU
          </div>
          <div className="flex-1">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.metaKey) {
                  handleAddComment();
                }
              }}
              placeholder="Write a comment... (Markdown supported, Cmd+Enter to send)"
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm resize-none"
              rows={3}
            />
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-muted-foreground">
                Markdown is supported
              </span>
              <button
                onClick={handleAddComment}
                disabled={!newComment.trim()}
                className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm inline-flex items-center gap-2"
              >
                <Send className="h-3 w-3" />
                Comment
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}