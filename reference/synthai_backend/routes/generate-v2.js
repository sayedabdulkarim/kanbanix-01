const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs/promises");
const { randomUUID } = require("crypto");
const { spawn } = require("child_process");
const TaskBasedGenerator = require("../services/task-based-generator");
const LLMBuildValidator = require("../services/llm-build-validator");
const projectManager = require("../services/project-manager");
require("dotenv").config();

/**
 * Modern project generation flow:
 * 1. Create project with create-next-app
 * 2. Generate PRD
 * 3. Use task-based generation for code
 * 4. Validate and fix if needed
 */
router.post("/generate-v2", async (req, res) => {
  const { requirement, socketId } = req.body;
  
  if (!requirement) {
    return res.status(400).json({ error: "Requirement is required" });
  }

  const io = req.app.get('io');
  const socket = socketId && io ? io.sockets.sockets.get(socketId) : null;
  const projectName = `project-${randomUUID().slice(0, 8)}`;
  const baseDir = path.join(__dirname, "../../client/user-projects");
  const projectPath = path.join(baseDir, projectName);

  try {
    // Step 1: Initialize project with create-next-app
    if (socket) {
      socket.emit("output", `\n🚀 Starting modern project generation...\n`);
      socket.emit("output", `📁 Project: ${projectName}\n\n`);
      socket.emit("output", `> Step 1: Initializing Next.js project...\n`);
    }

    await fs.mkdir(baseDir, { recursive: true });

    // Create project with create-next-app
    const createNextAppSuccess = await new Promise((resolve) => {
      const childProcess = spawn(
        "npx",
        [
          "create-next-app@latest",
          projectName,
          "--tailwind",
          "--eslint",
          "--app",
          "--src-dir",
          "--ts",
          "--yes",
        ],
        {
          cwd: baseDir,
          shell: true,
          env: {
            ...process.env,
            CI: "true",
            FORCE_COLOR: "0",
            DISABLE_OPENCOLLECTIVE: "1",
            ADBLOCK: "1"
          }
        }
      );

      childProcess.stdout.on("data", (data) => {
        if (socket) socket.emit("output", data.toString());
      });

      childProcess.stderr.on("data", (data) => {
        if (socket) socket.emit("output", data.toString());
      });

      childProcess.on("close", (code) => {
        resolve(code === 0);
      });
    });

    if (!createNextAppSuccess) {
      throw new Error("Failed to create Next.js project");
    }

    // Step 2: Generate PRD using task-based generator
    if (socket) {
      socket.emit("output", `\n> Step 2: Generating PRD from requirements...\n`);
    }

    const generator = new TaskBasedGenerator(process.env.OPENROUTER_API_KEY);
    const prd = await generator.generatePRD(requirement);
    
    // Save PRD
    await fs.writeFile(path.join(projectPath, "PRD.md"), prd);
    
    if (socket) {
      socket.emit("output", `✓ PRD generated successfully\n`);
    }

    // Step 3: Generate code using task-based approach
    if (socket) {
      socket.emit("output", `\n> Step 3: Generating code based on PRD...\n`);
    }

    const result = await generator.generateProject(prd, projectPath, socket);

    // Step 4: Validate build
    if (socket) {
      socket.emit("output", `\n> Step 4: Validating project build...\n`);
    }

    const validator = new LLMBuildValidator(process.env.OPENROUTER_API_KEY);
    const validationResult = await validator.validateAndFix(projectPath, prd, socket);

    // Step 5: Start dev server
    if (socket) {
      socket.emit("output", `\n> Step 5: Starting development server...\n`);
    }

    const port = await projectManager.startProject(projectPath, projectName, socket);

    // Return success response
    res.json({
      success: true,
      projectName,
      projectPath,
      port,
      prd,
      tasks: result.tasks,
      validationResult
    });

  } catch (error) {
    console.error("Error in generate-v2:", error);
    
    if (socket) {
      socket.emit("output", `\n❌ Error: ${error.message}\n`);
    }

    // Clean up on error
    try {
      await fs.rm(projectPath, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError);
    }

    res.status(500).json({
      error: error.message,
      projectName
    });
  }
});

// Get project list (for UI)
router.get("/projects", async (req, res) => {
  try {
    const baseDir = path.join(__dirname, "../../client/user-projects");
    const projects = [];
    
    try {
      const dirs = await fs.readdir(baseDir);
      
      for (const dir of dirs) {
        if (dir.startsWith('project-')) {
          const projectPath = path.join(baseDir, dir);
          const stat = await fs.stat(projectPath);
          
          if (stat.isDirectory()) {
            // Check if it has a PRD
            let hasPRD = false;
            try {
              await fs.access(path.join(projectPath, 'PRD.md'));
              hasPRD = true;
            } catch {}
            
            projects.push({
              name: dir,
              path: projectPath,
              createdAt: stat.birthtime,
              hasPRD,
              isRunning: projectManager.isProjectRunning(dir)
            });
          }
        }
      }
    } catch (error) {
      console.error("Error reading projects:", error);
    }
    
    res.json({ projects });
  } catch (error) {
    console.error("Error getting projects:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;