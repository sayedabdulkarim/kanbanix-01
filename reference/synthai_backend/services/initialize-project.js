const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const projectManager = require("./project-manager");
const { LocalProjectValidator } = require("./local-project-validator");

let io;
const router = express.Router();

// Export a function that accepts io as a parameter
module.exports = (socketIo) => {
  io = socketIo;

  router.post("/initialize-project", async (req, res) => {
    const { prd, socketId } = req.body;

    if (!prd || typeof prd !== "string") {
      return res.status(400).json({ error: "PRD is required as a string" });
    }

    // Check if socketId was provided
    const socket = socketId ? io.sockets.sockets.get(socketId) : null;

    try {
      console.log("Received PRD:", prd);

      // Generate a unique project name
      const projectName = `project-${randomUUID().slice(0, 8)}`;
      console.log("Generated project name:", projectName);

      const baseDir = path.join(__dirname, "../../client/user-projects");
      console.log("Base directory:", baseDir);

      const projectPath = path.join(baseDir, projectName);
      console.log("Project path:", projectPath);

      // Ensure user-projects folder exists
      await fs.mkdir(baseDir, { recursive: true });
      console.log("Ensured user-projects directory exists");

      // Run create-next-app command
      const commandString = `npx create-next-app@latest ${projectName} --tailwind --eslint --app --src-dir --ts --yes`;
      console.log("Running command:", commandString);

      // Emit initial message to the terminal
      if (socket) {
        socket.emit(
          "output",
          `\n> Starting project initialization...\n> ${commandString}\n\n`
        );
        // Emit status event for project initialization
        socket.emit('project:status', {
          projectName,
          stage: 'initializing',
          message: 'Creating new Next.js project...'
        });
      }

      // Use spawn to capture real-time output
      // Set environment variables to force non-interactive mode
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
            // Force non-interactive mode
            CI: "true",
            FORCE_COLOR: "0",
            // Disable progress bars
            DISABLE_OPENCOLLECTIVE: "1",
            ADBLOCK: "1"
          }
        }
      );

      // Stream stdout to the client terminal with clean line-by-line output
      childProcess.stdout.on("data", (data) => {
        const output = data.toString();
        // Split by newlines and emit each line separately
        const lines = output.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (line.trim() || index < lines.length - 1) {
            if (socket) {
              socket.emit("output", line + "\n");
            }
          }
        });
        console.log("Command output:", output);
      });

      // Stream stderr to the client terminal
      childProcess.stderr.on("data", (data) => {
        const output = data.toString();
        // Split by newlines and emit each line separately
        const lines = output.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (line.trim() || index < lines.length - 1) {
            if (socket) {
              socket.emit("output", line + "\n");
            }
          }
        });
        console.error("Command error:", output);
      });

      // Wait for the command to complete
      const exitCode = await new Promise((resolve) => {
        childProcess.on("close", (code) => {
          if (socket) {
            socket.emit("output", `\n> Process exited with code ${code}\n`);
          }
          resolve(code);
        });
      });

      if (exitCode !== 0) {
        throw new Error(`Command failed with exit code ${exitCode}`);
      }

      // Run local validation and fixes before proceeding
      if (socket) {
        socket.emit("output", `\n> Running local project validation...\n`);
      }

      try {
        const validator = new LocalProjectValidator();
        const validationResult = await validator.validateProject(projectPath, socket);

        if (!validationResult.success) {
          if (socket) {
            socket.emit("output", `\n> ⚠ Validation found ${validationResult.results.errors.length} issues\n`);
            socket.emit("output", `> Applied ${validationResult.results.fixes.length} fixes\n`);
          }
          console.log('Validation results:', validationResult.results);
          
          // If critical errors remain, we can still proceed but warn the user
          const criticalErrors = validationResult.results.errors.filter(error => 
            error.includes('Tailwind') || error.includes('package manager')
          );
          
          if (criticalErrors.length > 0) {
            if (socket) {
              socket.emit("output", `\n> ⚠ Critical validation issues detected:\n`);
              criticalErrors.forEach(error => {
                socket.emit("output", `>   - ${error}\n`);
              });
              socket.emit("output", `> Proceeding anyway - manual fixes may be needed\n`);
            }
          }
        } else {
          if (socket) {
            socket.emit("output", `\n> ✓ Project validation passed successfully\n`);
          }
        }
      } catch (validationError) {
        console.error('LocalProjectValidator failed:', validationError);
        if (socket) {
          socket.emit("output", `\n> ⚠ Local validation failed: ${validationError.message}\n`);
          socket.emit("output", `> Falling back to basic setup...\n`);
        }
        
        // Fallback: Try basic Tailwind v3 setup
        try {
          await router.basicTailwindSetup(projectPath, socket);
        } catch (fallbackError) {
          console.error('Fallback setup also failed:', fallbackError);
          if (socket) {
            socket.emit("output", `\n> ⚠ Fallback setup failed. Project may have build issues.\n`);
            socket.emit("output", `> You may need to manually fix Tailwind CSS configuration.\n`);
          }
          // Don't throw here - let the project creation continue
        }
      }


      // Save the PRD as markdown file in the project directory
      const prdPath = path.join(projectPath, "PRD.md");
      await fs.writeFile(prdPath, prd, "utf-8");
      console.log("Saved PRD to:", prdPath);

      if (socket) {
        socket.emit(
          "output",
          `\n> Saved PRD to: ${prdPath}\n> Project initialization completed successfully!\n`
        );
        // Emit status event for project initialized
        socket.emit('project:status', {
          projectName,
          stage: 'initialized',
          message: 'Project structure created successfully!'
        });
      }

      // Start the development server directly (create-next-app already installed dependencies)
      try {
        const projectInfo = await projectManager.startProject(projectPath, socket);

        return res.json({
          projectName,
          projectPath,
          port: projectInfo.port,
          url: projectInfo.url,
          message: "Project initialized and started successfully",
        });
      } catch (startError) {
        console.error("Error starting project:", startError);
        
        // Still return success for project creation, but note the start error
        return res.json({
          projectName,
          projectPath,
          message: "Project initialized successfully, but failed to start dev server",
          startError: startError.message
        });
      }
    } catch (err) {
      console.error("Error initializing project:", err);

      // Send error to terminal
      if (socket) {
        socket.emit("output", `\n> ERROR: ${err.message}\n`);
      }

      return res.status(500).json({
        error: "Failed to initialize project",
        details: err.message,
      });
    }
  });

  // Fallback method for basic Tailwind v3 setup
  router.basicTailwindSetup = async function(projectPath, socket) {
    if (socket) {
      socket.emit("output", `> Attempting basic Tailwind v3 setup...\n`);
    }

    // Simple package manager detection
    let packageManager = 'npm';
    try {
      await fs.access(path.join(projectPath, 'yarn.lock'));
      packageManager = 'yarn';
    } catch {
      // Use npm
    }

    // Install Tailwind v4 with required packages
    const { spawn } = require("child_process");
    const installCmd = packageManager === 'yarn' 
      ? ['add', '--dev', 'tailwindcss@^4.0.0', '@tailwindcss/postcss@^4.0.0-alpha.33', 'postcss@^8.4.33']
      : ['install', '--save-dev', 'tailwindcss@^4.0.0', '@tailwindcss/postcss@^4.0.0-alpha.33', 'postcss@^8.4.33'];

    await new Promise((resolve, reject) => {
      const process = spawn(packageManager, installCmd, { cwd: projectPath, shell: true });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Package installation failed with code ${code}`));
        }
      });
    });

    // Create PostCSS config for Tailwind v4
    const postcssConfig = `/** @type {import('postcss-load-config').Config} */
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`;
    await fs.writeFile(path.join(projectPath, "postcss.config.js"), postcssConfig);

    if (socket) {
      socket.emit("output", `> ✓ Basic Tailwind v4 setup completed\n`);
    }
  };

  return router;
};
