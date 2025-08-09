// Re-export Prisma types
export type { User, Project, Column, Task, Label, Comment, Activity, Webhook } from '@prisma/client';

// Extended types with relations
export interface ProjectWithRelations {
  id: string;
  name: string;
  description: string | null;
  gradient: string | null;
  githubRepoId: string | null;
  githubRepoUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  userId: string;
  columns: ColumnWithTasks[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ColumnWithTasks {
  id: string;
  name: string;
  order: number;
  color: string | null;
  projectId: string;
  tasks: TaskWithRelations[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskWithRelations {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  order: number;
  githubIssueNumber: number | null;
  githubPrNumber: number | null;
  githubBranch: string | null;
  githubIssueId: string | null;
  githubPrId: string | null;
  githubState: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  dueDate: Date | null;
  timeEstimate: number | null;
  timeSpent: number | null;
  projectId: string;
  columnId: string;
  assigneeId: string | null;
  assignee?: UserBasic | null;
  labels: LabelBasic[];
  comments: CommentWithAuthor[];
  activities: ActivityWithUser[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UserBasic {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface LabelBasic {
  id: string;
  name: string;
  color: string;
}

export interface CommentWithAuthor {
  id: string;
  content: string;
  githubCommentId: string | null;
  taskId: string;
  authorId: string;
  author: UserBasic;
  edited: boolean;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActivityWithUser {
  id: string;
  type: string;
  description: string;
  metadata: string | null;
  taskId: string | null;
  userId: string;
  user: UserBasic;
  createdAt: Date;
}

// API Response types
export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
  details?: any;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// GitHub-specific types
export interface GithubRepository {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  private: boolean;
  owner: string;
  stargazersCount: number;
  forksCount: number;
  language: string | null;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

export interface GithubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  htmlUrl: string;
  labels: GithubLabel[];
  assignee: GithubUser | null;
  createdAt: string;
  updatedAt: string;
}

export interface GithubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  merged: boolean;
  htmlUrl: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface GithubLabel {
  name: string;
  color: string;
  description?: string;
}

export interface GithubUser {
  login: string;
  avatarUrl: string;
  htmlUrl: string;
}

export interface GithubComment {
  id: number;
  body: string;
  htmlUrl: string;
  user: GithubUser;
  createdAt: string;
  updatedAt: string;
}

// Webhook payload types
export interface GithubWebhookPayload {
  action: string;
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
  };
  sender: {
    login: string;
    avatar_url: string;
  };
}

export interface IssueWebhookPayload extends GithubWebhookPayload {
  issue: GithubIssue;
}

export interface PullRequestWebhookPayload extends GithubWebhookPayload {
  pull_request: GithubPullRequest;
}

export interface CommentWebhookPayload extends GithubWebhookPayload {
  issue: GithubIssue;
  comment: GithubComment;
}

// Form/Input types
export interface CreateProjectInput {
  name: string;
  description?: string;
  isPrivate?: boolean;
  createGithubRepo?: boolean;
}

export interface ImportRepositoryInput {
  repoId: number;
  repoName: string;
  repoDescription?: string;
  repoUrl: string;
  owner: string;
  repo: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  columnId: string;
  assigneeId?: string;
  labels?: string[];
  dueDate?: Date;
  timeEstimate?: number;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  columnId?: string;
  assigneeId?: string;
  labels?: string[];
  dueDate?: Date;
  timeEstimate?: number;
  timeSpent?: number;
}