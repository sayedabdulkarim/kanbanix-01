# Kanbanix V2 Testing Scenarios

## Test Environment Setup

### Prerequisites
```bash
# Clean test environment
1. Fresh database (SQLite)
2. Clean projects/ directory
3. No running dev servers
4. GitHub test repository
5. Valid GitHub token
```

### Test Accounts
- Primary: Main developer account
- Secondary: Collaborator account
- Bot: GitHub App for webhooks

---

## Scenario 1: Basic Project Lifecycle

### Test Case 1.1: New Project → Single Task → PR → Merge
**Steps**:
1. Create new project "test-basic"
2. Add task: "Create a Next.js boilerplate"
3. Wait for AI completion
4. Verify build succeeds
5. Commit changes
6. Create PR
7. Merge PR
8. Verify session reset

**Expected Results**:
- ✅ Project builds without errors
- ✅ Dev server runs on port 4001
- ✅ Task moves to "In Review"
- ✅ PR created successfully
- ✅ After merge: Task in "Done", new session created

**Current Issues**:
- ❌ Build validation not running
- ❌ Tailwind CSS errors on second session

---

## Scenario 2: Multi-Task Workflow

### Test Case 2.1: Sequential Tasks in Same Session
**Steps**:
1. Create project "test-multi"
2. Task 1: "Create boilerplate"
3. Task 2: "Add counter component"
4. Task 3: "Add todo list"
5. Commit all
6. Create single PR
7. Merge

**Expected Results**:
- ✅ All tasks complete
- ✅ Single PR with all changes
- ✅ Build passes with all features

**Current Issues**:
- ❌ Second task may break first task's code
- ❌ No dependency checking

### Test Case 2.2: Multiple PRs in Sequence
**Steps**:
1. Task 1 → Commit → PR → Merge
2. Task 2 → Commit → PR → Merge
3. Task 3 → Commit → PR → Merge

**Expected Results**:
- ✅ Each PR builds independently
- ✅ Session resets after each merge
- ✅ Dev server restarts with new code

**Current Issues**:
- ❌ Dev server doesn't restart
- ❌ Port conflicts on session reset
- ❌ Code not updating after merge

---

## Scenario 3: Error Recovery

### Test Case 3.1: Build Failure Recovery
**Steps**:
1. Create task with intentional error
2. Let AI attempt task
3. Verify build fails
4. Check if AI retries with fixes
5. Verify eventual success or failure

**Expected Results**:
- ✅ Build error detected
- ✅ AI attempts fixes (max 3)
- ✅ Task not marked complete if build fails
- ✅ User notified of issues

**Not Implemented**:
- ❌ No build validation
- ❌ No retry mechanism
- ❌ No user notification

### Test Case 3.2: Tailwind Configuration Issues
**Steps**:
1. Create Next.js 15.5 project
2. Add Tailwind-dependent component
3. Check for PostCSS errors
4. Verify auto-fix attempts

**Expected Results**:
- ✅ Detect Tailwind v4 requirement
- ✅ Auto-install @tailwindcss/postcss
- ✅ Update configuration files
- ✅ Build succeeds after fixes

**Current State**:
- ❌ No detection
- ❌ No auto-fix
- ❌ Manual intervention required

---

## Scenario 4: Session Management

### Test Case 4.1: Clean Session Reset
**Steps**:
1. Complete tasks with uncommitted changes
2. Merge PR
3. Verify session reset
4. Check workspace state
5. Verify branch switching

**Expected**:
- ✅ Old session marked inactive
- ✅ New session created
- ✅ Clean workspace
- ✅ Correct branch

### Test Case 4.2: Interrupted Session Recovery
**Steps**:
1. Start task
2. Kill server/browser
3. Restart application
4. Resume work

**Expected**:
- ✅ Session state preserved
- ✅ Can continue from last point
- ✅ No duplicate sessions

### Test Case 4.3: End Session Button
**Steps**:
1. Click "End Session"
2. Verify cleanup
3. Check no dev servers running
4. Verify can start fresh

**Expected**:
- ✅ All processes killed
- ✅ Workspace deleted
- ✅ Tasks reset to TODO
- ✅ Clean restart possible

---

## Scenario 5: Concurrent Operations

### Test Case 5.1: Multiple Browser Tabs
**Steps**:
1. Open project in Tab A
2. Open same project in Tab B
3. Make changes in both
4. Test synchronization

**Expected**:
- ✅ Changes synchronized
- ✅ No conflicts
- ✅ Single dev server

### Test Case 5.2: Multiple Projects
**Steps**:
1. Create Project A
2. Create Project B
3. Work on both simultaneously
4. Verify isolation

**Expected**:
- ✅ Separate workspaces
- ✅ Different ports (4001, 4002)
- ✅ Independent sessions
- ✅ No interference

---

## Scenario 6: Build Validation Tests

### Test Case 6.1: TypeScript Errors
**Input**: Component with type errors
**Expected**: 
- Detect TS errors
- Attempt fixes
- Validate fix correctness

### Test Case 6.2: Missing Dependencies
**Input**: Code using uninstalled package
**Expected**:
- Detect missing package
- Auto-install dependency
- Update package.json

### Test Case 6.3: CSS/Tailwind Issues
**Input**: Invalid Tailwind classes
**Expected**:
- Detect CSS issues
- Fix or report
- Ensure styles work

