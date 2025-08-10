const express = require("express");
const path = require("path");
const CompilationChecker = require("../services/compilation-checker");

const router = express.Router();

// POST /api/check-compilation - Run compilation check on a project
router.post("/api/check-compilation", async (req, res) => {
  const { projectName, autoFix = true, socketId } = req.body;

  if (!projectName) {
    return res.status(400).json({ error: "projectName is required" });
  }

  const io = req.app.get('io');
  const socket = socketId && io ? io.sockets.sockets.get(socketId) : null;

  const baseDir = path.join(__dirname, "../../client/user-projects");
  const projectPath = path.join(baseDir, projectName);

  try {
    const checker = new CompilationChecker();
    
    if (autoFix) {
      // Run check and auto-fix
      const result = await checker.checkAndFix(projectPath, socket);
      
      return res.json({
        message: result.success 
          ? "Compilation check passed" 
          : "Compilation has errors that couldn't be fixed automatically",
        ...result
      });
    } else {
      // Just check without fixing
      const result = await checker.checkCompilation(projectPath, socket);
      
      return res.json({
        message: result.success 
          ? "Compilation check passed" 
          : "Compilation has errors",
        ...result
      });
    }
  } catch (error) {
    console.error("Error during compilation check:", error);
    
    if (socket) {
      socket.emit('output', `\n\x1b[31m✗ Error: ${error.message}\x1b[0m\n`);
    }
    
    return res.status(500).json({
      error: "Failed to check compilation",
      details: error.message
    });
  }
});

module.exports = router;