const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs/promises");
const path = require("path");

class TaskBasedGenerator {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.anthropic = new Anthropic({ apiKey: this.apiKey });
    this.maxRetries = 3;
  }

  /**
   * Analyze PRD and create a task list
   */
  async createTaskList(prd) {
    const prompt = `
You are an expert Next.js developer. Analyze this PRD and break it down into specific implementation tasks.

PRD:
${prd}

Create a detailed task list for implementing this project. Each task should be:
- Specific and actionable
- Small enough to implement in one step
- Ordered by dependency (foundational tasks first)

Return ONLY a valid JSON object with this structure:
{
  "tasks": [
    {
      "id": "task-1",
      "name": "Create main layout component",
      "description": "Create the main layout with header and navigation",
      "dependencies": [],
      "files": ["src/app/layout.tsx", "src/components/Header.tsx"],
      "priority": 1
    }
  ]
}

Guidelines:
- Start with layout/structure tasks
- Then core features
- Then UI components
- Include a task to update src/app/page.tsx to import and use the main component
- Finally, polish and optimization
- Each task should generate 1-3 related files
- IMPORTANT: The last task MUST update the root page.tsx to actually use the components
- EXCLUDE: Do NOT create tasks for offline support, service workers, or PWA features
- EXCLUDE: Do NOT create tasks specifically for accessibility features (basic accessibility should be built into components)
- EXCLUDE: Do NOT create separate animation tasks - include basic transitions inline with components using Tailwind classes
`;

    try {
      const response = await this.callLLM(prompt);
      return this.parseJSON(response);
    } catch (error) {
      console.error("Error creating task list:", error);
      throw new Error(`Failed to create task list: ${error.message}`);
    }
  }

  /**
   * Generate code for a specific task
   */
  async generateTaskCode(task, prd, existingFiles = {}) {
    const existingFilesList = Object.keys(existingFiles).join(", ");
    
    const prompt = `
You are an expert Next.js developer. Generate code for this specific task.

TASK: ${task.name}
DESCRIPTION: ${task.description}
FILES TO CREATE/UPDATE: ${task.files.join(", ")}

PROJECT CONTEXT (PRD):
${prd}

EXISTING FILES IN PROJECT:
${existingFilesList || "None yet"}

Generate ONLY the code for the files specified in this task.

STRICT CONSTRAINTS - YOU MUST FOLLOW THESE RULES:

1. TECHNOLOGY STACK (ONLY use these):
   - Next.js 14 with App Router
   - TypeScript
   - React built-in hooks ONLY (useState, useEffect, useCallback, useMemo, useRef, useContext)
   - Tailwind CSS for styling (standard utility classes only)
   
2. FORBIDDEN - DO NOT USE:
   - External state management (NO zustand, redux, mobx, jotai, valtio)
   - External HTTP libraries (NO axios, fetch wrappers - use native fetch)
   - Animation libraries (NO framer-motion, react-spring, lottie)
   - CSS-in-JS libraries (NO styled-components, emotion)
   - Form libraries (NO react-hook-form, formik)
   - Utility libraries (NO lodash, ramda, date-fns)
   - Custom fonts from next/font
   - Any package not explicitly allowed

3. ALLOWED PACKAGES (package.json dependencies):
   - next (^14.0.0)
   - react (^18.0.0)
   - react-dom (^18.0.0)
   - typescript (^5.0.0)
   - @types/react (^18.0.0)
   - @types/react-dom (^18.0.0)
   - @types/node (^20.0.0)
   - tailwindcss (^3.0.0)
   - autoprefixer (^10.0.0)
   - postcss (^8.0.0)
   - eslint (^8.0.0)
   - eslint-config-next (^14.0.0)

4. STATE MANAGEMENT RULES:
   - Use ONLY React useState for component state
   - Use ONLY React Context API for shared state
   - NO external state libraries
   - Keep state simple and local when possible

5. FILE STRUCTURE REQUIREMENTS:
   - ALWAYS include 'use client' directive for client components
   - The 'use client' directive must be the FIRST line (before imports)
   - Every component file needs 'use client' if it has ANY interactivity
   
   CRITICAL 'use client' RULES:
   - ALL files in /src/components/ MUST start with 'use client'
   - ALL files in /src/app/ that have interactivity MUST start with 'use client'
   - Files that MUST have 'use client':
     * Any file using useState, useEffect, useCallback, useMemo, useRef
     * Any file with onClick, onChange, onSubmit handlers
     * Any file using browser APIs (window, document, localStorage)
     * Any file importing other client components
   - Files that should NOT have 'use client':
     * /src/app/layout.tsx (unless it has interactivity)
     * Pure type definition files (.d.ts, types.ts)
     * Utility files with pure functions
     * Config files
   
   The 'use client' directive format MUST be exactly:
   'use client';
   
   (with semicolon, single quotes, on its own line, before ANY other code)

6. REQUIRED FILES (every project MUST have these):
   - /src/app/layout.tsx - Root layout with metadata
   - /src/app/page.tsx - Home page
   - /src/app/globals.css - Tailwind directives only
   - /package.json - ONLY allowed dependencies
   - /tailwind.config.js - Standard config
   - /postcss.config.js - Standard config
   - /next.config.js - Minimal config

7. EXPORT/IMPORT PATTERNS:
   - React Components: "export default function ComponentName()"
   - Custom Hooks: "export function useHookName()"
   - Context: "export const ContextName = createContext()"
   - Types: "export interface" or "export type"
   - NO mixed exports in same file

8. COMPONENT RULES:
   - Maximum 150 lines per component
   - Use semantic HTML
   - Include basic ARIA attributes
   - NO complex patterns (HOCs, render props)
   - NO dynamic imports

9. STYLING RULES:
   - Use ONLY Tailwind utility classes
   - NO inline styles unless absolutely necessary
   - NO CSS modules
   - NO CSS-in-JS
   - Animations: ONLY Tailwind animation classes or CSS keyframes
   
   CRITICAL TAILWIND RULES:
   - NEVER import tailwindcss directly: NO import 'tailwindcss' statements
   - NEVER require tailwindcss in component files
   - Tailwind is configured via postcss.config.js ONLY
   - Use Tailwind ONLY through className attributes
   - The ONLY place for Tailwind directives is globals.css with these three lines:
     @tailwind base;
     @tailwind components;
     @tailwind utilities;
   - NEVER add these directives to component files

10. DO NOT:
    - Generate service workers or PWA features
    - Create complex build configurations
    - Modify postcss.config.js or next.config.js
    - Import CSS files directly in components
    - Use experimental Next.js features

11. COMPONENT TEMPLATES - Use these exact patterns:

For interactive components (with state/handlers):
\`\`\`typescript
'use client';

import { useState } from 'react';

export default function ComponentName() {
  // component logic here
}
\`\`\`

For simple display components:
\`\`\`typescript
'use client';

export default function ComponentName({ prop1, prop2 }: Props) {
  return (
    // JSX here
  );
}
\`\`\`

For app pages with interactivity:
\`\`\`typescript
'use client';

import ComponentName from '@/components/ComponentName';

export default function PageName() {
  // page logic
}
\`\`\`

For Context files (MUST follow this exact pattern):
\`\`\`typescript
'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

// Type definitions
interface ItemType {
  // fields
}

interface [Name]ContextType {
  // state and methods
}

// Create context - MUST export
export const [Name]Context = createContext<[Name]ContextType | undefined>(undefined);

// Custom hook - MUST export with exact naming
export function use[Name]Context() {
  const context = useContext([Name]Context);
  if (!context) {
    throw new Error('use[Name]Context must be used within [Name]Provider');
  }
  return context;
}

// Provider component - MUST export
export function [Name]Provider({ children }: { children: ReactNode }) {
  // state and logic
  
  return (
    <[Name]Context.Provider value={{...}}>
      {children}
    </[Name]Context.Provider>
  );
}
\`\`\`

CRITICAL: When creating a Context (e.g., TodoContext):
- MUST export: TodoContext, useTodoContext, TodoProvider
- Hook MUST be named use[Name]Context (e.g., useTodoContext)
- Provider MUST be named [Name]Provider (e.g., TodoProvider)
- Components importing from context MUST import the exact names

Return ONLY a valid JSON object with this structure:
{
  "files": [
    {
      "path": "src/app/layout.tsx",
      "content": "full file content here",
      "action": "create"
    }
  ],
  "description": "Brief description of what was implemented"
}
`;

    try {
      const response = await this.callLLM(prompt, 8000); // Higher token limit for code
      return this.parseJSON(response);
    } catch (error) {
      console.error(`Error generating code for task ${task.id}:`, error);
      throw new Error(`Failed to generate code for ${task.name}: ${error.message}`);
    }
  }

  /**
   * Execute tasks sequentially with progress tracking
   */
  async executeTasks(tasks, prd, projectPath, onProgress) {
    const results = [];
    const generatedFiles = {};
    
    // Filter out offline support and accessibility-specific tasks
    const filteredTasks = tasks.filter(task => {
      const taskNameLower = task.name.toLowerCase();
      const taskDescLower = (task.description || '').toLowerCase();
      
      // Skip offline/PWA related tasks
      if (taskNameLower.includes('offline') || 
          taskNameLower.includes('service worker') || 
          taskNameLower.includes('pwa') ||
          taskDescLower.includes('offline') ||
          taskDescLower.includes('service worker') ||
          taskDescLower.includes('pwa')) {
        console.log(`Skipping offline/PWA task: ${task.name}`);
        return false;
      }
      
      // Skip accessibility-specific tasks (but keep general UI tasks that include basic accessibility)
      if ((taskNameLower.includes('accessibility') && !taskNameLower.includes('component')) ||
          (taskDescLower.includes('accessibility') && taskDescLower.includes('features'))) {
        console.log(`Skipping accessibility-specific task: ${task.name}`);
        return false;
      }
      
      // Skip animation-specific tasks
      if (taskNameLower.includes('animation') || 
          taskNameLower.includes('transition') ||
          taskDescLower.includes('animation') ||
          taskDescLower.includes('transition')) {
        console.log(`Skipping animation task: ${task.name}`);
        return false;
      }
      
      return true;
    });
    
    // Sort tasks by priority
    const sortedTasks = [...filteredTasks].sort((a, b) => (a.priority || 0) - (b.priority || 0));

    for (let i = 0; i < sortedTasks.length; i++) {
      const task = sortedTasks[i];
      
      try {
        // Notify progress
        if (onProgress) {
          onProgress({
            currentTask: i + 1,
            totalTasks: sortedTasks.length,
            taskName: task.name,
            status: 'generating'
          });
        }

        // Generate code for this task
        const result = await this.generateTaskCode(task, prd, generatedFiles);
        
        // Debug: Log the result
        console.log(`Task ${task.id} result:`, {
          hasFiles: !!result.files,
          filesCount: result.files?.length || 0,
          filesPaths: result.files?.map(f => f.path) || []
        });
        
        // Write files to disk
        for (const file of result.files) {
          const filePath = path.join(projectPath, file.path);
          
          // Create directory if needed
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          
          // Write file - ensure content is string
          let content = file.content;
          if (typeof content !== 'string') {
            // If it's an object, stringify it
            content = JSON.stringify(content, null, 2);
            console.warn(`Warning: Task ${task.id} returned object content for ${file.path}, converting to string`);
          }
          await fs.writeFile(filePath, content, 'utf-8');
          
          // Track generated files - use the fixed content
          generatedFiles[file.path] = content;
        }

        results.push({
          taskId: task.id,
          taskName: task.name,
          success: true,
          files: result.files.map(f => f.path),
          description: result.description
        });

        // Notify completion
        if (onProgress) {
          onProgress({
            currentTask: i + 1,
            totalTasks: sortedTasks.length,
            taskName: task.name,
            status: 'completed'
          });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Task ${task.id} failed:`, error);
        
        results.push({
          taskId: task.id,
          taskName: task.name,
          success: false,
          error: error.message
        });

        // Notify error but continue with other tasks
        if (onProgress) {
          onProgress({
            currentTask: i + 1,
            totalTasks: sortedTasks.length,
            taskName: task.name,
            status: 'failed',
            error: error.message
          });
        }
      }
    }

    return {
      results,
      summary: {
        total: sortedTasks.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        generatedFiles: Object.keys(generatedFiles).length
      }
    };
  }

  /**
   * Call LLM with retry logic
   */
  async callLLM(prompt, maxTokens = 4000) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const message = await this.anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: maxTokens,
          temperature: 0.7,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        });

        const content = message.content?.[0]?.text;
        if (!content) {
          throw new Error("Empty response from LLM");
        }

        return content;
      } catch (error) {
        console.error(`LLM call attempt ${attempt} failed:`, error.message);
        
        if (attempt === this.maxRetries) {
          throw error;
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  /**
   * Parse JSON with error handling
   */
  parseJSON(content) {
    try {
      // Debug: Log raw content length
      console.log('Raw LLM response length:', content.length);
      
      // Try direct parsing first
      const parsed = JSON.parse(content);
      
      // Debug: Log parsed result
      console.log('Parsed result:', {
        hasFiles: !!parsed.files,
        filesCount: parsed.files?.length || 0,
        filesPaths: parsed.files?.map(f => f.path) || []
      });
      
      // Validate and fix files array
      if (parsed.files && Array.isArray(parsed.files)) {
        parsed.files = parsed.files.map(file => {
          // Ensure content is string
          if (file.content && typeof file.content !== 'string') {
            console.warn(`Converting object content to string for ${file.path}`);
            file.content = JSON.stringify(file.content, null, 2);
          }
          return file;
        });
      }
      
      return parsed;
    } catch (error) {
      // Try removing markdown formatting
      const cleaned = content.replace(/```(json)?/g, "").trim();
      
      // Find JSON object in the content
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }
      
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validate and fix files array
        if (parsed.files && Array.isArray(parsed.files)) {
          parsed.files = parsed.files.map(file => {
            // Ensure content is string
            if (file.content && typeof file.content !== 'string') {
              console.warn(`Converting object content to string for ${file.path}`);
              file.content = JSON.stringify(file.content, null, 2);
            }
            return file;
          });
        }
        
        return parsed;
      } catch (parseError) {
        // Try to fix common JSON issues
        const fixed = jsonMatch[0]
          .replace(/\\/g, "\\\\")
          .replace(/\n/g, "\\n")
          .replace(/\r/g, "\\r")
          .replace(/\t/g, "\\t");
          
        const parsed = JSON.parse(fixed);
        
        // Validate and fix files array
        if (parsed.files && Array.isArray(parsed.files)) {
          parsed.files = parsed.files.map(file => {
            // Ensure content is string
            if (file.content && typeof file.content !== 'string') {
              console.warn(`Converting object content to string for ${file.path}`);
              file.content = JSON.stringify(file.content, null, 2);
            }
            return file;
          });
        }
        
        return parsed;
      }
    }
  }
}

module.exports = TaskBasedGenerator;