'use client';

import { useState, useEffect, useCallback } from 'react';
import { Task } from '@/types/project';
import { cn } from '@/lib/utils/cn';
import { formatDistanceToNow } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import { 
  MessageSquare, Send, Edit2, Trash2, RefreshCw, 
  GitPullRequest, Code, User, Bot, ChevronDown, 
  ChevronRight, AlertCircle, CheckCircle, XCircle, Clock,
  Reply
} from 'lucide-react';
import { API_ENDPOINTS, apiFetch } from '@/lib/config/api';

interface GitHubComment {
  id: number;
  node_id: string;
  user: {
    login: string;
    avatar_url: string;
    type: string;
  };
  body: string;
  created_at: string;
  updated_at?: string;
  html_url: string;
  type: 'issue_comment' | 'review_comment';
  path?: string;
  line?: number;
  diff_hunk?: string;
  in_reply_to_id?: number;
  position?: number;
  original_position?: number;
}

interface GitHubReview {
  id: number;
  user: {
    login: string;
    avatar_url: string;
  };
  body: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING';
  submitted_at: string;
  html_url: string;
}

interface CommentsTabProps {
  task: Task;
  projectId: string;
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => void;
}

export default function CommentsTab({ task, projectId, onUpdateTask }: CommentsTabProps) {
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [reviews, setReviews] = useState<GitHubReview[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [expandedDiffs, setExpandedDiffs] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showGitHub, setShowGitHub] = useState(true);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');

  // Fetch comments from GitHub
  const fetchComments = useCallback(async (showRefreshing = false) => {
    if (!task.githubPrNumber) return;

    if (showRefreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await apiFetch(`/api/github/pr-comments`, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          prNumber: task.githubPrNumber
        })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch comments');
      }

      const data = await response.json();
      console.log('[Comments Tab] Received data:', data);
      console.log('[Comments Tab] Comments count:', data.comments?.length || 0);
      console.log('[Comments Tab] Reviews count:', data.reviews?.length || 0);
      setComments(data.comments || []);
      setReviews(data.reviews || []);
    } catch (error) {
      console.error('Error fetching GitHub comments:', error);
      setError('Failed to load comments. Please check your GitHub connection.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [task.githubPrNumber, projectId]);

  // Load comments on mount if PR exists
  useEffect(() => {
    if (task.githubPrNumber && showGitHub) {
      fetchComments();
    }
  }, [task.githubPrNumber, showGitHub]);

  // Send comment to GitHub
  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    // If no PR, just show a message
    if (!task.githubPrNumber) {
      setError('Cannot post comment: No GitHub PR associated with this task');
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const response = await apiFetch(`/api/github/pr-comments/create`, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          prNumber: task.githubPrNumber,
          body: newComment.trim(),
          taskId: task.id
        })
      });

      if (!response.ok) {
        throw new Error('Failed to post comment');
      }

      setNewComment('');
      await fetchComments(false);
    } catch (error) {
      console.error('Error posting comment:', error);
      setError('Failed to post comment. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  // Handle reply to a comment
  const handleReply = async (commentId: number) => {
    if (!replyText.trim()) return;

    if (!task.githubPrNumber) {
      setError('Cannot post reply: No GitHub PR associated with this task');
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      // Find the comment we're replying to
      const originalComment = comments.find(c => c.id === commentId);
      
      const requestBody: any = {
        projectId,
        prNumber: task.githubPrNumber,
        body: replyText.trim(),
        inReplyTo: commentId,
        taskId: task.id
      };

      // If this is a review comment (has path and line), include those for proper threading
      if (originalComment?.type === 'review_comment' && originalComment.path && originalComment.line) {
        requestBody.path = originalComment.path;
        requestBody.line = originalComment.line;
      }

      const response = await apiFetch(`/api/github/pr-comments/create`, {
        method: 'POST',
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error('Failed to post reply');
      }

      setReplyText('');
      setReplyingTo(null);
      await fetchComments(false);
    } catch (error) {
      console.error('Error posting reply:', error);
      setError('Failed to post reply. Please try again.');
    } finally {
      setIsSending(false);
    }
  };


  const toggleDiffExpanded = (commentId: number) => {
    const newExpanded = new Set(expandedDiffs);
    if (newExpanded.has(commentId)) {
      newExpanded.delete(commentId);
    } else {
      newExpanded.add(commentId);
    }
    setExpandedDiffs(newExpanded);
  };

  const renderDiffHunk = (diffHunk: string) => {
    const lines = diffHunk.split('\n');
    let lineNumber = 0;
    
    // Parse starting line number from @@ header
    const headerMatch = lines[0]?.match(/@@ -\d+,?\d* \+(\d+),?\d* @@/);
    if (headerMatch) {
      lineNumber = parseInt(headerMatch[1]) - 1;
    }
    
    // Filter out deletion lines (red lines) - only show additions and context
    const filteredLines = lines.filter(line => !line.startsWith('-') || line.startsWith('---'));
    
    return (
      <div className="font-mono text-xs overflow-x-auto">
        <table className="w-full">
          <tbody>
            {filteredLines.map((line, idx) => {
              if (!line.startsWith('@@')) {
                lineNumber++;
              }
              
              return (
                <tr
                  key={idx}
                  className={cn(
                    line.startsWith('+') && "bg-green-500/10"
                  )}
                >
                  <td className="w-10 px-2 text-right text-muted-foreground select-none">
                    {!line.startsWith('@@') ? lineNumber : ''}
                  </td>
                  <td className="w-4 px-1 text-center select-none">
                    {line.startsWith('+') ? '+' : ''}
                  </td>
                  <td className="px-2">
                    <span className={cn(
                      line.startsWith('+') && "text-green-600 dark:text-green-400",
                      line.startsWith('@@') && "text-blue-600 dark:text-blue-400"
                    )}>
                      {line.startsWith('+') ? line.substring(1) : line}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderReviewState = (state: string) => {
    switch (state) {
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
            <CheckCircle className="h-3 w-3" />
            Approved
          </span>
        );
      case 'CHANGES_REQUESTED':
        return (
          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
            <XCircle className="h-3 w-3" />
            Changes requested
          </span>
        );
      case 'COMMENTED':
        return (
          <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
            <MessageSquare className="h-3 w-3" />
            Commented
          </span>
        );
      default:
        return null;
    }
  };

  // Group comments by file and thread them properly
  const groupedComments = comments.reduce((acc, comment) => {
    // Only include review comments (comments on specific lines)
    if (comment.type === 'review_comment' && comment.path) {
      if (!acc[comment.path]) {
        acc[comment.path] = [];
      }
      acc[comment.path].push(comment);
    }
    // Skip general comments entirely
    return acc;
  }, {} as Record<string, GitHubComment[]>);

  // Organize comments into threads (parent comments with their replies)
  const organizeThreads = (fileComments: GitHubComment[]) => {
    const threads: Map<number, GitHubComment[]> = new Map();
    const rootComments: GitHubComment[] = [];
    
    // First pass: identify root comments and create thread map
    fileComments.forEach(comment => {
      if (!comment.in_reply_to_id) {
        rootComments.push(comment);
        threads.set(comment.id, []);
      }
    });
    
    // Second pass: add replies to their parent threads
    fileComments.forEach(comment => {
      if (comment.in_reply_to_id && threads.has(comment.in_reply_to_id)) {
        threads.get(comment.in_reply_to_id)!.push(comment);
      }
    });
    
    // Sort root comments by position/line number
    rootComments.sort((a, b) => (a.original_position || a.line || 0) - (b.original_position || b.line || 0));
    
    return { rootComments, threads };
  };

  // Show PR icon in header if task has PR
  const hasPR = !!task.githubPrNumber;

  // If no PR, show a message
  if (!hasPR) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <GitPullRequest className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium text-lg mb-2">No Pull Request</h3>
        <p className="text-sm text-muted-foreground">
          Comments will be available once a pull request is created for this task.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with refresh button */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-4 w-4" />
          <span className="font-medium">PR #{task.githubPrNumber} Comments</span>
          <span className="text-xs text-muted-foreground">
            ({comments.length} comments, {reviews.length} reviews)
          </span>
        </div>
        <button
          onClick={() => fetchComments(true)}
          disabled={isRefreshing}
          className="p-2 rounded-md border border-input hover:bg-secondary transition-colors disabled:opacity-50"
          title="Refresh comments"
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mt-4 p-3 rounded-md bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && comments.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>


            {/* Review comments with code context */}
            {(() => {
              // Get all root comments from all files
              const allRootComments: Array<{comment: GitHubComment, replies: GitHubComment[]}> = [];
              
              Object.entries(groupedComments).forEach(([path, fileComments]) => {
                const { rootComments, threads } = organizeThreads(fileComments);
                rootComments.forEach(comment => {
                  allRootComments.push({
                    comment,
                    replies: threads.get(comment.id) || []
                  });
                });
              });
              
              // Sort all comments by line number/position
              allRootComments.sort((a, b) => 
                (a.comment.original_position || a.comment.line || 0) - 
                (b.comment.original_position || b.comment.line || 0)
              );
              
              // Render each comment as a separate section
              return allRootComments.map(({ comment, replies }) => (
                <div key={comment.id} className="mb-6">
                  <div className="border border-border rounded-lg overflow-hidden">
                    {/* File header for this specific comment */}
                    <div className="bg-secondary/50 px-4 py-2 border-b border-border">
                      <div className="flex items-center gap-2 font-mono text-sm">
                        <Code className="h-4 w-4" />
                        {comment.path}
                      </div>
                    </div>
                    
                    {/* Code context for this comment */}
                    {comment.diff_hunk && (
                      <div className="bg-secondary/20 border-b border-border">
                        {renderDiffHunk(comment.diff_hunk)}
                      </div>
                    )}
                    
                    {/* Comment and replies */}
                    <div className="p-4">
                            {/* Root comment */}
                            <div className="flex gap-3">
                              <img
                                src={comment.user.avatar_url}
                                alt={comment.user.login}
                                className="w-8 h-8 rounded-full flex-shrink-0"
                              />
                              <div className="flex-1">
                                <div className="border border-border rounded-lg">
                                  <div className="bg-secondary/30 px-3 py-2 border-b border-border flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-sm">{comment.user.login}</span>
                                      <span className="text-xs text-muted-foreground">commented</span>
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                      {comment.created_at ? formatDistanceToNow(new Date(comment.created_at), { addSuffix: true }) : 'Unknown time'}
                                    </span>
                                  </div>
                                  <div className="p-3">
                                    <div className="prose prose-sm dark:prose-invert max-w-none">
                                      <ReactMarkdown>{comment.body}</ReactMarkdown>
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Replies to this comment */}
                                {replies.map((reply) => (
                                  <div key={reply.id} className="mt-3 ml-4 flex gap-3">
                                    <img
                                      src={reply.user.avatar_url}
                                      alt={reply.user.login}
                                      className="w-6 h-6 rounded-full flex-shrink-0"
                                    />
                                    <div className="flex-1">
                                      <div className="border border-border rounded-lg">
                                        <div className="bg-secondary/20 px-3 py-2 border-b border-border flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm">{reply.user.login}</span>
                                            <span className="text-xs text-muted-foreground">replied</span>
                                          </div>
                                          <span className="text-xs text-muted-foreground">
                                            {reply.created_at ? formatDistanceToNow(new Date(reply.created_at), { addSuffix: true }) : 'Unknown time'}
                                          </span>
                                        </div>
                                        <div className="p-3">
                                          <div className="prose prose-sm dark:prose-invert max-w-none">
                                            <ReactMarkdown>{reply.body}</ReactMarkdown>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                
                                {/* Reply button and input */}
                                <div className="mt-3">
                                  {replyingTo !== comment.id ? (
                                    <button
                                      onClick={() => setReplyingTo(comment.id)}
                                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-4"
                                    >
                                      <Reply className="h-3 w-3" />
                                      Reply
                                    </button>
                                  ) : (
                                    <div className="ml-4">
                                      <div className="border border-border rounded-lg p-3 bg-background">
                                        <textarea
                                          value={replyText}
                                          onChange={(e) => setReplyText(e.target.value)}
                                          placeholder="Write a reply..."
                                          className="w-full px-2 py-1 text-sm border-0 bg-transparent resize-none focus:outline-none"
                                          rows={3}
                                          autoFocus
                                        />
                                        <div className="flex justify-end gap-2 mt-2">
                                          <button
                                            onClick={() => {
                                              setReplyingTo(null);
                                              setReplyText('');
                                            }}
                                            className="px-3 py-1 text-xs border border-border rounded hover:bg-secondary"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            onClick={() => handleReply(comment.id)}
                                            disabled={!replyText.trim() || isSending}
                                            className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                                          >
                                            {isSending ? 'Sending...' : 'Reply'}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                    </div>
                  </div>
                </div>
              ));
            })()}

            {comments.length === 0 && reviews.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <MessageSquare className="h-8 w-8 mb-2" />
                <p>No comments yet</p>
                <p className="text-sm mt-1">Be the first to comment on this PR</p>
              </div>
            )}
          </>
        )}
      </div>

    </div>
  );
}