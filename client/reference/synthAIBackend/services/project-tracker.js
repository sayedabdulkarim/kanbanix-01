const fs = require('fs').promises;
const path = require('path');

class ProjectTracker {
  constructor() {
    // In-memory cache
    this.projects = new Map();
    
    // File path for persistence (in production, this could be a database)
    this.persistencePath = path.join(
      process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
      'running-projects.json'
    );
    
    // Load persisted data on startup
    this.loadPersistedData();
    
    // Periodically save to disk
    setInterval(() => this.persistData(), 30000); // Every 30 seconds
  }
  
  async loadPersistedData() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.persistencePath);
      await fs.mkdir(dataDir, { recursive: true });
      
      // Try to load existing data
      const data = await fs.readFile(this.persistencePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Restore projects that are still valid
      for (const [name, info] of Object.entries(parsed)) {
        // Check if the project is actually still running by checking the port
        if (await this.isPortInUse(info.port)) {
          this.projects.set(name, {
            ...info,
            startTime: new Date(info.startTime)
          });
          console.log(`Restored running project: ${name} on port ${info.port}`);
        }
      }
    } catch (error) {
      // File doesn't exist or is invalid, start fresh
      console.log('No persisted project data found, starting fresh');
    }
  }
  
  async persistData() {
    try {
      const dataDir = path.dirname(this.persistencePath);
      await fs.mkdir(dataDir, { recursive: true });
      
      // Convert Map to object for JSON serialization
      const data = {};
      for (const [name, info] of this.projects) {
        // Don't persist the process object
        const { process, ...infoWithoutProcess } = info;
        data[name] = infoWithoutProcess;
      }
      
      await fs.writeFile(this.persistencePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error persisting project data:', error);
    }
  }
  
  async isPortInUse(port) {
    const net = require('net');
    return new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            resolve(true);  // Port in use
          } else {
            resolve(false); // Other error, assume port is free
          }
        })
        .once('listening', () => {
          tester.once('close', () => resolve(false))  // Port free
            .close();
        })
        .listen(port, '0.0.0.0');  // Listen on all interfaces
    });
  }
  
  addProject(name, info) {
    this.projects.set(name, info);
    this.persistData(); // Save immediately when adding
  }
  
  removeProject(name) {
    this.projects.delete(name);
    this.persistData(); // Save immediately when removing
  }
  
  getProject(name) {
    return this.projects.get(name);
  }
  
  getAllProjects() {
    const projects = [];
    for (const [name, info] of this.projects) {
      projects.push({
        name,
        port: info.port,
        url: info.url,
        projectPath: info.projectPath,
        startTime: info.startTime
      });
    }
    return projects;
  }
  
  hasProject(name) {
    return this.projects.has(name);
  }
  
  // Clean up stale projects (ports no longer in use)
  async cleanupStaleProjects() {
    for (const [name, info] of this.projects) {
      if (!(await this.isPortInUse(info.port))) {
        console.log(`Removing stale project: ${name} (port ${info.port} no longer in use)`);
        this.removeProject(name);
      }
    }
  }
}

// Create singleton instance
const projectTracker = new ProjectTracker();

// Periodically clean up stale projects
setInterval(() => {
  projectTracker.cleanupStaleProjects();
}, 300000); // Every 5 minutes (less aggressive)

module.exports = projectTracker;