### Test Case 6.4: Import Path Errors
**Input**: Wrong import paths
**Expected**:
- Detect import errors
- Fix paths
- Verify resolution

---

## Scenario 7: Performance Tests

### Test Case 7.1: Large File Generation
**Steps**:
1. Generate 50+ components
2. Measure build time
3. Check memory usage

**Limits**:
- Build < 60 seconds
- Memory < 2GB
- No crashes

### Test Case 7.2: Rapid Task Creation
**Steps**:
1. Create 10 tasks quickly
2. Check queue handling
3. Verify completion order

**Expected**:
- Proper queueing
- No race conditions
- Correct execution order

---

## Scenario 8: Edge Cases

### Test Case 8.1: Empty Task Description
**Input**: Task with no description
**Expected**: AI infers from title

### Test Case 8.2: Conflicting Requirements
**Input**: "Create React app with Vue components"
**Expected**: AI clarifies or chooses framework

### Test Case 8.3: Malformed Code from AI
**Input**: AI returns invalid syntax
**Expected**: Validation catches, retry triggered

### Test Case 8.4: GitHub API Rate Limits
**Simulate**: Exhaust API limits
**Expected**: Graceful degradation, queue requests

### Test Case 8.5: Network Interruption
**Simulate**: Disconnect during operation
**Expected**: Recovery on reconnection

---

## Scenario 9: Regression Tests

### Test Case 9.1: Previous Bug Fixes
- Port conflict resolution
- Session state corruption
- WebSocket disconnection
- PR merge automation

### Test Case 9.2: Feature Compatibility
- All Phase 1-4 features work
- No feature breaks another
- Backward compatibility

---

## Scenario 10: User Experience Tests

### Test Case 10.1: Error Messaging
**Test**: Trigger various errors
**Verify**:
- Clear error messages
- Actionable suggestions
- Toast notifications work

### Test Case 10.2: Loading States
**Test**: Slow operations
**Verify**:
- Loading indicators
- Progress updates
- No UI freezing

### Test Case 10.3: Real-time Updates
**Test**: Task status changes
**Verify**:
- Immediate UI updates
- Smooth transitions
- No flickering

---

## Automated Test Suite

### Unit Tests
```javascript
describe('BuildValidator', () => {
  test('detects build errors');
  test('applies quick fixes');
  test('retries with AI fixes');
  test('respects max attempts');
});

describe('TailwindVersionDetector', () => {
  test('detects Next.js version');
  test('identifies config format');
  test('generates correct fixes');
});
```

### Integration Tests
```javascript
describe('Task Completion Flow', () => {
  test('AI → Validation → Commit');
  test('Build fail → Retry → Success');
  test('PR merge → Session reset');
});
```

### E2E Tests (Playwright/Cypress)
```javascript
test('Complete project workflow', async () => {
  // Create project
  // Add tasks
  // Verify builds
  // Commit and PR
  // Merge and reset
});
```

---

## Test Execution Plan

### Daily Tests (CI/CD)
1. Unit tests (5 min)
2. Integration tests (10 min)
3. Basic E2E (15 min)

### Weekly Tests
1. Full E2E suite (2 hours)
2. Performance tests (1 hour)
3. Edge cases (1 hour)

### Release Tests
1. All scenarios (4 hours)
2. Load testing (2 hours)
3. Security testing (1 hour)
4. Accessibility testing (30 min)

---

## Test Data Management

### Setup Scripts
```bash
# Reset test environment
./scripts/reset-test-env.sh

# Create test data
./scripts/create-test-data.sh

# Run specific scenario
./scripts/run-scenario.sh --scenario=2.1
```

### Test Projects
- `test-basic-*`: Simple projects
- `test-complex-*`: Multi-feature
- `test-error-*`: Error scenarios
- `test-perf-*`: Performance tests

---

## Success Criteria

### Coverage Requirements
- Unit test coverage: > 80%
- Integration coverage: > 70%
- E2E coverage: Critical paths 100%

### Performance Metrics
- Build validation: < 30s
- Task completion: < 2 min
- PR creation: < 10s
- Session reset: < 5s

### Reliability Metrics
- Build success rate: > 95%
- Auto-fix success: > 90%
- Zero data loss
- Zero port conflicts

---

## Known Issues to Test After Fixes

1. **Tailwind CSS v4 Compatibility**
   - Current: Fails with Next.js 15.5
   - After Fix: Auto-detects and fixes

2. **Build Validation**
   - Current: Not implemented
   - After Fix: Validates before complete

3. **Dev Server Management**
   - Current: Port conflicts
   - After Fix: Clean restart

4. **Session State**
   - Current: Can corrupt
   - After Fix: Self-healing

5. **Error Recovery**
   - Current: No retry
   - After Fix: 3 attempts with fixes

---

## Test Report Template

```markdown
## Test Execution Report
Date: [DATE]
Version: [VERSION]
Tester: [NAME]

### Summary
- Total Tests: X
- Passed: X
- Failed: X
- Skipped: X

### Failed Tests
1. [Test ID]: [Description]
   - Expected: [...]
   - Actual: [...]
   - Impact: [HIGH/MEDIUM/LOW]

### Recommendations
- [...]

### Sign-off
- [ ] Dev Lead
- [ ] QA Lead
- [ ] Product Owner
```