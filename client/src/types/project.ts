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
  metadata?: TaskMetadata;
}

export interface TaskMetadata {
  branch?: string;
  prUrl?: string;
  logs?: string[];
  diffs?: string[];
  comments?: Comment[];
}