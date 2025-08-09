# Kanbanix - AI Agent Workflow & Backend Integration

## Overview
This document describes the AI agent integration and backend workflow for Kanbanix, where tasks automatically execute when moved to "In Progress" and update their status based on agent execution results.

## AI Agent Task Workflow

### 1. Task Lifecycle with AI Agents

#### Task Creation → To Do
- User creates a task with coding/development requirements
- Task appears in "To Do" column
- Task is marked as "AI-enabled" if it contains executable instructions
- Agent assignment happens automatically based on task type

#### To Do → In Progress (Drag Trigger)
- **User Action**: Drags task from "To Do" to "In Progress"
- **System Response**:
  1. Task status updates to "in_progress"
  2. AI agent spawns automatically
  3. Loading/processing indicator appears on task card
  4. Real-time logs start streaming
  5. "Stop Attempt" button becomes active
  6. Task card shows "Running" badge

#### In Progress → Done (Auto-move)
- **Trigger**: Agent completes task successfully
- **System Actions**:
  1. Task automatically moves to "Done" column
  2. Success notification appears
  3. Completion timestamp recorded
  4. Logs finalized
  5. Diffs/changes available for review
  6. "Create PR" button enabled if code changes exist

#### In Progress → Cancelled (User/System)
- **User Trigger**: Click "Stop Attempt" button
- **System Trigger**: Agent fails or times out
- **Actions**:
  1. Task moves to "Cancelled" column
  2. Error/cancellation reason logged
  3. "New Attempt" button appears
  4. Partial progress saved if applicable

### 2. Agent Execution Details

#### Agent Types
```typescript
enum AgentType {
  CODE_GENERATOR = 'code_generator',
  BUG_FIXER = 'bug_fixer',
  DOCUMENTATION = 'documentation',
  TESTING = 'testing',
  REFACTORING = 'refactoring',
  REVIEW = 'review'
}
```

#### Agent Task Interface
```typescript
interface AgentTask {
  id: string;
  taskId: string;
  agentType: AgentType;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  input: {
    title: string;
    description: string;
    requirements: string[];
    context?: {
      baseBranch: string;
      workingDirectory: string;
      files?: string[];
    };
  };
  execution: {
    startedAt?: Date;
    completedAt?: Date;
    duration?: number;
    attempts: number;
    currentStep?: string;
    progress?: number; // 0-100
  };
  output: {
    logs: LogEntry[];
    changes: FileChange[];
    summary?: string;
    errors?: ErrorDetail[];
    pullRequest?: PRDetails;
  };
}
```

### 3. Real-time Updates

#### WebSocket Events
```typescript
// Server → Client events
interface AgentEvents {
  'agent:started': { taskId: string; agentId: string };
  'agent:progress': { taskId: string; progress: number; currentStep: string };
  'agent:log': { taskId: string; log: LogEntry };
  'agent:file_changed': { taskId: string; file: FileChange };
  'agent:completed': { taskId: string; result: 'success' | 'failed' };
  'agent:error': { taskId: string; error: ErrorDetail };
  'task:status_changed': { taskId: string; from: Status; to: Status };
}
```

#### Log Streaming
```typescript
interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  metadata?: {
    file?: string;
    line?: number;
    component?: string;
  };
}
```

### 4. Task Instructions Parser

#### Natural Language Processing
- Parse user task descriptions into executable instructions
- Extract key requirements and acceptance criteria
- Identify file paths, function names, and technical specifications
- Generate structured agent instructions

#### Example Parsing
```
Input: "Update the navbar to be responsive on mobile"
↓
Parsed Instructions:
{
  action: "modify",
  targets: ["components/navbar"],
  requirements: [
    "Add mobile breakpoint styles",
    "Implement hamburger menu",
    "Test on mobile viewports"
  ],
  acceptanceCriteria: [
    "Navbar collapses on screens < 768px",
    "Menu items accessible via hamburger",
    "Smooth transitions"
  ]
}
```

### 5. File Changes & Diffs

