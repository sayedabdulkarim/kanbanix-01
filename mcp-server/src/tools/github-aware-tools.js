import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const githubAwareTools = [
  {
    name: 'analyze_and_generate',
    description: 'Analyze existing project and generate/update code accordingly',
    inputSchema: {
      type: 'object',
      properties: {
        task_title: {
          type: 'string',
          description: 'Task title',
        },
        task_description: {
          type: 'string',
          description: 'Task description',
        },
        context: {
          type: 'object',
          description: 'Task context including GitHub info',
        },
        operation: {
          type: 'string',
          description: 'Operation type (add_screen, update_existing, etc.)',
        },
      },
      required: ['task_title', 'context'],
    },
    handler: async ({ task_title, task_description, context, operation }) => {
      try {
        const projectPath = context.projectPath || path.resolve(process.cwd(), '..');
        
        // Analyze existing project structure
        const projectAnalysis = await analyzeProject(projectPath);
        
        // Based on operation type, generate appropriate code
        let result;
        switch (operation) {
          case 'add_screen':
            result = await addScreen(projectPath, task_title, task_description, projectAnalysis);
            break;
          case 'add_component':
            result = await addComponent(projectPath, task_title, task_description, projectAnalysis);
            break;
          case 'update_existing':
            result = await updateExisting(projectPath, task_title, task_description, projectAnalysis);
            break;
          default:
            result = await generateGeneric(projectPath, task_title, task_description, projectAnalysis);
        }
        
        return JSON.stringify(result, null, 2);
      } catch (error) {
        console.error('Error in analyze_and_generate:', error);
        return JSON.stringify({
          success: false,
          error: error.message,
          changes: []
        }, null, 2);
      }
    },
  },
];

// Analyze project structure
async function analyzeProject(projectPath) {
  const analysis = {
    framework: null,
    hasTypeScript: false,
    directories: {},
    existingFiles: [],
    patterns: {}
  };
  
  try {
    // Check package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    // Detect framework
    if (deps['next']) {
      analysis.framework = 'nextjs';
      analysis.directories.pages = await findDirectory(projectPath, ['app', 'pages', 'src/app']);
      analysis.directories.components = await findDirectory(projectPath, ['components', 'src/components']);
    } else if (deps['react']) {
      analysis.framework = 'react';
      analysis.directories.components = await findDirectory(projectPath, ['src/components', 'components']);
      analysis.directories.pages = await findDirectory(projectPath, ['src/pages', 'src/screens']);
    }
    
    // Check for TypeScript
    analysis.hasTypeScript = !!deps['typescript'];
    
    // Get existing files in relevant directories
    if (analysis.directories.components) {
      const componentsPath = path.join(projectPath, analysis.directories.components);
      try {
        analysis.existingFiles = await fs.readdir(componentsPath);
      } catch {}
    }
    
  } catch (error) {
    console.error('Error analyzing project:', error);
  }
  
  return analysis;
}

// Add a new screen/page
async function addScreen(projectPath, title, description, projectAnalysis) {
  const screenName = extractScreenName(title, description);
  const changes = [];
  
  if (projectAnalysis.framework === 'nextjs') {
    // For Next.js with App Router
    const pagesDir = projectAnalysis.directories.pages || 'app';
    const screenPath = path.join(pagesDir, screenName.toLowerCase());
    const pagePath = path.join(screenPath, 'page.tsx');
    
    // Create the page component
    const pageContent = generateNextJsPage(screenName, description);
    
    changes.push({
      path: pagePath,
      type: 'created',
      content: pageContent,
      diff: {
        added: pageContent.split('\n').length,
        removed: 0
      }
    });
    
    // Create a layout if needed
    const layoutPath = path.join(screenPath, 'layout.tsx');
    const layoutContent = generateNextJsLayout(screenName);
    
    changes.push({
      path: layoutPath,
      type: 'created',
      content: layoutContent,
      diff: {
        added: layoutContent.split('\n').length,
        removed: 0
      }
    });
    
  } else if (projectAnalysis.framework === 'react') {
    // For standard React app
    const pagesDir = projectAnalysis.directories.pages || 'src/pages';
    const pagePath = path.join(pagesDir, `${screenName}.tsx`);
    
    const pageContent = generateReactPage(screenName, description);
    
    changes.push({
      path: pagePath,
      type: 'created',
      content: pageContent,
      diff: {
        added: pageContent.split('\n').length,
        removed: 0
      }
    });
  }
  
  return {
    success: true,
    summary: `Created ${screenName} screen with necessary components`,
    changes,
    message: `Added new screen: ${screenName}`,
    nextSteps: [
      `Review the generated ${screenName} screen`,
      'Add routing if needed',
      'Style the components',
      'Add any required API calls'
    ]
  };
}

