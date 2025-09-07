/**
 * Intent Detection Service
 * Uses LLM to intelligently determine the user's intent from task descriptions
 * Falls back to keyword matching if LLM is unavailable
 */

import Anthropic from '@anthropic-ai/sdk';

export interface IntentDetectionResult {
  agentType: string;
  confidence: number;
  reasoning: string;
  method: 'llm' | 'keywords';
}

class IntentDetectionService {
  private anthropic: Anthropic | null = null;

  constructor() {
    // Initialize Anthropic client if API key is available
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
  }

  /**
   * Main method to detect intent - uses LLM if available, falls back to keywords
   */
  async detectIntent(
    title: string,
    description: string = '',
    useLLM: boolean = true
  ): Promise<IntentDetectionResult> {
    // Try LLM first if enabled and available
    if (useLLM && this.anthropic) {
      try {
        const llmResult = await this.detectIntentWithLLM(title, description);
        
        // Only use LLM result if confidence is high enough
        if (llmResult.confidence >= 70) {
          console.log(`[Intent Detection] LLM result: ${llmResult.agentType} (${llmResult.confidence}% confidence)`);
          return llmResult;
        }
        
        console.log(`[Intent Detection] LLM confidence too low (${llmResult.confidence}%), falling back to keywords`);
      } catch (error) {
        console.warn('[Intent Detection] LLM failed, falling back to keywords:', error);
      }
    }

    // Fallback to improved keyword matching
    return this.detectIntentWithKeywords(title, description);
  }

  /**
   * LLM-based intent detection using Claude
   */
  private async detectIntentWithLLM(
    title: string,
    description: string
  ): Promise<IntentDetectionResult> {
    const prompt = `Analyze this task and determine the user's PRIMARY INTENT.

Task Title: "${title}"
Description: "${description || 'No description provided'}"

Available agent types and their purposes:
1. code_generator - User wants to CREATE new code, components, features, or ADD/MODIFY UI elements (including text, descriptions, labels in the app)
2. bug_fixer - User wants to FIX existing broken code or resolve issues
3. testing - User wants to write or generate tests
4. documentation - User wants to create or update DOCUMENTATION FILES (README, API docs, code comments) - NOT UI text
5. refactoring - User wants to improve existing code without changing functionality
6. review - User wants code review or analysis

IMPORTANT RULES:
- Focus on the PRIMARY VERB/ACTION, not descriptive words
- "Create a broken component" → code_generator (CREATE action)
- "Fix the broken component" → bug_fixer (FIX action)
- "Add error handling" → code_generator (ADD action)
- "Debug the error" → bug_fixer (DEBUG action)
- "Add a description to the app" → code_generator (modifying UI)
- "Write documentation for the app" → documentation (creating docs)
- "Add a title/text/label to component" → code_generator (UI change)
- Default to code_generator for ambiguous cases

Respond with ONLY this JSON structure, no other text:
{
  "agentType": "one_of_the_agent_types_above",
  "confidence": 0-100,
  "reasoning": "brief explanation"
}`;

    try {
      const response = await this.anthropic!.messages.create({
        model: 'claude-3-haiku-20240307', // Use Haiku for fast, cheap intent detection
        max_tokens: 150,
        temperature: 0.3, // Lower temperature for more consistent results
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      // Parse the response
      const content = response.content[0];
      if (content.type === 'text') {
        try {
          const result = JSON.parse(content.text);
          return {
            agentType: result.agentType,
            confidence: result.confidence,
            reasoning: result.reasoning,
            method: 'llm'
          };
        } catch (parseError) {
          console.error('[Intent Detection] Failed to parse LLM response:', content.text);
          throw parseError;
        }
      }
    } catch (error) {
      console.error('[Intent Detection] LLM API error:', error);
      throw error;
    }

    throw new Error('Invalid LLM response format');
  }

  /**
   * Improved keyword-based intent detection
   * Now checks ACTION verbs first, then descriptive words
   */
  private detectIntentWithKeywords(
    title: string,
    description: string
  ): IntentDetectionResult {
    const content = (title + ' ' + description).toLowerCase();
    
    // Check for CREATE/ADD actions first (highest priority)
    if (content.match(/\b(create|add|implement|build|develop|make|write new|generate|design|construct)\b/)) {
      // Even if it mentions "broken" or "error", if the action is CREATE, it's code generation
      return {
        agentType: 'code_generator',
        confidence: 90,
        reasoning: 'CREATE/ADD action verb detected',
        method: 'keywords'
      };
    }
    
    // Check for FIX/DEBUG actions (second priority)
    if (content.match(/\b(fix|repair|debug|resolve|solve|patch|correct|troubleshoot)\b/)) {
      return {
        agentType: 'bug_fixer',
        confidence: 90,
        reasoning: 'FIX/DEBUG action verb detected',
        method: 'keywords'
      };
    }
    
    // Check for TEST actions
    if (content.match(/\b(test|testing|spec|unit test|integration test|e2e|coverage)\b/)) {
      return {
        agentType: 'testing',
        confidence: 85,
        reasoning: 'Testing keywords detected',
        method: 'keywords'
      };
    }
    
    // Check for DOCUMENTATION actions
    if (content.match(/\b(document|docs|readme|comment|documentation|explain|describe)\b/)) {
      return {
        agentType: 'documentation',
        confidence: 85,
        reasoning: 'Documentation keywords detected',
        method: 'keywords'
      };
    }
    
    // Check for REFACTOR actions
    if (content.match(/\b(refactor|improve|optimize|clean|reorganize|restructure)\b/)) {
      return {
        agentType: 'refactoring',
        confidence: 85,
        reasoning: 'Refactoring keywords detected',
        method: 'keywords'
      };
    }
    
    // Check for REVIEW actions
    if (content.match(/\b(review|analyze|audit|inspect|check|evaluate)\b/)) {
      return {
        agentType: 'review',
        confidence: 80,
        reasoning: 'Review keywords detected',
        method: 'keywords'
      };
    }
    
    // Fallback: Check for problem indicators without action verbs
    // Lower confidence since we're guessing based on description
    if (content.match(/\b(bug|error|issue|problem|broken|fail|crash)\b/)) {
      return {
        agentType: 'bug_fixer',
        confidence: 60,
        reasoning: 'Problem indicators found without clear action verb',
        method: 'keywords'
      };
    }
    
    // Default to code_generator for unknown tasks
    return {
      agentType: 'code_generator',
      confidence: 50,
      reasoning: 'No specific keywords found, defaulting to code generation',
      method: 'keywords'
    };
  }

  /**
   * Get all possible agent types for reference
   */
  static getAgentTypes() {
    return [
      'code_generator',
      'bug_fixer',
      'testing',
      'documentation',
      'refactoring',
      'review'
    ];
  }
}

// Export singleton instance
export const intentDetectionService = new IntentDetectionService();

// Export for testing or custom instances
export default IntentDetectionService;