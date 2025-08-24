# Kanbanix V2 Enhancements Plan

## Critical Issues to Fix

### 1. Build Validation Gap (Priority: CRITICAL)
**Problem**: Tasks are marked complete without verifying the code actually builds/runs
**Current State**: 
- BuildValidator exists but is NOT called after AI task completion
- No pre-commit validation
- Results in broken code being merged to main

**Solution**:
```javascript
// After AI completes task:
1. Run BuildValidator.validateAndFix()
2. Only mark task "In Review" if build succeeds
3. If build fails, retry with AI fixes (max 3 attempts)
4. Show build errors to user if all attempts fail
```

**Implementation**:
- Modify `/api/mcp/execute/route.ts` to call BuildValidator
- Add build status to task metadata
- Prevent commit if build fails

### 2. Tailwind CSS Version Incompatibility (Priority: HIGH)
**Problem**: Next.js 15.5.0 requires `@tailwindcss/postcss` but generated projects use old format
**Current State**:
- `create-next-app@latest` generates incompatible PostCSS config
- Second session inherits broken config from main branch

**Solution**:
```javascript
// Auto-detect and fix Tailwind configuration
1. Check Next.js version
2. If >= 15.5.0, update postcss.config.js
3. Install @tailwindcss/postcss if needed
4. Update package.json dependencies
```

**Implementation**:
- Add TailwindVersionDetector (already exists)
- Call before starting dev server
- Add to session initialization

### 3. Dev Server Management Issues (Priority: HIGH)
**Problem**: Dev servers persist after session reset, causing port conflicts
**Current State**:
- Partial fix implemented but not robust
- Memory-based tracking gets out of sync

**Solution**:
```javascript
// Comprehensive dev server cleanup
1. Track PIDs in database (not just memory)
2. Kill by PID, not just port
3. Verify process death before proceeding
4. Clean restart on new session
```

## Feature Enhancements

### 1. Multi-Layer Error Fixing (from SynthAI)
**Components to Add**:
```
QuickFixChecker     - Common error patterns
CSSConfigValidator  - Tailwind/PostCSS issues  
FontFixer          - Font configuration
ConfigFileFixer    - Config file issues
ContextPatternFixer - React context issues
```

**Benefits**:
- Faster error resolution
- Less API calls to Claude
- More reliable builds

### 2. Progressive Build Validation
```
Level 1: Syntax check (fast)
Level 2: Type checking (medium)
Level 3: Build test (slow)
Level 4: Dev server test (slowest)
```

**Implementation**:
- Run progressively based on task complexity
- Cache validation results
- Skip if no code changes

### 3. Intelligent Project Templates
**Current**: Always uses `create-next-app@latest`
**Proposed**: Version-locked templates
```javascript
templates = {
  'next-15.5': { /* Known working config */ },
  'next-14': { /* Stable config */ },
  'next-13': { /* Legacy support */ }
}
```

### 4. Pre-Merge Validation
**Add GitHub Actions workflow**:
```yaml
- Run build test
- Run type check  
- Run tests
- Block merge if fails
```

### 5. Session State Improvements
**Current Issues**:
- Session state can get out of sync
- No recovery mechanism
- Limited error handling

**Enhancements**:
```javascript
// Session state recovery
1. Add health checks
2. Auto-recovery on corruption
3. Session state snapshots
4. Rollback capability
```

## Architecture Improvements

### 1. Separate Build Service
```
client/ 
  ├── services/
  │   ├── build-service.ts      # New
  │   ├── validation-service.ts  # New
  │   └── fix-service.ts        # New
```

**Benefits**:
- Modular validation
- Easier testing
- Reusable components

### 2. Event-Driven Validation
```javascript
// Emit events at key points
events.emit('task:ai-complete', { taskId, files });
events.emit('task:build-start', { taskId });
events.emit('task:build-success', { taskId });
events.emit('task:build-fail', { taskId, errors });
```

### 3. Validation Pipeline
```
AI Complete → Syntax Check → Quick Fixes → Build Test → 
Dev Server Test → Mark Complete
```

## Database Schema Enhancements

### 1. Add Build Tracking
```prisma
model BuildResult {
  id          String   @id
  taskId      String
  success     Boolean
  errors      Json?
  fixes       Json?
  attempts    Int
  duration    Int
  createdAt   DateTime
}
```

### 2. Add Dev Server Tracking
```prisma
model DevServer {
  id          String   @id
  projectId   String
  pid         Int
  port        Int
  status      String
  startedAt   DateTime
  stoppedAt   DateTime?
}
```

## Implementation Priority

### Phase 1: Critical Fixes (Week 1)
1. ✅ Implement build validation after AI tasks
2. ✅ Fix Tailwind CSS compatibility
3. ✅ Improve dev server cleanup

### Phase 2: Core Enhancements (Week 2)
1. Add QuickFixChecker
2. Add progressive validation
3. Add pre-merge validation

### Phase 3: Architecture (Week 3)
1. Separate build service
2. Event-driven validation
3. Database tracking

### Phase 4: Polish (Week 4)
1. Error recovery
2. Performance optimization
3. Testing & documentation

## Success Metrics

1. **Build Success Rate**: Target 95%+ first-time builds
2. **Fix Success Rate**: Target 90%+ auto-fix success
3. **Session Stability**: Zero session corruption
4. **Dev Server Reliability**: Zero port conflicts
5. **User Experience**: < 30s validation time

## Risk Mitigation

1. **Performance Impact**: 
   - Cache validation results
   - Run validation async where possible
   - Progressive validation levels

2. **Breaking Changes**:
   - Version detection before fixes
   - Fallback mechanisms
   - Manual override options

3. **API Rate Limits**:
   - Quick fixes before AI
   - Batch error fixing
   - Local caching

## Testing Requirements

1. Unit tests for each validator
2. Integration tests for pipeline
3. E2E tests for full workflow
4. Load tests for performance
5. Regression tests for fixes

## Documentation Needs

1. Validation pipeline architecture
2. Error pattern catalog
3. Fix strategy guide
4. Troubleshooting guide
5. Performance tuning guide