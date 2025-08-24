# Kanbanix V2 Detailed Multi-Step Test Scenarios

## Test Execution Guide
Each scenario should be executed exactly as written, documenting any deviations or failures at each checkpoint.

---

## 🧪 Scenario 1: Complete Project Lifecycle with Multiple PRs

### Initial Setup
- [ ] Clean database (delete SQLite file)
- [ ] Empty projects/ directory
- [ ] No running dev servers (check ports 3000-5000)
- [ ] Fresh browser session

### Phase 1: First PR - Boilerplate Creation
**Steps:**
1. **Create New Project**
   - Name: `test-multi-pr-v2`
   - Connect to GitHub repo
   - ✅ **Checkpoint**: Project created, session state active

2. **Task 1: Create Boilerplate**
   - Title: "Create a Next.js boilerplate"
   - Wait for AI completion
   - ✅ **Checkpoint**: Task moves to "In Progress"
   - ✅ **Checkpoint**: Files created in workspace
   - ✅ **Checkpoint**: No build errors in console

3. **Test Dev Server**
   - Click "Open in Browser" 
   - ✅ **Checkpoint**: Dev server starts on port 4001
   - ✅ **Checkpoint**: Page loads without errors
   - ✅ **Checkpoint**: No Tailwind CSS errors

4. **Commit and Create PR**
   - Click "Commit All"
   - Message: "feat: initial boilerplate setup"
   - Click "Create PR"
   - ✅ **Checkpoint**: PR created successfully
   - ✅ **Checkpoint**: Task moves to "In Review"

5. **Merge PR**
   - Go to GitHub and merge PR
   - Wait 10 seconds for webhook/polling
   - ✅ **Checkpoint**: Task moves to "Done"
   - ✅ **Checkpoint**: Session resets automatically
   - ✅ **Checkpoint**: New session branch created
   - ✅ **Checkpoint**: Dev server still accessible

### Phase 2: Second PR - Add Features
**Steps:**
6. **Task 2: Add Counter Component**
   - Title: "Create a counter app with increment and decrement button"
   - Wait for AI completion
   - ✅ **Checkpoint**: Task moves to "In Progress"
   - ✅ **Checkpoint**: Counter component created
   - ✅ **Checkpoint**: No TypeScript errors

7. **Verify Counter Works**
   - Open browser to localhost:4001
   - Test increment button
   - Test decrement button
   - ✅ **Checkpoint**: Counter updates correctly
   - ✅ **Checkpoint**: No console errors
   - ✅ **Checkpoint**: Styling applied correctly

8. **Task 3: Add Todo List (Same Session)**
   - Title: "Add a todo list component with add and delete functionality"
   - Wait for AI completion
   - ✅ **Checkpoint**: Both tasks show "In Progress"
   - ✅ **Checkpoint**: Todo component created

9. **Test Both Features Together**
   - Refresh browser
   - ✅ **Checkpoint**: Counter still works
   - ✅ **Checkpoint**: Todo list works
   - ✅ **Checkpoint**: No conflicts between components
   - ✅ **Checkpoint**: Build passes

10. **Commit Multiple Tasks**
    - Click "Commit All"
    - Custom message: "feat: add counter and todo list components"
    - ✅ **Checkpoint**: Git diff shows both components
    - ✅ **Checkpoint**: Commit includes all changes

11. **Create Second PR**
    - Click "Create PR" 
    - ✅ **Checkpoint**: PR includes both features
    - ✅ **Checkpoint**: Both tasks move to "In Review"
    - ✅ **Checkpoint**: Dev server still running

### Phase 3: Session Management Test
**Steps:**
12. **Test End Session**
    - Click "End Session" button
    - ✅ **Checkpoint**: Confirm dialog appears
    - Confirm action
    - ✅ **Checkpoint**: Redirects to dashboard
    - ✅ **Checkpoint**: Dev server stops
    - ✅ **Checkpoint**: Port 4001 is free
    - ✅ **Checkpoint**: Workspace deleted

13. **Re-enter Project from Dashboard**
    - Click on same project from dashboard
    - ✅ **Checkpoint**: New session created
    - ✅ **Checkpoint**: Workspace re-cloned from GitHub
    - ✅ **Checkpoint**: Previous PR still pending

14. **Task 4: Add New Feature (New Session)**
    - Title: "Add a header navigation component"
    - Wait for completion
    - ✅ **Checkpoint**: Task completes without errors
    - ✅ **Checkpoint**: Inherits previous features correctly

