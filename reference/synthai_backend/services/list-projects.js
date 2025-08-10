const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const router = express.Router();

// GET /list-projects
router.get("/list-projects", async (req, res) => {
  try {
    const baseDir = path.join(__dirname, "../../client/user-projects");

    // Get all directories in the user-projects folder
    const files = await fs.readdir(baseDir, { withFileTypes: true });

    // Filter directories only (exclude files)
    const projects = files
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => {
        return {
          name: dirent.name,
          path: path.join(baseDir, dirent.name),
        };
      });

    return res.json({
      projects,
    });
  } catch (err) {
    console.error("Error listing projects:", err);
    return res.status(500).json({
      error: "Failed to list projects",
      details: err.message,
    });
  }
});

module.exports = router;