// Add a new component
async function addComponent(projectPath, title, description, projectAnalysis) {
  const componentName = extractComponentName(title, description);
  const componentsDir = projectAnalysis.directories.components || 'src/components';
  const componentPath = path.join(componentsDir, `${componentName}.tsx`);
  
  // Check if component already exists
  const componentExists = projectAnalysis.existingFiles.includes(`${componentName}.tsx`);
  
  if (componentExists) {
    return {
      success: false,
      summary: `Component ${componentName} already exists`,
      changes: [],
      message: 'Component already exists. Use update operation to modify it.'
    };
  }
  
  const componentContent = generateComponent(componentName, description);
  
  return {
    success: true,
    summary: `Created ${componentName} component`,
    changes: [{
      path: componentPath,
      type: 'created',
      content: componentContent,
      diff: {
        added: componentContent.split('\n').length,
        removed: 0
      }
    }],
    message: `Added new component: ${componentName}`
  };
}

// Update existing file
async function updateExisting(projectPath, title, description, projectAnalysis) {
  // This would require more sophisticated logic to:
  // 1. Find the file to update
  // 2. Parse the existing content
  // 3. Merge changes intelligently
  
  return {
    success: true,
    summary: 'Update operation (placeholder)',
    changes: [],
    message: 'Update operations require more context about which file to modify'
  };
}

// Generic generation
async function generateGeneric(projectPath, title, description, projectAnalysis) {
  return {
    success: true,
    summary: 'Generic generation',
    changes: [],
    message: 'Please be more specific about what to create or update'
  };
}

// Helper functions
async function findDirectory(basePath, candidates) {
  for (const candidate of candidates) {
    try {
      const fullPath = path.join(basePath, candidate);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

function extractScreenName(title, description) {
  // Extract screen name from title like "add profile screen" -> "Profile"
  const match = title.match(/(?:add|create|implement)\s+(\w+)\s+(?:screen|page|view)/i);
  return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1) : 'NewScreen';
}

function extractComponentName(title, description) {
  const match = title.match(/(?:add|create|implement)\s+(\w+)\s+(?:component)/i);
  return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1) : 'NewComponent';
}

// Code generation templates
function generateNextJsPage(screenName, description) {
  return `'use client';

import { useState } from 'react';

export default function ${screenName}Page() {
  const [data, setData] = useState(null);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">${screenName}</h1>
      
      <div className="bg-white rounded-lg shadow-md p-6">
        <p className="text-gray-600">
          ${description || `This is the ${screenName} page.`}
        </p>
        
        {/* Add your ${screenName.toLowerCase()} content here */}
      </div>
    </div>
  );
}`;
}

function generateNextJsLayout(screenName) {
  return `export default function ${screenName}Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="${screenName.toLowerCase()}-layout">
      {children}
    </div>
  );
}`;
}

function generateReactPage(screenName, description) {
  return `import React, { useState, useEffect } from 'react';

interface ${screenName}Props {
  // Add props here
}

const ${screenName}: React.FC<${screenName}Props> = (props) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    // Add initialization logic here
  }, []);

  return (
    <div className="${screenName.toLowerCase()}-container">
      <h1>${screenName}</h1>
      <div className="content">
        <p>${description || `Welcome to ${screenName}`}</p>
        
        {/* Add your ${screenName.toLowerCase()} implementation here */}
      </div>
    </div>
  );
};

export default ${screenName};`;
}

function generateComponent(componentName, description) {
  return `import React from 'react';

interface ${componentName}Props {
  // Add component props here
}

export const ${componentName}: React.FC<${componentName}Props> = (props) => {
  return (
    <div className="${componentName.toLowerCase()}">
      {/* ${description || `${componentName} component implementation`} */}
    </div>
  );
};

export default ${componentName};`;
}