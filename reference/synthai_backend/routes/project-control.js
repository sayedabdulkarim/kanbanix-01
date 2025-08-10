const express = require("express");
const projectManager = require("../services/project-manager");
const path = require("path");

const router = express.Router();

// Get all running projects
router.get("/api/running-projects", (req, res) => {
  try {
    const projects = projectManager.getAllRunningProjects();
    res.json({ projects });
  } catch (error) {
    console.error("Error getting running projects:", error);
    res.status(500).json({ error: error.message });
  }
});

// Stop a specific project
router.post("/api/stop-project", (req, res) => {
  try {
    const { projectName } = req.body;
    
    if (!projectName) {
      return res.status(400).json({ error: "Project name is required" });
    }
    
    const stopped = projectManager.stopProject(projectName);
    
    if (stopped) {
      res.json({ message: `Project ${projectName} stopped successfully` });
    } else {
      res.status(404).json({ error: `Project ${projectName} is not running` });
    }
  } catch (error) {
    console.error("Error stopping project:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start a project (useful for restarting)
router.post("/api/start-project", async (req, res) => {
  try {
    const { projectPath, projectName, socketId } = req.body;
    
    if (!projectPath) {
      return res.status(400).json({ error: "Project path is required" });
    }
    
    // Get socket if provided
    const io = req.app.get('io');
    const socket = socketId && io ? io.sockets.sockets.get(socketId) : null;
    
    const projectInfo = await projectManager.startProject(projectPath, projectName, socket);
    
    res.json({
      message: "Project started successfully",
      ...projectInfo
    });
  } catch (error) {
    console.error("Error starting project:", error);
    res.status(500).json({ error: error.message });
  }
});

// Run a project by name
router.post("/api/run-project", async (req, res) => {
  try {
    const { projectName, socketId } = req.body;
    
    if (!projectName) {
      return res.status(400).json({ error: "Project name is required" });
    }
    
    // Build the project path
    const projectPath = path.join(__dirname, "..", "..", "client", "user-projects", projectName);
    
    // Get socket if provided
    const io = req.app.get('io');
    const socket = socketId && io ? io.sockets.sockets.get(socketId) : null;
    
    const projectInfo = await projectManager.startProject(projectPath, projectName, socket);
    
    res.json({
      message: "Project started successfully",
      ...projectInfo
    });
  } catch (error) {
    console.error("Error running project:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;