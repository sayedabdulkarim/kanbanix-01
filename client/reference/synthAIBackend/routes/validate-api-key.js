const express = require('express');
const { Anthropic } = require('@anthropic-ai/sdk');

const router = express.Router();

// POST /api/validate-key - Validate user's Anthropic API key
router.post('/validate-key', async (req, res) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({
        valid: false,
        message: 'API key is required'
      });
    }

    // Basic format validation
    if (!apiKey.startsWith('sk-ant-api') || apiKey.length < 20) {
      return res.status(400).json({
        valid: false,
        message: 'Invalid API key format. Key should start with "sk-ant-api"'
      });
    }

    // Test the API key with a simple message to Anthropic
    const anthropic = new Anthropic({
      apiKey: apiKey,
    });

    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307', // Using cheapest model for validation
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Hi'
          }
        ]
      });

      // If we get here, the API key is valid
      return res.json({
        valid: true,
        message: 'API key validated successfully',
        model: 'claude-3-haiku-20240307'
      });

    } catch (anthropicError) {
      // Handle specific Anthropic API errors
      console.error('Anthropic API validation error:', anthropicError);
      
      let errorMessage = 'Invalid API key';
      
      if (anthropicError.status === 401) {
        errorMessage = 'Invalid API key. Please check your key and try again.';
      } else if (anthropicError.status === 403) {
        errorMessage = 'API key does not have sufficient permissions.';
      } else if (anthropicError.status === 429) {
        errorMessage = 'API key rate limit exceeded. Please try again later.';
      } else if (anthropicError.status === 400) {
        errorMessage = 'API key format is invalid.';
      } else if (anthropicError.message) {
        errorMessage = `API validation failed: ${anthropicError.message}`;
      }

      return res.status(anthropicError.status || 400).json({
        valid: false,
        message: errorMessage,
        status: anthropicError.status
      });
    }

  } catch (error) {
    console.error('API key validation error:', error);
    return res.status(500).json({
      valid: false,
      message: 'Server error during validation. Please try again.',
      error: error.message
    });
  }
});

module.exports = router;