// Router for generate endpoints
const express = require("express");
const router = express.Router();
const { AgentService } = require("../services/agent-service");

const agentService = new AgentService();

// Generate UI (HTML, CSS, JavaScript) based on the provided requirement
router.post("/approve-prd", async (req, res) => {
  try {
    const { requirement } = req.body;

    if (!requirement || !requirement.trim()) {
      return res.status(400).json({ error: "Requirement cannot be empty" });
    }

    // Process the requirement through the agent service
    const result = await agentService.processRequirement(requirement);

    // Pretty print for debugging
    console.debug("Generated code:\n" + JSON.stringify(result, null, 2));

    return res.status(200).json(result);
  } catch (error) {
    if (error.name === "LLMServiceError") {
      return res
        .status(503)
        .json({ error: `LLM service error: ${error.message}` });
    }

    console.error(`Unexpected error: ${error.message}`);
    return res
      .status(500)
      .json({ error: `An unexpected error occurred: ${error.message}` });
  }
});

module.exports = router;
