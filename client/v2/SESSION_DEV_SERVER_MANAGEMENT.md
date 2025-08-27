# Session-Based Dev Server Management

## Implementation Summary

### Problem
When multiple tasks are processed in sequence, the dev server was being restarted for each task, causing:
1. Port conflicts when trying to start new servers
2. .next folder corruption when multiple processes try to write simultaneously
3. Unnecessary overhead of restarting servers that support hot-reload

### Solution
Implemented session-based dev server management that:
1. Starts dev server only once per session
2. Reuses the same dev server for all subsequent tasks in the session
3. Tracks dev server state in the database SessionState model

### Changes Made

#### 1. Database Schema Update
Added fields to `SessionState` model in `prisma/schema.prisma`:
```prisma
devServerStarted  Boolean  @default(false) // Whether dev server was started in this session
devServerPort     Int?     // Port number of the running dev server
devServerUrl      String?  // URL of the running dev server
```

#### 2. Dev Server Route Enhancement (`/api/workspace/dev-server/route.ts`)
- Check SessionState for existing dev server before starting new one
- If `devServerStarted` is true and server is still running, return existing server info
- Update SessionState when dev server is started successfully
- Clear SessionState dev server info when server is stopped

#### 3. Session Management
- Dev server info persists across tasks in the same session
- When session ends (`/api/workspace/end-session`), dev server is stopped
- Hot Module Replacement (HMR) ensures code changes are reflected without restart

### Benefits
1. **Performance**: Faster task processing as dev server doesn't restart
2. **Stability**: Prevents .next folder corruption from concurrent builds
3. **Resource Efficiency**: Single dev server instance per project session
4. **Better UX**: Continuous dev server availability throughout session

### How It Works
1. First task in session starts dev server (port 4000+)
2. SessionState records: `devServerStarted=true`, port, and URL
3. Subsequent tasks check SessionState first
4. If dev server already started, reuse existing instance
5. HMR automatically reflects new code changes
6. Session end stops dev server and clears state

### Testing
To test the implementation:
1. Move first task to "In Progress" - dev server starts
2. Move second task to "In Progress" - reuses same dev server
3. Move third task to "In Progress" - should still reuse same dev server
4. End session - dev server stops and state is cleared

### Notes
- Dev servers support hot-reload (Next.js, Vite, etc.)
- Each project gets its own unique port starting from 4000
- Avoids common development ports (3000, 5173, 8080, etc.)
- Works with any Node.js-based framework