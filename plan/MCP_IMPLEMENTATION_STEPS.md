# MCP + Claude Implementation Steps for Kanbanix

## Prerequisites Checklist
- [ ] Get Anthropic API key
- [ ] Access to SynthAI codebase for reusable components
- [ ] Node.js 18+ installed
- [ ] Git repository ready

---

## Phase 1: MCP Server Setup (Days 1-3)

### Step 1: Install MCP SDK
```bash
cd /Users/saykarim/Desktop/Kanban_board/kanbanix-01
npm install @modelcontextprotocol/sdk @anthropic-ai/sdk
```

### Step 2: Create MCP Server Structure
```bash
mkdir -p mcp-server/tools mcp-server/prompts
touch mcp-server/server.js
touch mcp-server/package.json
touch mcp-server/config.json
```

### Step 3: Create Basic MCP Tools
Create these files:
- `mcp-server/tools/file-tools.js` - Read/write files
- `mcp-server/tools/git-tools.js` - Git operations
- `mcp-server/tools/task-tools.js` - Task analysis

### Step 4: Set Up Environment Variables
Add to `.env.local`:
```env
ANTHROPIC_API_KEY=your-key-here
CLAUDE_MODEL=claude-3-opus-20240229
MCP_SERVER_PORT=3001
MCP_ENABLED=true
```

### Step 5: Test MCP Server
```bash
cd mcp-server
npm init -y
npm install
node server.js
# Should start on port 3001
```

---

## Phase 2: Copy & Adapt SynthAI Components (Days 4-6)

### Step 6: Copy AI Service Files from SynthAI
```bash
# Copy these files from SynthAI (no_code_01):
# backend_node/services/aiService.js → client/src/services/claudeService.js
# backend_node/utils/codeFormatter.js → client/src/utils/codeFormatter.js
# backend_node/utils/responseParser.js → client/src/utils/responseParser.js
```

### Step 7: Create Claude Service
Create `client/src/services/claudeService.js`:
- Replace OpenAI calls with Anthropic
- Add MCP client initialization
- Implement streaming responses

### Step 8: Create API Routes
Create these API routes:
- `client/src/app/api/ai/tasks/[taskId]/execute/route.ts`
- `client/src/app/api/ai/tasks/[taskId]/suggest/route.ts`
- `client/src/app/api/ai/commits/generate/route.ts`

---

## Phase 3: UI Integration (Days 7-9)

### Step 9: Add AI Components
Copy and adapt from SynthAI:
- `GenerationModal.jsx` → `AITaskModal.tsx`
- `CodePreview.jsx` → `CodeDiffViewer.tsx`
- `ProgressBar.jsx` → `MCPProgress.tsx`

### Step 10: Add AI Buttons to Task Cards
Update `client/src/components/kanban/TaskCard.tsx`:
- Add "AI Generate" button
- Add "AI Suggest Fix" button
- Add MCP status indicator

### Step 11: Create MCP Status Component
Create `client/src/components/ai/MCPStatusIndicator.tsx`:
- Show which tools are being used
- Display real-time progress
- Show generated code preview

---

## Phase 4: Integration Testing (Days 10-12)

### Step 12: Test Manual AI Triggers
1. Click "AI Generate" on a task
2. Verify Claude receives task context
3. Check MCP tools are called
4. Verify code generation works

### Step 13: Test MCP Tool Chain
Test this flow:
1. readFile → analyze code
2. generateCode → create implementation  
3. writeFile → save changes
4. gitCommit → commit with AI message

### Step 14: Test Error Handling
- Test with invalid task descriptions
- Test API rate limits
- Test rollback on failure

---

## Phase 5: Auto-Execution Feature (Days 13-15)

### Step 15: Implement Drag-to-Execute
Update `client/src/app/project/[projectId]/page.tsx`:
```javascript
const handleDragEnd = async (event) => {
  if (newColumn === 'in_progress' && task.aiEnabled) {
    await executeTaskWithMCP(task.id);
  }
};
```

### Step 16: Add Streaming Logs
- Implement WebSocket connection
- Stream MCP tool usage to UI
- Show real-time execution logs

### Step 17: Add Stop/Rollback Buttons
- Add "Stop Execution" button
- Implement rollback functionality
- Save execution history

