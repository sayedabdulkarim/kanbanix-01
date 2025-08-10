/**
 * shell-command-executor.js
 *
 * A Node.js utility for executing shell commands, including built-ins
 * like 'cd' and environment variables, with proper output handling.
 */

const { spawn } = require("child_process");

/**
 * Executes a shell command using child_process.spawn
 *
 * @param {string} command - The shell command to execute
 * @param {Object} options - Additional options (optional)
 * @param {boolean} options.silent - If true, suppresses console output (default: false)
 * @param {Object} options.env - Additional environment variables to pass to the command
 * @returns {Promise<Object>} Promise resolving to result object
 */
function executeShellCommand(command, options = {}) {
  const { silent = false, env = {} } = options;

  return new Promise((resolve) => {
    if (!silent) {
      console.log(`\n----- Executing command: ${command} -----`);
    }

    // Use spawn with 'sh -c' to support shell built-ins and proper expansion
    const childProcess = spawn("sh", ["-c", command], {
      env: { ...process.env, ...env },
      shell: false, // Not needed since we're explicitly using sh -c
    });

    let stdoutData = "";
    let stderrData = "";

    // Capture stdout data
    childProcess.stdout.on("data", (data) => {
      const output = data.toString();
      stdoutData += output;

      if (!silent) {
        console.log(`\x1b[32mSTDOUT:\x1b[0m ${output.trim()}`);
      }
    });

    // Capture stderr data
    childProcess.stderr.on("data", (data) => {
      const output = data.toString();
      stderrData += output;

      if (!silent) {
        console.log(`\x1b[31mSTDERR:\x1b[0m ${output.trim()}`);
      }
    });

    // Handle process completion
    childProcess.on("close", (exitCode) => {
      const success = exitCode === 0;

      if (!silent) {
        console.log(`\x1b[36mExit code:\x1b[0m ${exitCode}`);

        if (success) {
          console.log("\x1b[32mCommand executed successfully ✓\x1b[0m");
        } else {
          console.log("\x1b[31mCommand execution failed ✗\x1b[0m");
        }

        console.log("----- Command execution completed -----\n");
      }

      // Resolve with all the collected information
      resolve({
        command,
        stdout: stdoutData,
        stderr: stderrData,
        exitCode,
        success,
      });
    });

    // Handle errors in spawning the process
    childProcess.on("error", (err) => {
      if (!silent) {
        console.error(`\x1b[31mFailed to start command: ${err.message}\x1b[0m`);
        console.log("----- Command execution failed -----\n");
      }

      resolve({
        command,
        stdout: "",
        stderr: err.message,
        exitCode: 1,
        success: false,
      });
    });
  });
}

// Export the function
module.exports = executeShellCommand;

// If this file is run directly, demonstrate its functionality
if (require.main === module) {
  // Run a series of example commands
  async function runExamples() {
    try {
      console.log("===== Shell Command Executor Examples =====");

      // Example 1: Simple command
      await executeShellCommand('echo "Hello from the shell"');

      // Example 2: Command with environment variables
      await executeShellCommand('echo "Current user: $USER"');

      // Example 3: Working with directories (shell built-in)
      await executeShellCommand("cd /tmp && pwd");

      // Example 4: Running a command that will succeed
      await executeShellCommand("ls -la");

      // Example 5: Running a command that will fail
      await executeShellCommand("command-that-does-not-exist");

      // Example 6: Silent mode - won't output logs (but still captures them)
      const silentResult = await executeShellCommand(
        'echo "This is silent" && date',
        { silent: true }
      );
      console.log("Silent command result:", silentResult);

      // Example 7: Using environment variables via options
      await executeShellCommand('echo "Custom greeting: $GREETING"', {
        env: { GREETING: "Hello from Node.js!" },
      });

      // Example 8: More complex command with pipes
      await executeShellCommand("ls -la | grep js");

      console.log("===== Examples Completed =====");
    } catch (err) {
      console.error("Error running examples:", err);
    }
  }

  // Run the examples
  runExamples();
}
