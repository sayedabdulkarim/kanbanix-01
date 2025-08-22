# Kanbanix Version 2 - Implementation Plan

## Overview
This document outlines the implementation plan for Kanbanix Version 2, focusing on improving the git workflow, task management, and user experience.

## Key Changes
- Single session branch approach instead of per-task branches
- New task flow: TODO → IN PROGRESS → IN REVIEW → DONE
- Centralized Commit/PR buttons at board level
- Undo functionality with dependency detection
- Automated PR merge to Done column transition

---

## Implementation Phases

### Phase 1: Fix Current Branch/Diff Issues (Day 1)
1. Stop creating new branch for each task
2. Create single "session" branch when user enters project
3. Keep using same branch for all tasks in that session
4. Auto-commit after each task completes (with task ID in message)
5. Store commit SHA with each task in database

**Commit Message Format:**
```
[Task-{taskId}] {taskTitle}
Example: [Task-cmel0wa0h] Create counter app with increment and decrement button
```

### Phase 2: Update Task Flow & Column Logic (Day 1-2)
1. Change task completion flow: In Progress → In Review (not Done)
2. Task moves to "In Review" when AI completes execution
3. Add "Commit All" and "Create PR" buttons at top (both disabled initially)
4. Show tooltip on disabled buttons: "Please commit changes to raise PR"
5. Remove individual task commit buttons

**New Column Flow:**
- **TODO**: Tasks waiting to be executed
- **IN PROGRESS**: Tasks currently being executed by AI
- **IN REVIEW**: Tasks completed by AI, awaiting commit/PR
- **DONE**: Tasks merged to main branch

### Phase 3: Implement Commit/PR State Management (Day 2)
1. Track if there are uncommitted changes in session
2. Enable "Commit All" button when tasks exist in "In Review"
3. After commit, disable "Commit All" and enable "Create PR"
4. Store commit status in session state
5. Update button states dynamically

**Button States:**
- **Commit All**: Enabled when In Review tasks exist + changes uncommitted
- **Create PR**: Enabled only after commit + no uncommitted changes

### Phase 4: Track File Changes for Dependencies (Day 2-3)
1. When auto-committing, record which files were changed
2. Store file list with task record in database
3. Create simple function to compare file lists between tasks
4. This becomes our dependency detection system

**Dependency Detection:**
- Track files modified by each task
- Compare file lists when undo is requested
- Warn if later tasks modified same files

### Phase 5: Implement Undo Feature with Rules (Day 3)
1. Add "Undo" button only to tasks in "In Review" column
2. No undo button for tasks in "Done" column
3. When undo clicked, check for dependent tasks
4. Show warning if dependencies exist
5. If proceed, git revert and move task to "To Do"
6. Update commit/PR button states accordingly

**Undo Rules:**
- Only available in "In Review" status
- Shows dependency warnings
- Reverts git commit
- Moves task back to "To Do"

### Phase 6: GitHub PR Integration (Day 3-4)
1. When PR created, store PR URL/ID with tasks
2. Set up webhook for PR merge events
3. When PR merged, automatically move all "In Review" tasks to "Done"
4. Clear session branch after successful merge
5. Reset button states for new session

**Automation:**
- Webhook listens for PR merge events
- Auto-transition tasks to Done
- Clean up session branch
- Reset for new session

### Phase 7: Handle Edge Cases (Day 4)
1. If undo performed after commit, require re-commit
2. Disable PR button if uncommitted changes exist
3. Handle multiple undo operations correctly
4. Ensure proper state after PR merge
5. Test partial PR scenarios

**Edge Cases:**
- Undo after commit
- Multiple rapid undos
- Concurrent PR operations
- Failed PR merges
- Session recovery

### Phase 8: Polish UI/UX (Day 4-5)
1. Add loading states for commit/PR operations
2. Show success notifications for state changes
3. Add confirmation dialogs for destructive actions
4. Test complete flow from task → review → commit → PR → done
5. Verify button states update correctly at each step

