// PRD Service for generating Product Requirement Documents
const { LLMService } = require("./claude-service");

class PRDService {
  constructor(apiKey = null) {
    this.llmService = new LLMService(apiKey);
  }

  // Generate a PRD based on the user's requirement
  async generatePRD(requirement) {
    const prompt = `
    You are a skilled product manager. Based on this requirement: '${requirement}',
    create a clear, concise, and non-technical Product Requirements Document (PRD).
    
    IMPORTANT CONSTRAINTS - The application MUST be simple and use ONLY:
    - Basic React state management (useState, useContext)
    - Standard web features (no complex integrations)
    - Client-side functionality only
    - No external APIs or databases
    - No authentication or user accounts
    - No real-time features or websockets
    - No file uploads or complex forms
    
    Structure it as follows:

    1. Overview
    - Brief description of what needs to be built
    - The main goal and purpose
    - Keep it simple and achievable with basic React

    2. Core Features
    - List the key features and capabilities needed
    - Explain each feature in simple, non-technical terms
    - ONLY include features that can be built with React state and basic UI
    - DO NOT suggest features requiring:
      * External state management libraries
      * Backend APIs or databases
      * Authentication systems
      * File handling
      * Complex animations
      * Real-time updates

    3. User Experience
    - How users will interact with the feature
    - What the user should be able to do
    - Focus on simple, straightforward interactions
    - Use standard form inputs and buttons

    4. Requirements
    - List specific requirements and constraints
    - Any important behaviors or rules
    - Keep data in component state only
    - No persistent storage requirements

    Keep it concise and avoid any technical implementation details.
    Do NOT include sections about success metrics, analytics, or out-of-scope items.
    Write in a way that's easy for non-technical stakeholders to understand.
    
    Remember: This will be a simple, self-contained React application with no external dependencies.
    `;

    return await this.llmService.generateText(prompt);
  }
}

module.exports = { PRDService };
