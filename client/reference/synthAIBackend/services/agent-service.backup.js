// Agent Service for UI generation
const { LLMService, LLMServiceError } = require("./llm-service");

class AgentService {
  constructor() {
    this.llmService = new LLMService();
  }

  // Check if the requirement is requesting a modification to an existing UI
  _isModificationRequest(requirement) {
    const modificationKeywords = [
      "add",
      "change",
      "modify",
      "update",
      "remove",
      "delete",
      "reset button",
      "alter",
      "adjust",
      "extend",
      "enhance",
    ];

    const requirementLower = requirement.toLowerCase();
    return modificationKeywords.some((keyword) =>
      requirementLower.includes(keyword)
    );
  }

  // Analyze the requirement with Next.js + Tailwind context
  async _analyzeRequirement(requirement, isModification) {
    const prompt = `
    You are a Next.js development expert. Analyze this UI requirement:
    
    '${requirement}'
    
    Consider:
    1. What Next.js components are needed
    2. What Tailwind CSS classes would be appropriate
    3. What state management is required
    4. Component hierarchy and data flow
    5. Any technical constraints or challenges
    
    Return only your analysis, formatted clearly.
    `;

    return await this.llmService.generateText(prompt);
  }

  // Create an implementation plan for Next.js + Tailwind
  async _planImplementation(requirement, analysis, isModification) {
    const prompt = `
    Based on:
    Requirement: '${requirement}'
    Analysis: '${analysis}'
    
    Create a step-by-step plan to implement this Next.js + Tailwind CSS project:
    1. Project structure and file organization
    2. Component breakdown and responsibilities (using plain JavaScript, not TypeScript)
    3. State management approach with React hooks
    4. Implementation order and dependencies
    5. Styling approach using Tailwind CSS classes
    
    Return only the concrete implementation plan, formatted as a clear list.
    `;

    return await this.llmService.generateText(prompt);
  }

  // Generate Next.js project files
  async _generateNextJsProjectFiles(requirement, analysis, plan) {
    try {
      const prompt = `
      🧠 Requirement:
      ${requirement}

      ✅ Tasks to perform:

      1. Create a Next.js project (no TypeScript).
      2. Setup Tailwind CSS with necessary configuration files.
      3. Create the following project structure and files:

      📁 File Structure:
      - /pages/index.js → main page rendering the TODO app
      - /components/TodoList.js → displays list of todo items
      - /components/TodoItem.js → represents individual todo item
      - /styles/globals.css → global styles using Tailwind
      - /tailwind.config.js → Tailwind configuration
      - /postcss.config.js → PostCSS configuration

      🧩 Logic Requirements:
      - index.js should include state for managing todos (add/delete/toggle)
      - TodoList should accept todos as props (using plain JavaScript, not TypeScript)
      - TodoItem should accept todo, onToggle, and onDelete as props
      - Use ONLY Tailwind CSS classes for styling (no inline styles, no CSS modules)
      - Use plain HTML elements with Tailwind classes (no component libraries)
      - Components should be functional components written in plain modern JavaScript

      🎁 Output Format:
      Return a single valid JSON object with file paths as keys and code content as values.

      🚫 Important:
      - Do NOT include TypeScript extensions (.ts, .tsx)
      - Do NOT use TypeScript syntax (no interfaces, types, or React.FC)
      - Do NOT use shadcn/ui or any other UI component libraries
      - Do NOT include src/ in file paths
      - Do NOT include explanations or markdown - ONLY JSON

      ✅ Example Output:
      {
        "/pages/index.js": "import { useState } from 'react'...",
        "/components/TodoList.js": "export default function TodoList({ todos, onToggle, onDelete }) {...",
        ...
      }
      `;

      const response = await this.llmService.generateText(prompt);

      try {
        // Clean response by removing markdown formatting and extracting JSON
        const cleanResponse = response.replace(/```(json)?/g, "").trim();
        const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          throw new Error("No valid JSON found in response");
        }

        let files;
        try {
          files = JSON.parse(jsonMatch[0]);
        } catch (jsonError) {
          // Try to sanitize the JSON if it has issues
          const sanitizedJson = jsonMatch[0]
            .replace(/\\'/g, "'") // Fix escaped single quotes
            .replace(/\\"/g, '"') // Fix escaped double quotes
            .replace(/\n/g, "\\n"); // Properly escape newlines

          files = JSON.parse(sanitizedJson);
        }

        // Normalize file paths to ensure they start with /
        const normalizedFiles = {};
        for (const [key, value] of Object.entries(files)) {
          // Ensure key starts with / and doesn't have /src/
          let normalizedKey = key.startsWith("/") ? key : `/${key}`;
          // Remove any /src/ prefix
          normalizedKey = normalizedKey.replace(/^\/src\//, "/");

          // Check for TypeScript extensions
          if (normalizedKey.endsWith(".tsx") || normalizedKey.endsWith(".ts")) {
            const jsPath = normalizedKey.replace(/\.tsx?$/, ".js");
            console.warn(
              `Converting TypeScript path to JavaScript: ${normalizedKey} → ${jsPath}`
            );
            normalizedKey = jsPath;
          }

          normalizedFiles[normalizedKey] = value;
        } // Validate required files
        const requiredFiles = [
          "/pages/index.js",
          "/components/TodoList.js",
          "/components/TodoItem.js",
          "/styles/globals.css",
          "/tailwind.config.js",
          "/postcss.config.js",
        ];

        const missingFiles = requiredFiles.filter(
          (file) => !normalizedFiles[file]
        );
        if (missingFiles.length > 0) {
          console.warn(
            `Warning: Missing required files: ${missingFiles.join(", ")}`
          );
        }

        // Validate file extensions to ensure they're .js not .ts/.tsx
        const tsFiles = Object.keys(normalizedFiles).filter(
          (file) => file.endsWith(".ts") || file.endsWith(".tsx")
        );

        if (tsFiles.length > 0) {
          console.warn(
            `Warning: TypeScript files detected: ${tsFiles.join(", ")}`
          );
        }

        return normalizedFiles;
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(
            `Failed to parse generated code as JSON: ${error.message}`
          );
        }
        throw error;
      }
    } catch (error) {
      throw new Error(`Next.js project generation failed: ${error.message}`);
    }
  }

  // Generate feedback when the requirement is too vague or not feasible
  async _generateFeedback(requirement, analysis) {
    const prompt = `
    The following UI requirement appears to be unclear or not feasible:
    
    '${requirement}'
    
    Based on this analysis: '${analysis}'
    
    Please provide:
    1. A clear explanation of what makes this requirement challenging
    2. Specific questions that would help clarify the requirement
    3. Alternative suggestions that might meet the user's needs
    
    Format this as helpful feedback to the user.
    `;

    return await this.llmService.generateText(prompt);
  }

  // Process the requirement
  async processRequirement(requirement) {
    try {
      const isModification = this._isModificationRequest(requirement);

      const analysis = await this._analyzeRequirement(
        requirement,
        isModification
      );
      const plan = await this._planImplementation(
        requirement,
        analysis,
        isModification
      );

      // Generate Next.js project files instead of basic UI code
      const generatedFiles = await this._generateNextJsProjectFiles(
        requirement,
        analysis,
        plan
      );

      return {
        files: generatedFiles,
        analysis: analysis,
        plan: plan,
        feedback: null,
      };
    } catch (error) {
      throw new Error(`Failed to process requirement: ${error.message}`);
    }
  }
}

module.exports = { AgentService };