15. **Start Dev Server Again**
    - Click "Open in Browser"
    - ✅ **Checkpoint**: Dev server starts on 4001
    - ✅ **Checkpoint**: All previous features present
    - ✅ **Checkpoint**: New navigation visible
    - ✅ **Checkpoint**: No build errors

16. **Create Third PR**
    - Commit with message: "feat: add navigation header"
    - Create PR
    - ✅ **Checkpoint**: New PR created (not update)
    - ✅ **Checkpoint**: PR only contains navigation changes

### Expected Outcomes
- ✅ 3 separate PRs created successfully
- ✅ Dev server restarts work correctly
- ✅ No port conflicts
- ✅ No Tailwind CSS errors
- ✅ Session state management works
- ✅ All features work together

### Current Known Failures
- ❌ Tailwind CSS error on second session
- ❌ Port conflicts after merge
- ❌ Dev server doesn't restart with new code
- ❌ Session state corruption

---

## 🧪 Scenario 2: Continuous Development Flow

### Setup
- Start with merged boilerplate from Scenario 1

### Phase 1: Rapid Task Addition
**Steps:**
1. **Add 5 Tasks Quickly**
   - Task A: "Add footer component"
   - Task B: "Add about page"
   - Task C: "Add contact form"
   - Task D: "Add dark mode toggle"
   - Task E: "Add user profile card"
   - ✅ **Checkpoint**: All tasks queued properly

2. **Monitor AI Processing**
   - ✅ **Checkpoint**: Tasks process sequentially
   - ✅ **Checkpoint**: Each task builds successfully
   - ✅ **Checkpoint**: No file conflicts

3. **Test While AI Works**
   - Open dev server while tasks process
   - ✅ **Checkpoint**: Page updates as features complete
   - ✅ **Checkpoint**: No crashes during updates

4. **Commit All at Once**
   - Wait for all 5 tasks to complete
   - Commit with: "feat: add multiple UI components"
   - ✅ **Checkpoint**: All changes in one commit
   - ✅ **Checkpoint**: Diff shows all 5 features

5. **Create Large PR**
   - Create PR with all changes
   - ✅ **Checkpoint**: PR description lists all features
   - ✅ **Checkpoint**: GitHub shows all file changes

---

## 🧪 Scenario 3: Error Recovery Flow

### Phase 1: Introduce Intentional Errors
**Steps:**
1. **Task with Build Error**
   - Title: "Add a component that uses undefined variable"
   - ✅ **Checkpoint**: AI generates code
   - ✅ **Checkpoint**: Build validation detects error
   - ✅ **Checkpoint**: AI attempts to fix (3 times max)
   - ✅ **Checkpoint**: Task marked as "Blocked" if unfixable

2. **Task with Dependency Issue**
   - Title: "Add chart using recharts library"
   - ✅ **Checkpoint**: AI adds import
   - ✅ **Checkpoint**: Build fails (missing dependency)
   - ✅ **Checkpoint**: AI runs npm install
   - ✅ **Checkpoint**: Build succeeds after install

3. **Task with Tailwind Issue**
   - Title: "Add component with Tailwind v4 classes"
   - ✅ **Checkpoint**: Detects PostCSS error
   - ✅ **Checkpoint**: Updates to @tailwindcss/postcss
   - ✅ **Checkpoint**: Fixes configuration
   - ✅ **Checkpoint**: Component renders correctly

---

## 🧪 Scenario 4: Merge Conflict Resolution

### Setup
- Two browser sessions with same project

### Steps:
1. **Session A: Create Feature**
   - Add task: "Create user dashboard"
   - Commit and create PR
   - ✅ **Checkpoint**: PR created

2. **Session B: Create Conflicting Feature**
   - Add task: "Create admin dashboard" 
   - Modify same files
   - Try to commit
   - ✅ **Checkpoint**: Conflict detected
   - ✅ **Checkpoint**: User prompted to pull

3. **Resolve Conflict**
   - Pull latest changes
   - ✅ **Checkpoint**: Merge conflict shown
   - ✅ **Checkpoint**: AI suggests resolution
   - ✅ **Checkpoint**: Can proceed after resolution

---

## 🧪 Scenario 5: Port Management Stress Test