**UI Improvements:**
- Loading spinners during operations
- Toast notifications for success/error
- Confirmation modals for undo/commit
- Disabled state tooltips
- Progress indicators

---

## Visual Flow

```
TODO → IN PROGRESS → IN REVIEW → DONE
         ↓              ↓          ↑
    (AI executes)  (User commits)  |
                        ↓          |
                   (Create PR)     |
                        ↓          |
                   (PR Merged) ----+
```

## Database Schema Updates

### task_executions table
```sql
ALTER TABLE task_executions ADD COLUMN session_branch VARCHAR(255);
ALTER TABLE task_executions ADD COLUMN commit_sha VARCHAR(40);
ALTER TABLE task_executions ADD COLUMN files_changed JSONB;
ALTER TABLE task_executions ADD COLUMN pr_url VARCHAR(255);
ALTER TABLE task_executions ADD COLUMN pr_number INTEGER;
```

### session_state table (new)
```sql
CREATE TABLE session_state (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  user_id UUID REFERENCES users(id),
  session_branch VARCHAR(255),
  has_uncommitted_changes BOOLEAN DEFAULT false,
  last_commit_sha VARCHAR(40),
  pr_created BOOLEAN DEFAULT false,
  pr_url VARCHAR(255),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## Success Criteria

### Phase 1 Success
- [ ] Single session branch created and maintained
- [ ] Auto-commits working with task IDs
- [ ] Diffs show correct changes per task

### Phase 2 Success
- [ ] Tasks flow to "In Review" after AI completion
- [ ] Commit/PR buttons appear at board level
- [ ] Individual task commit buttons removed

### Phase 3 Success
- [ ] Button states update correctly
- [ ] Commit All works for all In Review tasks
- [ ] PR button enables after commit

### Phase 4 Success
- [ ] File changes tracked per task
- [ ] Dependency detection working
- [ ] Warnings show for conflicting undos

### Phase 5 Success
- [ ] Undo works for In Review tasks only
- [ ] Tasks return to To Do after undo
- [ ] Git reverts applied correctly

### Phase 6 Success
- [ ] PR creation works from UI
- [ ] Webhook receives merge events
- [ ] Tasks auto-transition to Done

### Phase 7 Success
- [ ] All edge cases handled gracefully
- [ ] No data loss scenarios
- [ ] Consistent state management

### Phase 8 Success
- [ ] Smooth user experience
- [ ] Clear feedback on all operations
- [ ] No confusing button states

---

## Timeline

**Total Duration:** 4-5 days

- **Day 1:** Phase 1 (Branch/Diff fixes)
- **Day 1-2:** Phase 2 (Task flow updates)
- **Day 2:** Phase 3 (Commit/PR state)
- **Day 2-3:** Phase 4 (Dependency tracking)
- **Day 3:** Phase 5 (Undo feature)
- **Day 3-4:** Phase 6 (GitHub integration)
- **Day 4:** Phase 7 (Edge cases)
- **Day 4-5:** Phase 8 (Polish)

---

## Risks & Mitigations

### Risk 1: Complex Git Conflicts
**Mitigation:** Use git revert instead of reset, handle conflicts gracefully

### Risk 2: Lost Work from Undo
**Mitigation:** Always create backup commits before operations

### Risk 3: PR Webhook Failures
**Mitigation:** Implement retry logic and manual sync option

### Risk 4: Session State Corruption
**Mitigation:** Add session recovery mechanism

---

## Testing Plan

### Unit Tests
- Dependency detection logic
- Button state management
- Git operations

### Integration Tests
- Full task flow (TODO → DONE)
- Undo with dependencies
- PR creation and merge

### E2E Tests
- Complete user journey
- Multiple task scenarios
- Error recovery flows

---

## Notes

- All auto-commits are internal for tracking only
- User sees simplified Commit All/Create PR flow
- Undo only available before PR merge
- Session branch cleaned up after PR merge
- File-based dependency detection is pragmatic approach