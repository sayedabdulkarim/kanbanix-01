const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const router = express.Router();

// POST /fix-page-integration - Fix projects where page.tsx wasn't updated
router.post("/fix-page-integration", async (req, res) => {
  const { projectName } = req.body;

  if (!projectName) {
    return res.status(400).json({ error: "projectName is required" });
  }

  const baseDir = path.join(__dirname, "../../client/user-projects");
  const projectPath = path.join(baseDir, projectName);
  const pagePath = path.join(projectPath, "src/app/page.tsx");
  const prdPath = path.join(projectPath, "PRD.md");

  try {
    // Check if files exist
    await fs.access(pagePath);
    await fs.access(prdPath);

    // Read the PRD to understand what component to import
    const prd = await fs.readFile(prdPath, "utf-8");

    // Read current page.tsx content
    const currentPageContent = await fs.readFile(pagePath, "utf-8");

    // Check if it's still the default Next.js page
    if (currentPageContent.includes("Get started by editing") || 
        currentPageContent.includes("Deploy now") ||
        currentPageContent.includes("Read our docs")) {
      
      console.log(`Fixing page.tsx for project: ${projectName}`);

      // Generate proper page.tsx content based on PRD
      const prompt = `
Based on this PRD, generate a proper page.tsx file that imports and uses the main component.

PRD:
${prd}

Look at the project structure and determine:
1. What is the main component name (likely Counter, TodoList, etc.)
2. Where it's imported from (likely from components folder)
3. Any contexts or providers needed

Generate ONLY the complete page.tsx file content. The file should:
- Import the main component
- Use any required providers/contexts
- Return the main component
- Include proper TypeScript types
- Use 'use client' directive if needed

Return ONLY the code, no markdown or explanations.`;

      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "anthropic/claude-3.5-sonnet",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: 2000,
          temperature: 0.7
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 30000
        }
      );

      const newPageContent = response.data.choices?.[0]?.message?.content;
      
      if (!newPageContent) {
        throw new Error("Failed to generate page content");
      }

      // Clean the content (remove markdown if any)
      const cleanedContent = newPageContent
        .replace(/```(typescript|tsx|ts)?/g, '')
        .replace(/```/g, '')
        .trim();

      // Write the new page.tsx
      await fs.writeFile(pagePath, cleanedContent, 'utf-8');

      return res.json({
        message: "Successfully updated page.tsx to use the generated components",
        projectName
      });
    } else {
      return res.json({
        message: "page.tsx already appears to be customized",
        projectName
      });
    }
  } catch (error) {
    console.error("Error fixing page integration:", error);
    return res.status(500).json({
      error: "Failed to fix page integration",
      details: error.message
    });
  }
});

module.exports = router;