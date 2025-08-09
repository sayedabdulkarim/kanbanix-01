export interface Project {
  id: string;
  name: string;
  description?: string;
  type: 'ai-agent' | 'standard' | 'template';
  gradient: string;
  initials: string;
  techStack: string[];
  createdAt: Date;
  modifiedAt: Date;
  columns: Column[];
  settings?: ProjectSettings;
}

export interface Column {
  id: string;
  name: string;
  order: number;
  color: string;
}

export interface ProjectSettings {
  aiEnabled?: boolean;
  customColumns?: boolean;
  maxTasks?: number;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: 'todo' | 'inProgress' | 'inReview' | 'done' | 'cancelled';
  columnId: string;
  order: number;
  priority?: 'low' | 'medium' | 'high';
  assignee?: string;
  labels?: string[];
  createdAt: Date;
  modifiedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  dueDate?: Date;
  timeEstimate?: number; // in hours
  timeSpent?: number; // in hours
  attachments?: Attachment[];
  relatedTasks?: string[];
  blockedBy?: string[];
  metadata?: TaskMetadata;
}

export interface TaskMetadata {
  branch?: string;
  prUrl?: string;
  logs?: LogEntry[];
  diffs?: DiffEntry[];
  comments?: Comment[];
  activities?: Activity[];
  errors?: ErrorEntry[];
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  details?: string;
}

export interface DiffEntry {
  id: string;
  fileName: string;
  filePath: string;
  additions: number;
  deletions: number;
  changes: string;
  timestamp: Date;
}

export interface Comment {
  id: string;
  author: string;
  content: string;
  timestamp: Date;
  edited?: boolean;
  editedAt?: Date;
}

export interface Activity {
  id: string;
  type: 'created' | 'updated' | 'moved' | 'commented' | 'status_changed' | 'assigned';
  description: string;
  timestamp: Date;
  user?: string;
  details?: Record<string, unknown>;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
  uploadedAt: Date;
}

export interface ErrorEntry {
  id: string;
  type: 'syntax' | 'type' | 'build' | 'runtime' | 'test';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  suggestion?: string;
  confidence?: number;
  timestamp: Date;
}