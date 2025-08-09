export const GITHUB_SCOPES = [
  'read:user',
  'user:email',
  'repo',
  'write:repo_hook',
  'admin:repo_hook',
  'read:org',
];

export const DEFAULT_COLUMNS = [
  { name: 'Backlog', order: 0, color: '#6B7280' },
  { name: 'To Do', order: 1, color: '#3B82F6' },
  { name: 'In Progress', order: 2, color: '#F59E0B' },
  { name: 'In Review', order: 3, color: '#8B5CF6' },
  { name: 'Done', order: 4, color: '#10B981' },
];

export const PROJECT_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  'linear-gradient(135deg, #d299c2 0%, #fef9d7 100%)',
  'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)',
];

export const TASK_PRIORITIES = {
  low: { label: 'Low', color: '#10B981' },
  medium: { label: 'Medium', color: '#F59E0B' },
  high: { label: 'High', color: '#EF4444' },
};

export const TASK_STATUSES = {
  todo: { label: 'To Do', color: '#6B7280' },
  inProgress: { label: 'In Progress', color: '#3B82F6' },
  inReview: { label: 'In Review', color: '#8B5CF6' },
  done: { label: 'Done', color: '#10B981' },
  cancelled: { label: 'Cancelled', color: '#EF4444' },
};

export const GITHUB_WEBHOOK_EVENTS = [
  'issues',
  'pull_request',
  'issue_comment',
  'pull_request_review',
  'pull_request_review_comment',
  'push',
  'release',
  'deployment',
  'deployment_status',
];

export const API_RATE_LIMITS = {
  github: {
    requests: 5000, // GitHub API rate limit per hour
    window: 60 * 60 * 1000, // 1 hour in milliseconds
  },
  webhook: {
    requests: 100,
    window: 60 * 1000, // 1 minute
  },
};