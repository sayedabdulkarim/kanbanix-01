/**
 * Simple in-memory storage for user API keys
 * Maps socketId to API key for the duration of the connection
 */

// Store API keys by socket ID
const socketToApiKey = new Map();

/**
 * Store API key for a socket connection
 * @param {string} socketId - Socket connection ID
 * @param {string} apiKey - User's Anthropic API key
 */
function setApiKey(socketId, apiKey) {
  if (!socketId || !apiKey) {
    throw new Error('Both socketId and apiKey are required');
  }
  
  socketToApiKey.set(socketId, {
    key: apiKey,
    timestamp: Date.now(),
    requestCount: 0
  });
  
  console.log(`API key stored for socket: ${socketId}`);
}

/**
 * Retrieve API key for a socket connection
 * @param {string} socketId - Socket connection ID
 * @returns {string|null} - API key or null if not found
 */
function getApiKey(socketId) {
  if (!socketId) {
    return null;
  }
  
  const stored = socketToApiKey.get(socketId);
  if (stored) {
    // Increment request count for analytics
    stored.requestCount++;
    return stored.key;
  }
  
  return null;
}

/**
 * Remove API key when socket disconnects
 * @param {string} socketId - Socket connection ID
 */
function removeApiKey(socketId) {
  if (socketId && socketToApiKey.has(socketId)) {
    console.log(`API key removed for socket: ${socketId}`);
    socketToApiKey.delete(socketId);
  }
}

/**
 * Get API key with fallback for development mode
 * @param {string} socketId - Socket connection ID
 * @returns {string|null} - API key from storage or environment variable
 */
function getApiKeyWithFallback(socketId) {
  // First try to get user's key from storage
  const userKey = getApiKey(socketId);
  if (userKey) {
    return userKey;
  }
  
  // Check if we're forcing production mode for testing
  const isProduction = process.env.NODE_ENV === 'production' || process.env.FORCE_PRODUCTION_MODE === 'true';
  
  // In development mode, fallback to environment variable
  if (!isProduction && process.env.ANTHROPIC_API_KEY) {
    console.log('Using fallback API key from environment (development mode)');
    return process.env.ANTHROPIC_API_KEY;
  }
  
  if (isProduction) {
    console.log('Production mode: No API key fallback - user must provide key');
  }
  
  // In production, no fallback - user must provide key
  return null;
}

/**
 * Check if socket has a valid API key
 * @param {string} socketId - Socket connection ID
 * @returns {boolean} - True if key exists
 */
function hasApiKey(socketId) {
  return socketToApiKey.has(socketId);
}

/**
 * Get storage statistics (for debugging)
 * @returns {object} - Storage stats
 */
function getStats() {
  return {
    totalKeys: socketToApiKey.size,
    connections: Array.from(socketToApiKey.entries()).map(([socketId, data]) => ({
      socketId: socketId.substring(0, 8) + '...', // Partial ID for privacy
      timestamp: data.timestamp,
      requestCount: data.requestCount,
      age: Date.now() - data.timestamp
    }))
  };
}

/**
 * Cleanup old connections (optional, for long-running servers)
 * @param {number} maxAge - Maximum age in milliseconds (default: 24 hours)
 */
function cleanup(maxAge = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [socketId, data] of socketToApiKey.entries()) {
    if (now - data.timestamp > maxAge) {
      socketToApiKey.delete(socketId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} old API key entries`);
  }
  
  return cleaned;
}

module.exports = {
  setApiKey,
  getApiKey,
  removeApiKey,
  getApiKeyWithFallback,
  hasApiKey,
  getStats,
  cleanup
};