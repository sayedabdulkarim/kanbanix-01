/**
 * Test tools to verify MCP server communication
 */

export const testTools = [
  {
    name: 'test_mcp_connection',
    description: 'Test if MCP server is working and can communicate',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Optional test message',
        },
      },
    },
    handler: async ({ message }) => {
      const timestamp = new Date().toISOString();
      
      return {
        success: true,
        message: 'MCP Server is working correctly!',
        details: {
          timestamp,
          mode: process.env.MCP_MODE || 'unknown',
          nodeEnv: process.env.NODE_ENV || 'unknown',
          receivedMessage: message || 'No message provided',
          serverInfo: {
            name: 'kanbanix-mcp',
            version: '1.0.0',
            pid: process.pid,
            platform: process.platform,
            nodeVersion: process.version,
          },
        },
      };
    },
  },
  
  {
    name: 'test_intent_analysis',
    description: 'Test intent analysis for task interpretation',
    inputSchema: {
      type: 'object',
      properties: {
        task_title: {
          type: 'string',
          description: 'Task title to analyze',
        },
        task_description: {
          type: 'string',
          description: 'Optional task description',
        },
      },
      required: ['task_title'],
    },
    handler: async ({ task_title, task_description }) => {
      // Simple rule-based intent detection for testing
      const combined = (task_title + ' ' + (task_description || '')).toLowerCase();
      
      const newProjectKeywords = [
        'create boilerplate',
        'new project',
        'initialize project',
        'starter template',
        'create app',
        'setup project',
      ];
      
      const featureKeywords = [
        'add button',
        'create component',
        'implement feature',
        'update',
        'fix',
        'modify',
      ];
      
      let intent = 'UNCLEAR';
      let confidence = 0.5;
      let reasoning = '';
      
      // Check for new project intent
      const hasNewProjectKeyword = newProjectKeywords.some(keyword => 
        combined.includes(keyword)
      );
      
      // Check for feature intent
      const hasFeatureKeyword = featureKeywords.some(keyword => 
        combined.includes(keyword)
      );
      
      if (hasNewProjectKeyword && !hasFeatureKeyword) {
        intent = 'NEW_PROJECT';
        confidence = 0.9;
        reasoning = 'Task contains new project keywords';
      } else if (hasFeatureKeyword && !hasNewProjectKeyword) {
        intent = 'FEATURE';
        confidence = 0.9;
        reasoning = 'Task contains feature/component keywords';
      } else if (!hasNewProjectKeyword && !hasFeatureKeyword) {
        // Check for implicit patterns
        if (combined.includes('boilerplate') || combined.includes('initialize')) {
          intent = 'NEW_PROJECT';
          confidence = 0.7;
          reasoning = 'Task seems to request project initialization';
        } else if (combined.includes('add') || combined.includes('create')) {
          intent = 'FEATURE';
          confidence = 0.6;
          reasoning = 'Task seems to request adding functionality';
        }
      }
      
      return {
        analysis: {
          taskTitle: task_title,
          taskDescription: task_description || 'None provided',
          intent,
          confidence,
          reasoning,
          suggestedAction: intent === 'NEW_PROJECT' ? 
            'create_nextjs_app' : 
            intent === 'FEATURE' ? 
            'add_to_existing' : 
            'ask_for_clarification',
        },
        testInfo: {
          message: 'This is a test implementation. Production would use Claude/Anthropic API',
          timestamp: new Date().toISOString(),
        },
      };
    },
  },
];

export default testTools;