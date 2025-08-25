const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class DeploymentAdapter {
  constructor() {
    this.isCloudEnvironment = process.env.DEPLOYMENT_ENV === 'cloud';
  }

  /**
   * Execute command with cloud compatibility
   */
  async executeCommand(command, cwd, socket) {
    if (this.isCloudEnvironment) {
      // Use exec for cloud environments
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          maxBuffer: 10 * 1024 * 1024 // 10MB buffer
        });
        
        if (socket) {
          socket.emit('output', stdout);
          if (stderr) socket.emit('output', stderr);
        }
        
        return { success: true, output: stdout + stderr };
      } catch (error) {
        if (socket) {
          socket.emit('output', `Error: ${error.message}\n`);
        }
        return { success: false, error: error.message };
      }
    } else {
      // Use existing terminal for local development
      // Return false to indicate fallback to node-pty
      return false;
    }
  }

  /**
   * Check if terminal is available
   */
  isTerminalAvailable() {
    try {
      require('node-pty');
      return !this.isCloudEnvironment;
    } catch {
      return false;
    }
  }

  /**
   * Get storage path based on environment
   */
  getStoragePath() {
    if (this.isCloudEnvironment) {
      // Use /tmp for cloud environments (temporary)
      // In production, you'd use S3 or similar
      return process.env.CLOUD_STORAGE_PATH || '/tmp/projects';
    }
    return './client/user-projects';
  }

  /**
   * Adapt file operations for cloud
   */
  async ensureStorageExists() {
    const fs = require('fs/promises');
    const path = this.getStoragePath();
    
    try {
      await fs.mkdir(path, { recursive: true });
      return true;
    } catch (error) {
      console.error('Failed to create storage directory:', error);
      return false;
    }
  }
}

module.exports = new DeploymentAdapter();