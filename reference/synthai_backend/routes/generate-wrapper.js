/**
 * Temporary wrapper to redirect old flow to new task-based flow
 * This allows us to test without changing frontend
 */
const express = require("express");
const router = express.Router();
const axios = require("axios");

// Override the /approve-prd endpoint to use new flow
router.post("/approve-prd", async (req, res) => {
  console.log("Redirecting /approve-prd to new task-based flow...");
  
  try {
    const { requirement, prd, approved } = req.body;
    
    // For now, we'll call the new generate-v2 endpoint
    // In the future, the frontend should call this directly
    const socketId = req.body.socketId || req.headers['x-socket-id'];
    
    // Call the new endpoint
    const response = await axios.post(
      "http://localhost:5001/api/generate-v2",
      { 
        requirement: requirement || prd, // Use requirement if available, otherwise use PRD
        socketId 
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Transform response to match old format
    const result = {
      ...response.data,
      generatedCode: {
        html: "<!-- Project generated successfully -->",
        css: "/* See generated files in project directory */",
        js: "// Project created with task-based generation"
      }
    };
    
    res.json(result);
  } catch (error) {
    console.error("Error in approve-prd wrapper:", error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ 
        error: error.message,
        details: "Failed to redirect to new generation flow"
      });
    }
  }
});

module.exports = router;