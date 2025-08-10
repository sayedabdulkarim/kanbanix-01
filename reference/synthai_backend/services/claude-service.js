// Claude Service using Anthropic SDK directly
const Anthropic = require('@anthropic-ai/sdk');
require("dotenv").config();

class ClaudeServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClaudeServiceError";
  }
}

class ClaudeService {
  constructor(apiKey = null) {
    // In production mode, API key can be provided per request
    const isProduction = process.env.NODE_ENV === 'production';
    
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY;
    
    // Only require API key in development mode
    if (!isProduction && !this.apiKey) {
      throw new ClaudeServiceError(
        "ANTHROPIC_API_KEY environment variable not set"
      );
    }

    // Initialize Anthropic client if API key is available
    if (this.apiKey) {
      this.anthropic = new Anthropic({
        apiKey: this.apiKey,
      });
    }

    // Initialize memory to store previous generations (same as original)
    this.memory = {};
    this.memoryLimit = 5; // Store the last 5 generations
  }

  // Set API key dynamically (for production mode)
  setApiKey(apiKey) {
    this.apiKey = apiKey;
    this.anthropic = new Anthropic({
      apiKey: this.apiKey,
    });
  }

  // Save the prompt and response to memory
  _saveToMemory(prompt, response) {
    // Create a simple hash of the prompt as a key
    const key = String(
      prompt.split("").reduce((a, b) => {
        a = (a << 5) - a + b.charCodeAt(0);
        return a & a;
      }, 0)
    );

    this.memory[key] = response;

    // Keep memory within the limit
    const keys = Object.keys(this.memory);
    if (keys.length > this.memoryLimit) {
      // Remove the oldest entry
      delete this.memory[keys[0]];
    }

    console.debug(
      `Saved generation to memory. Memory size: ${
        Object.keys(this.memory).length
      }`
    );
  }

  // Check if the prompt is requesting a modification to an existing UI
  _isModificationRequest(prompt) {
    const modificationKeywords = [
      "add",
      "change",
      "modify",
      "update",
      "remove",
      "delete",
      "reset button",
      "alter",
      "adjust",
      "extend",
      "enhance",
    ];

    const promptLower = prompt.toLowerCase();
    return modificationKeywords.some((keyword) =>
      promptLower.includes(keyword)
    );
  }

  // Get the most recent response from memory
  _getLatestResponse() {
    const keys = Object.keys(this.memory);
    if (keys.length === 0) {
      return null;
    }

    // Return the most recently added response
    return this.memory[keys[keys.length - 1]];
  }

  // Build a prompt that includes context from memory if this is a modification request
  _buildPromptWithMemory(prompt) {
    const latestResponse = this._getLatestResponse();

    if (!latestResponse || !this._isModificationRequest(prompt)) {
      // If no memory or not a modification request, return the standard prompt
      return `You are a UI development expert. Create a complete implementation for this requirement: '${prompt}'

Return only the code in three blocks:
\`\`\`html
[Your HTML code here]
\`\`\`

\`\`\`css
[Your CSS code here]
\`\`\`

\`\`\`javascript
[Your JavaScript code here]
\`\`\`

Make the code clean, modern, and production-ready. Include proper styling and interactivity.`;
    }

    // For modification requests, include the previous implementation
    return `You are a UI development expert. You previously created this implementation:

HTML:
\`\`\`html
${latestResponse.html || ""}
\`\`\`

CSS:
\`\`\`css
${latestResponse.css || ""}
\`\`\`

JavaScript:
\`\`\`javascript
${latestResponse.javascript || ""}
\`\`\`

Now, modify the existing implementation to meet this new requirement: '${prompt}'

Return the COMPLETE UPDATED code in the same three blocks:
\`\`\`html
[Your updated HTML code here]
\`\`\`

\`\`\`css
[Your updated CSS code here]
\`\`\`

\`\`\`javascript
[Your updated JavaScript code here]
\`\`\`

Make sure to preserve the existing functionality while adding the requested changes. Make the code clean, modern, and production-ready.`;
  }