---

## Phase 6: GitHub Integration (Days 16-18)

### Step 18: Connect MCP to GitHub
Add GitHub tools to MCP:
- `createPullRequest`
- `analyzePRComments`
- `suggestFromIssues`

### Step 19: Auto-PR Creation
When task completes:
1. Generate PR description with Claude
2. Create PR via GitHub API
3. Link PR to task

### Step 20: Issue-to-Task Conversion
- Analyze GitHub issues
- Suggest tasks with AI
- Auto-create with descriptions

---

## File-by-File Implementation Order

### Week 1: Core Setup
1. ✅ `.env.local` - Add Anthropic key
2. ⏳ `mcp-server/server.js` - Create MCP server
3. ⏳ `mcp-server/tools/file-tools.js` - File operations
4. ⏳ `client/src/services/claudeService.js` - Claude integration

### Week 2: API & UI
5. ⏳ `client/src/app/api/ai/tasks/[taskId]/execute/route.ts`
6. ⏳ `client/src/components/ai/MCPStatusIndicator.tsx`
7. ⏳ `client/src/components/kanban/TaskCard.tsx` - Add AI buttons
8. ⏳ `client/src/hooks/useAIExecution.ts`

### Week 3: Full Integration
9. ⏳ `mcp-server/tools/git-tools.js` - Git operations
10. ⏳ `client/src/app/project/[projectId]/page.tsx` - Auto-execution
11. ⏳ `client/src/components/ai/ExecutionLogs.tsx`
12. ⏳ `prisma/schema.prisma` - Add AI tables

---

## Quick Start Commands

```bash
# 1. Install dependencies
cd /Users/saykarim/Desktop/Kanban_board/kanbanix-01
npm install @modelcontextprotocol/sdk @anthropic-ai/sdk

# 2. Set up MCP server
mkdir -p mcp-server/tools
cd mcp-server
npm init -y
npm install @modelcontextprotocol/sdk

# 3. Add Anthropic key to .env.local
echo "ANTHROPIC_API_KEY=sk-ant-xxxx" >> ../.env.local

# 4. Start MCP server (in one terminal)
node server.js

# 5. Start Next.js (in another terminal)
cd ../client
npm run dev

# 6. Test first AI call
curl -X POST http://localhost:3000/api/ai/test
```

---

## Testing Checkpoints

### After Phase 1:
- [ ] MCP server starts without errors
- [ ] Can call basic MCP tools
- [ ] Claude API connection works

### After Phase 2:
- [ ] Can generate code for a task
- [ ] Streaming responses work
- [ ] Code formatting is correct

### After Phase 3:
- [ ] AI buttons appear on tasks
- [ ] MCP status shows tool usage
- [ ] Generated code displays properly

### After Phase 4:
- [ ] Manual AI execution works end-to-end
- [ ] Errors are handled gracefully
- [ ] Rollback works when needed

### After Phase 5:
- [ ] Drag to "In Progress" triggers AI
- [ ] Real-time logs stream to UI
- [ ] Can stop execution mid-process

### After Phase 6:
- [ ] PRs created automatically
- [ ] GitHub issues convert to tasks
- [ ] Full GitHub integration works

---

## Common Issues & Solutions

### Issue 1: MCP Server Won't Start
```bash
# Check port availability
lsof -i :3001
# Kill process if needed
kill -9 <PID>
```

### Issue 2: Claude API Errors
```javascript
// Add retry logic
const retryWithBackoff = async (fn, retries = 3) => {
  // Implementation
};
```

### Issue 3: File Permission Errors
```bash
# Ensure MCP has write permissions
chmod 755 mcp-server/
```

---

## Success Criteria

1. **Day 3**: MCP server running with basic tools
2. **Day 6**: Claude can generate code for tasks
3. **Day 9**: UI shows AI execution status
4. **Day 12**: Manual AI triggers work perfectly
5. **Day 15**: Auto-execution on drag works
6. **Day 18**: Full GitHub integration complete

---

## Next Immediate Actions

1. **Right Now**: Add Anthropic API key to `.env.local`
2. **Next**: Create MCP server structure
3. **Then**: Copy AI service files from SynthAI
4. **Finally**: Test first Claude API call

Ready to start with Step 1?