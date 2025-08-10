const net = require('net');

/**
 * Check if a port is available
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} - True if port is available
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    
    server.listen(port);
  });
}

/**
 * Find an available port starting from a base port
 * @param {number} basePort - Starting port number
 * @param {number} maxAttempts - Maximum number of ports to try
 * @returns {Promise<number>} - Available port number
 */
async function findAvailablePort(basePort = 3000, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = basePort + i;
    const available = await isPortAvailable(port);
    
    if (available) {
      console.log(`Found available port: ${port}`);
      return port;
    }
    
    console.log(`Port ${port} is in use, trying next...`);
  }
  
  throw new Error(`Could not find an available port after ${maxAttempts} attempts starting from ${basePort}`);
}

module.exports = {
  isPortAvailable,
  findAvailablePort
};