  // Generate text using Claude API directly
  async generateText(prompt) {
    if (!this.anthropic) {
      throw new ClaudeServiceError(
        "Claude API client not initialized. Please provide an API key."
      );
    }
    
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const message = await this.anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 2000,
          temperature: 0.7,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        });

        if (!message.content || !message.content[0] || !message.content[0].text) {
          throw new ClaudeServiceError(
            "Invalid response format from Claude API"
          );
        }

        return message.content[0].text;
      } catch (error) {
        console.error(`Error on attempt ${attempt + 1}:`, error.message);

        if (attempt < maxRetries - 1) {
          const waitTime = (attempt + 1) * 5000; // Progressive retry delay in ms
          console.warn(`Retrying in ${waitTime / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

        throw new ClaudeServiceError(`Error generating text: ${error.message}`);
      }
    }
  }

  // Extract code blocks from the generated text
  _extractCodeBlocks(text) {
    if (typeof text !== "string") {
      throw new Error("Generated code must be a string");
    }

    function extractBlock(pattern) {
      const regex = new RegExp(pattern, "is");
      const matches = text.match(regex);
      return matches ? matches[1].trim() : null;
    }

    const html = extractBlock(/```html\s*([\s\S]*?)\s*```/);
    const css = extractBlock(/```css\s*([\s\S]*?)\s*```/);
    const javascript = extractBlock(/```javascript\s*([\s\S]*?)\s*```/);

    if (!html && !css && !javascript) {
      throw new Error("No code blocks found in generated text");
    }

    return {
      html: html || "",
      css: css || "",
      javascript: javascript || "",
    };
  }

  // Generate UI code based on the requirement
  async generate(prompt) {
    try {
      const structuredPrompt = this._buildPromptWithMemory(prompt);

      // Enhance the prompt to emphasize the need for all three code blocks
      const enhancedPrompt = `${structuredPrompt}

IMPORTANT: You must provide all three code blocks - HTML, CSS, and JavaScript.
Even if you think a section might be minimal, please provide appropriate code for each section.
Do not leave any section empty.

Example structure:
\`\`\`html
<!-- Your HTML code here -->
\`\`\`

\`\`\`css
/* Your CSS code here, including proper styling for all HTML elements */
\`\`\`

\`\`\`javascript
// Your JavaScript code here, including event handlers and functionality
\`\`\`
`;

      console.debug("Sending request to Claude API");

      // Generate the response
      const response = await this.generateText(enhancedPrompt);

      // Extract code blocks
      try {
        const result = this._extractCodeBlocks(response);

        // Ensure we have at least minimal content for each section
        if (!result.css) {
          result.css =
            "/* Default styles for TODO app */\nbody {\n  font-family: Arial, sans-serif;\n  margin: 0;\n  padding: 20px;\n}\n";
        }

        if (!result.javascript) {
          result.javascript =
            "// Basic functionality for TODO app\ndocument.addEventListener('DOMContentLoaded', function() {\n  console.log('TODO app initialized');\n});\n";
        }

        // Save the result to memory
        this._saveToMemory(prompt, result);

        return result;
      } catch (error) {
        throw new ClaudeServiceError(
          `Failed to extract code blocks: ${error.message}`
        );
      }
    } catch (error) {
      throw new ClaudeServiceError(`Error generating code: ${error.message}`);
    }
  }

  // Generate UI code files based on the requirement
  async generateUI(requirement) {
    const prompt = `
    Create a complete implementation for this requirement: '${requirement}'
    
    Return ONLY a JSON object with exactly this structure:
    {
        "index.html": "<complete HTML code here>",
        "style.css": "/* complete CSS code here */",
        "script.js": "// complete JavaScript code here"
    }
    
    The code should be production-ready and fully functional.
    Do not include any explanations or markdown formatting.
    Return only the JSON object.
    `;

    try {
      // Generate the response
      const response = await this.generateText(prompt);

      // Parse the JSON response
      try {
        // Look for a valid JSON object in the response
        const jsonMatch = response.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          throw new ClaudeServiceError("No valid JSON found in response");
        }

        const files = JSON.parse(jsonMatch[0]);

        // Validate the response structure
        const requiredFiles = ["index.html", "style.css", "script.js"];
        const missingFiles = requiredFiles.filter((file) => !files[file]);

        if (missingFiles.length > 0) {
          throw new ClaudeServiceError(
            `Invalid response structure: missing required files: ${missingFiles.join(
              ", "
            )}`
          );
        }

        return files;
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new ClaudeServiceError(
            `Failed to parse LLM response as JSON: ${error.message}`
          );
        }
        throw error;
      }
    } catch (error) {
      throw new ClaudeServiceError(`UI generation failed: ${error.message}`);
    }
  }
}

// Export both the class and an instance to maintain compatibility
module.exports = { ClaudeService, ClaudeServiceError, LLMService: ClaudeService, LLMServiceError: ClaudeServiceError };