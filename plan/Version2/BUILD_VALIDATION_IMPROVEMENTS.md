# Build Validation Improvements - Micro-agent Inspired Approach

## Current Problems

### 1. Build Validator is Destructive
- **Issue**: The build validator repeatedly "fixes" files, making them worse with each attempt
- **Example**: `src/app/layout.tsx` gets rewritten without imports, then fixed again, creating a cycle
- **Result**: Working code becomes broken after 3 fix attempts

### 2. Lack of Context
- **Issue**: LLM only receives error messages, not the actual file content
- **Result**: LLM generates new files instead of fixing specific issues

### 3. No Loop Detection
- **Issue**: Same errors get "fixed" repeatedly without detecting the pattern
- **Result**: Wasted API calls and degraded code quality

## Micro-agent's Approach

Based on analysis of [BuilderIO/micro-agent](https://github.com/BuilderIO/micro-agent):

### Key Principles
1. **Test-Driven Iteration**: Run tests → Capture failures → Fix → Repeat
2. **Full Context**: Provide complete file content, package.json, and error details
3. **Loop Detection**: Detect when stuck on same error and change strategy
4. **Bounded Iterations**: Maximum attempts to prevent infinite loops
5. **Preserve Working Code**: Keep track of original files

## Proposed Changes

### 1. Enhanced Build Validator (`/mcp-server/src/utils/build-validator.js`)

#### A. Add Original File Tracking
```javascript
class BuildValidator {
  constructor() {
    this.maxAttempts = 3;
    this.originalFiles = {}; // Track original content
  }
}
```

**Why**: Ability to restore files if fixes make things worse

#### B. Implement Loop Detection
```javascript
async validateAndFix(projectPath, taskDescription, apiKey) {
  let lastBuildError = null;
  let stuckCount = 0;
  
  // ... existing code ...
  
  // Check if we're stuck
  const currentError = this.extractMainError(buildResult.output);
  if (currentError === lastBuildError) {
    stuckCount++;
    if (stuckCount >= 2) {
      console.log('[Build Validator] Stuck on same error, stopping');
      break;
    }
  } else {
    stuckCount = 0;
  }
  lastBuildError = currentError;
}
```

**Why**: Prevents infinite loops of attempting the same fix

#### C. Gather Full Context (Micro-agent Style)
```javascript
async gatherFullContext(projectPath, buildError, taskDescription) {
  const context = {
    // Package.json for dependency info
    packageJson: await this.readPackageJson(projectPath),
    
    // Project structure
    projectStructure: await this.detectProjectStructure(projectPath),
    
    // All files mentioned in errors
    errorFiles: {},
    
    // Task that was being implemented
    taskDescription,
    
    // Clean build output
    buildError: this.cleanBuildOutput(buildError)
  };
  
  // Read all files mentioned in errors
  const filesInError = this.extractFilesFromError(buildError);
  for (const file of filesInError) {
    context.errorFiles[file] = await this.readFileContent(projectPath, file);
  }
  
  return context;
}
```

**Why**: LLM needs to see actual code to make targeted fixes

#### D. Structured Prompt (XML-style like Micro-agent)
```javascript
createFixPrompt(context, buildError) {
  return `Fix build errors in this ${context.projectStructure.framework} project.

<package-json>
${JSON.stringify(context.packageJson, null, 2)}
</package-json>

<task-implemented>
${context.taskDescription}
</task-implemented>

<build-errors>
${context.buildError}
</build-errors>

<files-with-errors>
${Object.entries(context.errorFiles).map(([path, content]) => `
<file path="${path}">
${content}
</file>
`).join('\n')}
</files-with-errors>

Instructions:
1. Fix ONLY the build errors mentioned above
2. Maintain existing code style and structure
3. Do NOT refactor or improve unrelated code
4. Preserve all existing functionality
5. Add missing imports at the top of files
6. Ensure 'use client' directives are preserved

Return ONLY files that need changes in this JSON format:
{
  "files": [
    {
      "path": "src/app/layout.tsx",
      "content": "// Complete fixed file content here"
    }
  ],
  "summary": "Brief description of fixes applied"
}`;
}
```

**Why**: Clear structure helps LLM understand context and requirements

#### E. Restore on Failure
```javascript
async validateAndFix(projectPath, taskDescription, apiKey) {
  const originalFiles = {};
  
  try {
    // ... validation attempts ...
    
    if (!buildResult.success && attempts === this.maxAttempts) {
      // Restore original files
      console.log('[Build Validator] Restoring original files after failed fixes');
      await this.restoreOriginalFiles(projectPath, originalFiles);
    }
  } catch (error) {
    // Always restore on error
    await this.restoreOriginalFiles(projectPath, originalFiles);
    throw error;
  }
}

async restoreOriginalFiles(projectPath, originalFiles) {
  for (const [filePath, content] of Object.entries(originalFiles)) {
    if (content !== null) {
      await fs.writeFile(path.join(projectPath, filePath), content, 'utf-8');
    }
  }
}
```

**Why**: Ensures we don't leave the project in a broken state

### 2. Smarter Error Extraction

#### A. Extract Specific Errors (Not Full Output)
```javascript
extractMainError(buildOutput) {
  // Priority 1: Missing imports
  const importError = buildOutput.match(/Cannot find module '([^']+)'|Cannot find name '([^']+)'/);
  if (importError) {
    return {
      type: 'missing_import',
      module: importError[1] || importError[2],
      file: this.extractFileFromError(buildOutput)
    };
  }
  
  // Priority 2: Syntax errors
  const syntaxError = buildOutput.match(/SyntaxError: (.+?) at (.+?):(\d+):(\d+)/);
  if (syntaxError) {
    return {
      type: 'syntax',
      message: syntaxError[1],
      file: syntaxError[2],
      line: syntaxError[3],
      column: syntaxError[4]
    };
  }
  
  // Priority 3: Type errors
  const typeError = buildOutput.match(/Type error: (.+)/);
  if (typeError) {
    return {
      type: 'type_error',
      message: typeError[1],
      file: this.extractFileFromError(buildOutput)
    };
  }
  
  return null;
}
```

**Why**: Targeted fixes are more likely to succeed

### 3. Add Debug Mode (Micro-agent Feature)

#### A. When Stuck, Add Logging
```javascript
async addDebugLogs(projectPath, error, apiKey) {
  console.log('[Build Validator] Adding debug logs to diagnose issue');
  
  const prompt = `Add console.log statements to help debug this error:
Error: ${JSON.stringify(error)}

File: ${error.file}
${await fs.readFile(path.join(projectPath, error.file), 'utf-8')}

Add minimal logging to understand why this error occurs.
Return the file with debug logs added.`;
  
  // Get file with logs from LLM
  const withLogs = await this.callLLM(prompt, apiKey);
  
  // Apply and run build again to get more info
  await fs.writeFile(path.join(projectPath, error.file), withLogs);
}
```

**Why**: Sometimes we need more information to fix an issue

### 4. Task Progression Updates

#### A. Always Progress Task (But with Status)
```javascript
// In /client/src/lib/services/aiAgentService.ts

// After build validation
const taskStatus = {
  status: 'inReview',  // Always move forward
  buildStatus: buildValidationResult.success ? 'passed' : 'needs_attention',
  buildAttempts: buildValidationResult.attempts,
  buildErrors: buildValidationResult.errors
};

await this.updateTaskStatus(task.id, taskStatus);
```

**Why**: Don't block workflow, but maintain visibility

#### B. Visual Indicators in UI
```jsx
// In /client/src/components/workspace/task-card.tsx

{task.buildStatus === 'needs_attention' && (
  <Badge variant="warning" className="mt-2">
    ⚠️ Build: {task.buildAttempts}/3 attempts
  </Badge>
)}
```

**Why**: Developers can see which tasks need manual review

### 5. Configuration Options

#### A. Environment Variables
```bash
# .env
BUILD_VALIDATION_MODE=smart  # smart | strict | skip
BUILD_VALIDATION_MAX_ATTEMPTS=3
BUILD_VALIDATION_RESTORE_ON_FAIL=true
BUILD_VALIDATION_DEBUG_MODE=false
```

#### B. Runtime Options
```javascript
const buildValidator = new BuildValidator({
  maxAttempts: process.env.BUILD_VALIDATION_MAX_ATTEMPTS || 3,
  restoreOnFail: process.env.BUILD_VALIDATION_RESTORE_ON_FAIL !== 'false',
  debugMode: process.env.BUILD_VALIDATION_DEBUG_MODE === 'true'
});
```

## Implementation Priority

1. **Phase 1 - Critical Fixes** (Prevent Code Destruction)
   - [ ] Add original file tracking
   - [ ] Implement restore on failure
   - [ ] Fix file content reading in prompts

2. **Phase 2 - Smart Validation** (Micro-agent Features)
   - [ ] Add loop detection
   - [ ] Implement structured prompts with full context
   - [ ] Extract specific errors for targeted fixes

3. **Phase 3 - Enhanced Features**
   - [ ] Add debug logging mode
   - [ ] Implement configuration options
   - [ ] Add visual indicators in UI

## Testing Strategy

### Test Cases
1. **Missing Import**: Ensure it adds `import React from 'react'`
2. **Syntax Error**: Fix without rewriting entire file
3. **Type Error**: Add proper types without breaking functionality
4. **Loop Detection**: Stop after detecting same error twice
5. **Restore on Fail**: Verify original files are restored after max attempts

### Success Metrics
- Build validation success rate > 80%
- No code destruction (0 cases of working code becoming broken)
- Average fix attempts < 2
- Task progression rate = 100% (even with build failures)

## Migration Path

1. **Backup Current Implementation**
   ```bash
   cp build-validator.js build-validator.backup.js
   ```

2. **Implement Changes Incrementally**
   - Start with Phase 1 (critical fixes)
   - Test on sample projects
   - Roll out Phase 2 and 3

3. **Monitor and Adjust**
   - Track build validation metrics
   - Adjust prompts based on success rates
   - Fine-tune loop detection threshold

## References

- [Micro-agent Source](https://github.com/BuilderIO/micro-agent)
- [Micro-agent Run Logic](https://github.com/BuilderIO/micro-agent/blob/main/src/helpers/run.ts)
- [Micro-agent Generate Logic](https://github.com/BuilderIO/micro-agent/blob/main/src/helpers/generate.ts)

## Notes

The key insight from micro-agent is that **iteration with full context** is more effective than blind fixes. By providing complete file content and detecting loops, we can achieve reliable build validation without destroying working code.