#### Change Tracking
```typescript
interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  diff: {
    added: number;
    removed: number;
    hunks: DiffHunk[];
  };
  content?: {
    before: string;
    after: string;
  };
}
```

#### Diff Display
- Syntax highlighted code diffs
- Side-by-side or unified view
- File tree with change indicators
- Inline comments on specific lines

### 6. Pull Request Integration

#### Automatic PR Creation
When a task with code changes completes:
1. Generate PR title from task title
2. Create PR description from:
   - Task description
   - Agent execution summary
   - List of changed files
   - Test results (if applicable)
3. Set appropriate labels
4. Link back to task

#### PR Template
```markdown
## Summary
[Task description]

## Changes Made
- [List of key changes]
- [Files modified]

## Testing
- [ ] Unit tests pass
- [ ] Manual testing completed
- [ ] No console errors

## Task Details
- Task ID: [task-id]
- Agent: [agent-type]
- Execution time: [duration]

---
Generated by Kanbanix AI Agent
```

### 7. Error Handling & Recovery

#### Failure Scenarios
1. **Syntax Errors**: Agent generates invalid code
2. **Test Failures**: Changes break existing tests
3. **Timeout**: Task exceeds time limit
4. **Resource Limits**: Memory/CPU constraints
5. **API Failures**: External service errors

#### Recovery Options
- **Retry**: Attempt task again with same parameters
- **Modify & Retry**: Edit task description and retry
- **Manual Override**: Developer takes over task
- **Rollback**: Revert any partial changes

### 8. Backend Architecture

#### API Endpoints
```typescript
// Task Management
POST   /api/projects/:projectId/tasks
PUT    /api/tasks/:taskId/status
DELETE /api/tasks/:taskId

// Agent Control
POST   /api/tasks/:taskId/execute
POST   /api/tasks/:taskId/stop
GET    /api/tasks/:taskId/logs
GET    /api/tasks/:taskId/changes

// Real-time
WS     /api/ws/project/:projectId
```

#### Database Schema
```sql
-- Tasks table
CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  title VARCHAR(255),
  description TEXT,
  status VARCHAR(50),
  column_id UUID,
  order_index INTEGER,
  agent_enabled BOOLEAN,
  agent_type VARCHAR(50),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Agent executions table
CREATE TABLE agent_executions (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES tasks(id),
  status VARCHAR(50),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  logs JSONB,
  changes JSONB,
  error_details JSONB
);
```

### 9. Security Considerations

#### Sandboxing
- Execute agents in isolated containers
- Limit file system access to project directory
- Network restrictions for sensitive operations
- Resource quotas per execution

#### Authentication & Authorization
- User must own project to trigger agents
- Rate limiting on agent executions
- Audit trail of all agent actions
- Secure storage of generated code

### 10. Performance Optimization

#### Caching
- Cache frequently used dependencies
- Store common code patterns
- Reuse agent configurations
- Pre-warm execution environments

#### Scaling
- Queue management for concurrent tasks
- Load balancing across agent workers
- Horizontal scaling of execution nodes
- Priority queues for different task types

## Integration Points

### Frontend Integration
- WebSocket client for real-time updates
- State management for agent status
- UI components for logs/diffs display
- Progress indicators and animations

### CI/CD Integration
- Trigger builds on PR creation
- Run tests automatically
- Deploy preview environments
- Status checks on GitHub/GitLab

### Monitoring & Analytics
- Agent success/failure rates
- Average execution times
- Resource usage patterns
- Error frequency analysis

## Future Enhancements

1. **Multi-agent Collaboration**: Multiple agents working on related tasks
2. **Learning & Improvement**: Agent learns from successful patterns
3. **Custom Agent Training**: Train agents on specific codebases
4. **Voice Commands**: Natural language task creation via voice
5. **Predictive Task Creation**: Suggest tasks based on project state
6. **Auto-review**: Agents review each other's code
7. **Intelligent Batching**: Group related tasks for efficiency
8. **Cross-project Learning**: Share patterns across projects