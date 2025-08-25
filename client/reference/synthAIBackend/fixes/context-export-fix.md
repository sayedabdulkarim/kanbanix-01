# Context Export Fix Analysis

## The Problem from User's Logs

```
Type error: Module '"@/context/TodoContext"' has no exported member 'useTodoContext'.
```

Multiple components are trying to import:
- `useTodoContext` (custom hook)
- `TodoContext` (the context itself)

But these are not being exported from the TodoContext file.

## Root Cause

The LLM is generating Context files that:
1. Sometimes don't export the custom hook
2. Sometimes don't export the context itself
3. Sometimes use different naming patterns

## The Fix

We need to ensure the LLM ALWAYS generates the standard exports. We've already:

1. ✅ Added explicit Context pattern template in task-based-generator.js
2. ✅ Created ContextPatternValidator to check exports
3. ✅ Integrated validation into agent-service

## Additional Fix Needed

The LLM might still generate non-standard patterns. We need to:

1. Add a "Context Pattern Fixer" that automatically fixes common issues
2. Or strengthen the prompts even more

## Quick Fix for Build Validator

The build validator should specifically look for these context import errors and fix them by:
1. Adding missing exports to context files
2. Ensuring the standard pattern is followed