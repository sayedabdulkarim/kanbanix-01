# SynthAI to Kanbanix - Reusable Components Plan

## Overview
This document outlines the components and patterns from SynthAI (no_code_01) that can be reused in Kanbanix for AI-powered task automation.

## 1. Core AI Services to Reuse

### 1.1 AI Configuration Service
**From SynthAI:**
- OpenAI/Anthropic API configuration
- Model selection logic (GPT-4, Claude, etc.)
- API key management
- Rate limiting and error handling

**Adaptation for Kanbanix:**
- Use same configuration but for task-specific prompts
- Adjust token limits for smaller code generation tasks
- Keep error handling and retry logic

### 1.2 Prompt Engineering Templates
**From SynthAI:**
```javascript
// Component generation prompts
const generateComponentPrompt = (description) => { ... }
const generateAPIPrompt = (specification) => { ... }
const generateSchemaPrompt = (requirements) => { ... }
```

**Adaptation for Kanbanix:**
```javascript
// Task-specific prompts
const generateTaskCodePrompt = (taskDescription, context) => { ... }
const generateTestsPrompt = (codeSnippet) => { ... }
const generateCommitMessagePrompt = (changes) => { ... }
const suggestTasksPrompt = (repoAnalysis) => { ... }
```

### 1.3 Code Generation Pipeline
**From SynthAI:**
- Parse user input → Generate code → Format output → Validate syntax
- Streaming response handling
- Code formatting and prettification

**Adaptation for Kanbanix:**
- Same pipeline but for smaller, task-focused generations
- Add Git integration for generated code
- Include test generation in pipeline

## 2. API Endpoints to Reuse

### 2.1 Generation Endpoints
**From SynthAI:**
```typescript
POST /api/ai/generate-app
POST /api/ai/generate-component
POST /api/ai/generate-api
```

**Adaptation for Kanbanix:**
```typescript
// Task-focused endpoints
POST /api/ai/tasks/:taskId/generate-code
POST /api/ai/tasks/:taskId/suggest-solution
POST /api/ai/tasks/:taskId/generate-tests
POST /api/ai/projects/:projectId/suggest-tasks
POST /api/ai/commits/generate-message
POST /api/ai/pr/generate-description
```

### 2.2 Streaming Response Handler
**From SynthAI:**
- Server-sent events for real-time generation
- Progress updates during generation
- Chunked response handling

**Adaptation for Kanbanix:**
- Use for real-time task execution logs
- Stream code generation progress
- Live update task status during AI processing

## 3. Frontend Components to Reuse

### 3.1 AI Interaction Components
**From SynthAI:**
```jsx
<AIGenerationModal />
<CodePreview />
<GenerationProgress />
<PromptInput />
```

**Adaptation for Kanbanix:**
```jsx
<AITaskAssistant />      // Modified from AIGenerationModal
<CodeDiffViewer />       // Enhanced CodePreview for showing changes
<TaskExecutionLogs />    // Modified GenerationProgress
<AIActionButtons />      // Quick AI actions on task cards
```

### 3.2 State Management
**From SynthAI:**
- Generation status tracking
- Generated code storage
- User input history

**Adaptation for Kanbanix:**
```typescript
interface AITaskState {
  taskId: string;
  aiStatus: 'idle' | 'generating' | 'reviewing' | 'complete' | 'failed';
  generatedCode?: string;
  suggestions?: string[];
  executionLogs?: LogEntry[];
  changes?: FileChange[];
}
```

## 4. Utility Functions to Reuse

### 4.1 Code Processing
**From SynthAI:**
```javascript
// Code parsing and formatting
parseCodeBlocks(response)
formatCode(code, language)
extractImports(code)
validateSyntax(code)
```

**Adaptation for Kanbanix:**
- Keep all utilities as-is
- Add Git diff generation
- Add file path extraction for multi-file changes

### 4.2 Context Building
**From SynthAI:**
```javascript
buildProjectContext(files)
extractDependencies(package.json)
analyzeFileStructure(directory)
```

**Adaptation for Kanbanix:**
- Enhanced with GitHub repository context
- Include issue/PR history in context
- Add task relationship mapping

## 5. Database Schema Adaptations

### 5.1 AI Execution Tracking
**From SynthAI:**
```sql
-- generations table
CREATE TABLE generations (
  id UUID,
  prompt TEXT,
  response TEXT,
  model VARCHAR,
  created_at TIMESTAMP
);
```