### Steps:
1. **Start Multiple Projects**
   - Project A: Create and start dev server
   - ✅ **Checkpoint**: Runs on port 4001
   - Project B: Create and start dev server
   - ✅ **Checkpoint**: Runs on port 4002
   - Project C: Create and start dev server
   - ✅ **Checkpoint**: Runs on port 4003

2. **Test Port Persistence**
   - Refresh browser for each project
   - ✅ **Checkpoint**: Each maintains its port
   - Stop Project B
   - ✅ **Checkpoint**: Port 4002 freed
   - Start Project D
   - ✅ **Checkpoint**: Takes port 4002

3. **Test After System Restart**
   - Note all ports
   - Restart Kanbanix server
   - Try to access each project
   - ✅ **Checkpoint**: Ports reassigned correctly
   - ✅ **Checkpoint**: No conflicts

---

## 🧪 Scenario 6: Build Validation Pipeline

### Steps:
1. **Test Quick Fix Path**
   - Create task with missing semicolon
   - ✅ **Checkpoint**: Quick fix applied
   - ✅ **Checkpoint**: No AI call needed

2. **Test AI Fix Path**
   - Create task with complex type error
   - ✅ **Checkpoint**: Quick fix fails
   - ✅ **Checkpoint**: AI generates fix
   - ✅ **Checkpoint**: Fix applied successfully

3. **Test Unfixable Error**
   - Create task with architectural conflict
   - ✅ **Checkpoint**: All fixes attempted
   - ✅ **Checkpoint**: Task marked blocked
   - ✅ **Checkpoint**: Detailed error report shown

---

## 🧪 Scenario 7: Real-World Development Flow

### Complete User Journey:
1. **Monday: Start Project**
   - Create project
   - Add boilerplate
   - Add 2 features
   - Commit and PR
   - Merge
   - ✅ All working

2. **Tuesday: Continue Development**
   - Open from dashboard
   - ✅ Previous work intact
   - Add 3 more features
   - ✅ No Tailwind errors
   - Commit and PR
   - ✅ Builds successfully

3. **Wednesday: Fix Bugs**
   - Receive bug report
   - Add task: "Fix counter reset issue"
   - ✅ AI understands context
   - ✅ Fix works
   - Commit and merge

4. **Thursday: Major Feature**
   - Add task: "Implement user authentication"
   - ✅ Complex feature works
   - ✅ Integrates with existing code
   - ✅ All tests pass

5. **Friday: Deploy Prep**
   - Add task: "Optimize for production"
   - ✅ Build optimization works
   - ✅ No errors in production build
   - Final PR and merge

---

## 📊 Test Metrics to Track

### Per Scenario:
- Total time to complete
- Number of errors encountered
- Number of manual interventions needed
- Build success rate
- Port conflicts count
- Session corruptions

### Success Criteria:
- ✅ 100% of checkpoints pass
- ✅ No manual fixes needed
- ✅ All builds succeed
- ✅ No port conflicts
- ✅ Session state stable

---

## 🐛 Current Bugs to Verify

1. **Tailwind CSS PostCSS Error**
   - Scenario 1, Step 6
   - Should auto-fix in V2

2. **Port Conflict After Merge**
   - Scenario 1, Step 12-15
   - Should clean up properly

3. **Dev Server Not Restarting**
   - Scenario 1, Step 15
   - Should restart with new code

4. **Session State Corruption**
   - Scenario 4
   - Should handle gracefully

5. **Build Not Validated**
   - All scenarios
   - Should validate before marking complete

---

## 📝 Test Report Template

```markdown
## Test Run: [Date]
Tester: [Name]
Version: [Git Hash]

### Scenario 1: Complete Project Lifecycle
- [ ] Phase 1: ✅/❌ (X/15 checkpoints)
- [ ] Phase 2: ✅/❌ (X/11 checkpoints)
- [ ] Phase 3: ✅/❌ (X/7 checkpoints)
- Issues: [List any failures]

### Scenario 2: Continuous Development
- [ ] Completed: ✅/❌
- Issues: [...]

### Notes:
[Any observations or unexpected behavior]

### Blockers:
[Any tests that couldn't be completed]
```

---

## 🔄 Regression Test Checklist

After any code change, verify:
- [ ] Scenario 1 still passes
- [ ] No new port conflicts
- [ ] Tailwind CSS works
- [ ] Build validation runs
- [ ] Session management works
- [ ] PR creation works
- [ ] Dev server management works