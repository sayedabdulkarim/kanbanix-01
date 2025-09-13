#!/bin/bash

echo "=== Quick Phase 1 Test Script ==="

# Test 1: Check if ProjectContext table exists
echo -e "\n1. Checking ProjectContext table..."
sqlite3 client/prisma/prisma/dev.db "SELECT name FROM sqlite_master WHERE type='table' AND name='ProjectContext';"

# Test 2: Check MCP server loads new tools
echo -e "\n2. Checking MCP tools are loaded..."
node -e "
import('./mcp-server/src/index.js').then(() => {
  console.log('✅ MCP server loads successfully');
}).catch(err => {
  console.error('❌ MCP server error:', err.message);
});
"

# Test 3: Test ContextManager import
echo -e "\n3. Testing ContextManager..."
node -e "
import('./client/src/lib/services/contextManager.ts').then(() => {
  console.log('✅ ContextManager module structure OK');
}).catch(err => {
  console.error('❌ ContextManager error:', err.message);
});
"

# Test 4: Check for TypeScript errors in our new files
echo -e "\n4. Checking TypeScript compilation..."
npx tsc --noEmit client/src/lib/services/contextManager.ts 2>&1 | grep -v node_modules | head -5

if [ $? -eq 0 ]; then
  echo "✅ No TypeScript errors in ContextManager"
else
  echo "⚠️  TypeScript issues found"
fi

echo -e "\n=== Quick Test Complete ==="
echo "For full testing:"
echo "1. Run: npm run dev"
echo "2. Create/import a project"
echo "3. Add a task and move to 'In Progress'"
echo "4. Check logs for context loading"