**Adaptation for Kanbanix:**
```sql
-- ai_task_executions table
CREATE TABLE ai_task_executions (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES tasks(id),
  action_type VARCHAR(50), -- 'generate_code', 'suggest_fix', etc.
  prompt TEXT,
  response TEXT,
  model VARCHAR(50),
  status VARCHAR(50),
  execution_time INTEGER,
  created_at TIMESTAMP,
  metadata JSONB -- Store file changes, logs, etc.
);
```

## 6. Environment Variables to Reuse

**From SynthAI:**
```env
OPENAI_API_KEY=
AI_MODEL=gpt-4
MAX_TOKENS=4000
TEMPERATURE=0.7
```

**Adaptation for Kanbanix:**
```env
# AI Configuration (same as SynthAI)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
AI_MODEL=gpt-4
MAX_TOKENS=4000
TEMPERATURE=0.7

# Kanbanix specific
AI_ENABLED=true
AI_AUTO_EXECUTE=false  # Start with manual trigger
AI_EXECUTION_TIMEOUT=60000
AI_MAX_RETRIES=3
```

## 7. Implementation Priority

### Phase 1: Basic AI Integration (Week 1)
1. Copy AI service configuration from SynthAI
2. Adapt prompt templates for task context
3. Implement manual trigger endpoints:
   - `/api/ai/tasks/:taskId/generate-code`
   - `/api/ai/commits/generate-message`

### Phase 2: UI Integration (Week 2)
1. Add AI action buttons to task cards
2. Implement code preview modal (reuse from SynthAI)
3. Add AI-generated tag/badge to tasks

### Phase 3: Advanced Features (Week 3)
1. Task suggestion based on repo analysis
2. Auto-execution on drag to "In Progress"
3. Real-time streaming logs

### Phase 4: GitHub Integration (Week 4)
1. AI-powered PR descriptions
2. Smart issue-to-task conversion
3. Code review assistance

## 8. Key Files to Copy from SynthAI

### Backend Files:
```
backend_node/
├── services/
│   ├── aiService.js         → Copy & modify
│   ├── codeGenerator.js     → Copy as-is
│   └── promptBuilder.js     → Copy & modify
├── routes/
│   └── ai.routes.js         → Copy & adapt endpoints
├── utils/
│   ├── codeFormatter.js     → Copy as-is
│   └── responseParser.js    → Copy as-is
└── config/
    └── ai.config.js         → Copy as-is
```

### Frontend Files:
```
client/src/
├── components/
│   ├── AI/
│   │   ├── GenerationModal.jsx   → Adapt to TaskAIModal
│   │   ├── CodePreview.jsx       → Reuse for diff viewing
│   │   └── ProgressBar.jsx       → Reuse for execution progress
├── hooks/
│   ├── useAIGeneration.js        → Adapt for task context
│   └── useStreamResponse.js      → Copy as-is
├── services/
│   └── aiAPI.js                  → Adapt endpoints
└── utils/
    └── codeHighlight.js          → Copy as-is
```

## 9. Testing Strategy

### Reuse SynthAI Test Patterns:
1. AI response mocking for unit tests
2. Prompt injection testing
3. Rate limit testing
4. Error handling scenarios

### New Kanbanix-specific Tests:
1. Task state transitions with AI
2. GitHub sync after AI generation
3. Multi-file change handling
4. Rollback scenarios

## 10. Migration Checklist

- [ ] Copy AI service files from SynthAI
- [ ] Update environment variables
- [ ] Adapt prompt templates for tasks
- [ ] Modify API endpoints for task context
- [ ] Copy and adapt UI components
- [ ] Update database schema
- [ ] Add AI fields to Task model
- [ ] Implement streaming response
- [ ] Add AI action buttons to UI
- [ ] Test manual AI triggers
- [ ] Implement auto-execution logic
- [ ] Add GitHub integration
- [ ] Performance optimization
- [ ] Security review
- [ ] Documentation update

## Notes

### What NOT to Reuse:
- Full app generation logic (too broad for tasks)
- Template selection UI (not needed)
- Project scaffolding code

### What to Enhance:
- Add Git integration to all AI operations
- Include test generation with code
- Add rollback capabilities
- Implement approval workflow before applying changes

### Security Considerations:
- Sandbox AI-generated code execution
- Validate all generated code before committing
- Rate limit AI API calls per user
- Audit log all AI actions

## Success Metrics

1. **Reuse Efficiency**: 70% of SynthAI AI code reused
2. **Implementation Speed**: 50% faster than building from scratch
3. **Feature Parity**: All SynthAI AI capabilities adapted for tasks
4. **User Adoption**: AI features used in 40% of tasks

## Next Steps

1. Review this plan with the team
2. Set up development branch for AI integration
3. Copy identified files from SynthAI
4. Start with Phase 1 implementation
5. Weekly review of progress and adjustments