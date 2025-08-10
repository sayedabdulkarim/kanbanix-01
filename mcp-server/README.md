# Kanbanix MCP Server

Model Context Protocol (MCP) server for Kanbanix AI task automation.

## Two Usage Modes

### 1. Desktop Mode (for testing)
- **Free** - No API costs
- Test individual MCP tools in Claude Desktop
- Interactive development and debugging

### 2. API Mode (for production)
- Uses Anthropic Claude API
- Programmatic execution via Next.js
- Full task automation

## Quick Start

### Testing with Claude Desktop (Recommended First)

1. **Start MCP server in desktop mode:**
   ```bash
   cd mcp-server
   npm run dev
   ```

2. **Add to Claude Desktop config:**
   - Copy `claude_desktop_config.json` content
   - Paste into your Claude Desktop MCP settings
   - Restart Claude Desktop

3. **Test in Claude Desktop:**
   ```
   Can you list the available MCP tools?
   Can you read the file client/src/app/page.tsx?
   Can you get git status?
   ```

### Production with API

1. **Start MCP server in API mode:**
   ```bash
   cd mcp-server
   npm run start:api
   ```

2. **Use from Next.js:**
   ```javascript
   // Will connect to MCP server and use Claude API
   const result = await mcpClient.executeTask('Add dark mode toggle');
   ```

## Available Tools

### File Operations
- `read_file` - Read file contents
- `write_file` - Write to files
- `list_files` - List directory contents
- `search_files` - Search for text in files
- `file_exists` - Check if file exists
- `create_directory` - Create directories

### Git Operations
- `git_status` - Get git status
- `git_diff` - Show diffs
- `git_add` - Stage files
- `git_commit` - Create commits
- `git_branch` - Manage branches
- `git_log` - View history
- `git_reset` - Unstage files

### Code Analysis
- `analyze_code_structure` - Project structure analysis
- `find_todos` - Find TODO/FIXME comments
- `analyze_imports` - Import analysis
- `find_function` - Find function definitions
- `count_lines` - Count lines of code

### Project Specific
- `analyze_task` - Suggest implementation approach
- `get_project_context` - Get project info
- `suggest_tasks` - AI-powered task suggestions
- `generate_commit_message` - Generate commit messages
- `run_command` - Execute safe commands

### API Mode Only
- `execute_task_api` - Full task execution with Claude
- `get_mcp_info` - Configuration information

## Scripts

```bash
# Desktop mode (no API costs)
npm run dev              # Start with file watching
npm run start:desktop    # Start without watching

# API mode (uses Anthropic API)
npm run dev:api          # Start API mode with watching
npm run start:api        # Start API mode without watching

# Utilities
npm run info            # Show current configuration
npm run test            # Run tests
```

## Environment Variables

Create `.env.desktop` or `.env.api` or set directly:

```bash
# Mode selection
MCP_MODE=desktop  # or 'api'

# API mode only
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-3-opus-20240229
CLAUDE_MAX_TOKENS=4096
CLAUDE_TEMPERATURE=0.7

# Server settings
MCP_TIMEOUT=120000
NODE_ENV=development
```

## Development Workflow

1. **Develop & Test with Desktop Mode:**
   ```bash
   npm run dev
   # Test tools in Claude Desktop
   ```

2. **Switch to API Mode for Integration:**
   ```bash
   npm run dev:api
   # Connect from Next.js API routes
   ```

3. **Deploy:**
   ```bash
   MCP_MODE=api npm start
   ```

## File Structure

```
mcp-server/
├── src/
│   ├── index.js           # Main MCP server
│   ├── config.js          # Configuration management
│   ├── claude-service.js  # Claude API integration
│   └── tools/
│       ├── file-tools.js      # File operations
│       ├── git-tools.js       # Git operations
│       ├── code-tools.js      # Code analysis
│       ├── project-tools.js   # Kanbanix-specific tools
│       └── api-tools.js       # API mode tools
├── .env.desktop          # Desktop mode config
├── .env.api             # API mode config
├── claude_desktop_config.json
└── package.json
```

## Security

- File operations restricted to project directory
- Safe command whitelist
- Rate limiting in production
- Input validation on all tools

## Troubleshooting

**MCP server not starting:**
```bash
npm run info  # Check configuration
```

**Claude Desktop not seeing tools:**
- Check `claude_desktop_config.json` path
- Restart Claude Desktop
- Check MCP server is running

**API mode not working:**
- Verify `ANTHROPIC_API_KEY` is set
- Check `MCP_MODE=api`
- Ensure MCP server is running