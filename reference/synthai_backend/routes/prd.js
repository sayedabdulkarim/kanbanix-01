// Router for PRD endpoints
const express = require("express");
const router = express.Router();
const { PRDService } = require("../services/prd-service");
const { AgentService } = require("../services/agent-service");
const apiKeyStorage = require("../services/api-key-storage");

// Generate a PRD based on the user's requirement
router.post("/generate-prd", async (req, res) => {
  try {
    const { requirement, socketId } = req.body;

    if (!requirement || !requirement.trim()) {
      return res.status(400).json({ error: "Requirement cannot be empty" });
    }

    // Get API key from storage using socketId
    const apiKey = apiKeyStorage.getApiKeyWithFallback(socketId);
    
    if (!apiKey) {
      return res.status(401).json({ 
        error: "API key required. Please provide your Anthropic API key." 
      });
    }

    // Create PRD service with the user's API key
    const prdService = new PRDService(apiKey);
    const prd = await prdService.generatePRD(requirement);
    return res.status(200).json({ prd });
  } catch (error) {
    console.error(`Error in generate-prd: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Process approved PRD to generate UI
router.post("/approve-prd", async (req, res) => {
  try {
    const { requirement, prd, approved, socketId } = req.body;

    if (!approved) {
      return res.status(400).json({ error: "PRD was not approved" });
    }

    // Get API key from storage using socketId
    const apiKey = apiKeyStorage.getApiKeyWithFallback(socketId);
    
    if (!apiKey) {
      return res.status(401).json({ 
        error: "API key required. Please provide your Anthropic API key." 
      });
    }

    // Create agent service with the user's API key
    const agentService = new AgentService(apiKey);
    
    // Process the requirement through the agent service
    const result = await agentService.processRequirement(requirement);
    console.debug(`Generated UI result: ${JSON.stringify(result)}`);

    return res.status(200).json(result);
  } catch (error) {
    if (error.name === "LLMServiceError") {
      return res.status(503).json({ error: error.message });
    }

    console.error(`Error in approve-prd: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
