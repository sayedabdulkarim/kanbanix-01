const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const archiver = require("archiver");
const { createReadStream } = require("fs");

const router = express.Router();

// Get file tree for a project
router.get("/api/project-files/:projectName", async (req, res) => {
  try {
    const { projectName } = req.params;
    const projectPath = path.join(__dirname, "..", "..", "client", "user-projects", projectName);
    
    // Check if project exists
    try {
      await fs.access(projectPath);
    } catch {
      return res.status(404).json({ error: "Project not found" });
    }
    
    // Recursively read directory structure
    async function readDirectory(dirPath, relativePath = "") {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      const result = [];
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        // Use forward slashes for consistent paths across platforms
        const itemRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name;
        
        if (item.isDirectory()) {
          const children = await readDirectory(itemPath, itemRelativePath);
          result.push({
            name: item.name,
            path: itemRelativePath.replace(/\\/g, '/'),
            type: "directory",
            children
          });
        } else {
          result.push({
            name: item.name,
            path: itemRelativePath.replace(/\\/g, '/'),
            type: "file"
          });
        }
      }
      
      return result.sort((a, b) => {
        // Directories first, then files
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === "directory" ? -1 : 1;
      });
    }
    
    const fileTree = await readDirectory(projectPath);
    res.json({ projectName, files: fileTree });
    
  } catch (error) {
    console.error("Error reading project files:", error);
    res.status(500).json({ error: "Failed to read project files" });
  }
});

// Helper function to handle file operations
async function handleFileOperation(req, res, operation) {
  try {
    // Extract project name and file path from URL
    const urlPath = req.path.replace('/api/project-file/', '');
    const firstSlashIndex = urlPath.indexOf('/');
    
    if (firstSlashIndex === -1) {
      return res.status(400).json({ error: "Invalid file path" });
    }
    
    const projectName = urlPath.substring(0, firstSlashIndex);
    const filePath = urlPath.substring(firstSlashIndex + 1);
    
    if (!projectName || !filePath) {
      return res.status(400).json({ error: "Invalid request" });
    }
    
    const fullPath = path.join(__dirname, "..", "..", "client", "user-projects", projectName, filePath);
    const projectPath = path.join(__dirname, "..", "..", "client", "user-projects", projectName);
    
    // Security check
    const resolvedPath = path.resolve(fullPath);
    if (!resolvedPath.startsWith(path.resolve(projectPath))) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Execute the operation
    await operation(projectName, filePath, fullPath, req, res);
    
  } catch (error) {
    console.error("Error in file operation:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

// Read a specific file
router.get(/^\/api\/project-file\/(.+)$/, async (req, res) => {
  await handleFileOperation(req, res, async (projectName, filePath, fullPath) => {
    try {
      const content = await fs.readFile(fullPath, "utf-8");
      res.json({ content, path: filePath });
    } catch (error) {
      if (error.code === "ENOENT") {
        return res.status(404).json({ error: "File not found" });
      }
      throw error;
    }
  });
});

// Save a file
router.put(/^\/api\/project-file\/(.+)$/, async (req, res) => {
  await handleFileOperation(req, res, async (projectName, filePath, fullPath, req) => {
    const { content } = req.body;
    
    if (content === undefined) {
      return res.status(400).json({ error: "Content is required" });
    }
    
    // Ensure directory exists
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(fullPath, content, "utf-8");
    res.json({ message: "File saved successfully", path: filePath });
  });
});

// Create a new file
router.post(/^\/api\/project-file\/(.+)$/, async (req, res) => {
  await handleFileOperation(req, res, async (projectName, filePath, fullPath, req) => {
    const { content = "" } = req.body;
    
    // Check if file already exists
    try {
      await fs.access(fullPath);
      return res.status(409).json({ error: "File already exists" });
    } catch {
      // File doesn't exist, continue
    }
    
    // Ensure directory exists
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(fullPath, content, "utf-8");
    res.json({ message: "File created successfully", path: filePath });
  });
});

// Delete a file
router.delete(/^\/api\/project-file\/(.+)$/, async (req, res) => {
  await handleFileOperation(req, res, async (projectName, filePath, fullPath) => {
    try {
      await fs.unlink(fullPath);
      res.json({ message: "File deleted successfully", path: filePath });
    } catch (error) {
      if (error.code === "ENOENT") {
        return res.status(404).json({ error: "File not found" });
      }
      throw error;
    }
  });
});

// Download project as ZIP
router.get("/api/download-project/:projectName", async (req, res) => {
  try {
    const { projectName } = req.params;
    const projectPath = path.join(__dirname, "..", "..", "client", "user-projects", projectName);
    
    // Check if project exists
    try {
      await fs.access(projectPath);
    } catch {
      return res.status(404).json({ error: "Project not found" });
    }
    
    // Set response headers
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${projectName}.zip"`);
    
    // Create a zip archive
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });
    
    // Handle archive errors
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      res.status(500).send({ error: 'Failed to create archive' });
    });
    
    // Pipe archive data to response
    archive.pipe(res);
    
    // Add project directory to archive, excluding node_modules and .next
    archive.directory(projectPath, false, (entryData) => {
      // Exclude node_modules, .next, and other build artifacts
      const excludePaths = ['node_modules', '.next', '.git', 'dist', 'build'];
      const relativePath = entryData.name;
      
      // Check if the current path should be excluded
      for (const excludePath of excludePaths) {
        if (relativePath.includes(excludePath)) {
          return false; // Exclude this file/directory
        }
      }
      
      return entryData;
    });
    
    // Finalize the archive
    await archive.finalize();
    
  } catch (error) {
    console.error("Error downloading project:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to download project" });
    }
  }
});

module.exports = router;