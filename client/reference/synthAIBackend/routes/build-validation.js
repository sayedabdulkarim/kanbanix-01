const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const LLMBuildValidator = require("../services/llm-build-validator");
require("dotenv").config();

const router = express.Router();

// POST /validate-build - Validate and fix build errors for a project
router.post("/validate-build", async (req, res) => {
  const { projectName, socketId } = req.body;

  if (!projectName) {
    return res.status(400).json({ 
      error: "projectName is required" 
    });
  }

  const io = req.app.get('io');
  const socket = socketId && io ? io.sockets.sockets.get(socketId) : null;

  const baseDir = path.join(__dirname, "../../client/user-projects");
  const projectPath = path.join(baseDir, projectName);
  const prdPath = path.join(projectPath, "PRD.md");

  try {
    console.log(`Starting build validation for project: ${projectName}`);
    
    // Check if project exists
    try {
      await fs.access(projectPath);
    } catch (err) {
      console.error(`Project not found at: ${projectPath}`);
      return res.status(404).json({ error: "Project not found" });
    }
    
    // Read the PRD for context
    let prd = "";
    try {
      prd = await fs.readFile(prdPath, "utf-8");
      console.log(`Read PRD for project ${projectName}, length: ${prd.length}`);
    } catch (err) {
      console.log(`PRD not found for project ${projectName}, proceeding without context`);
      prd = "No PRD available. Fix based on build errors only.";
    }
    
    // Check API key
    if (!process.env.OPENROUTER_API_KEY) {
      console.error("OPENROUTER_API_KEY not found in environment");
      return res.status(500).json({ error: "API key not configured" });
    }
    
    // Initialize validator
    const validator = new LLMBuildValidator(process.env.OPENROUTER_API_KEY);
    
    // Notify start
    if (socket) {
      socket.emit('output', '\n\x1b[1;34m> Starting AI-powered build validation...\x1b[0m\n');
    } else {
      console.log("No socket connection available for real-time updates");
    }

    // Run validation and fixes
    const result = await validator.validateAndFix(projectPath, prd, socket);
    
    if (result.success) {
      if (socket) {
        socket.emit('output', '\n\x1b[1;32m✓ Build validation completed successfully!\x1b[0m\n');
      }
      
      return res.json({
        success: true,
        message: "Build validation completed successfully",
        attempts: result.attempts
      });
    } else {
      if (socket) {
        socket.emit('output', '\n\x1b[31m✗ Build validation failed after all attempts.\x1b[0m\n');
      }
      
      return res.json({
        success: false,
        message: result.message || "Build validation failed",
        attempts: result.attempts
      });
    }

  } catch (error) {
    console.error("Error in build validation:", error);
    
    if (socket) {
      socket.emit('output', `\n\x1b[31m✗ Error: ${error.message}\x1b[0m\n`);
    }
    
    return res.status(500).json({ 
      error: "Failed to validate build", 
      details: error.message 
    });
  }
});

module.exports = router;