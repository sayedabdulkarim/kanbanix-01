/**
 * Frontend validation functions
 * These can be used in the React app before making API calls
 */

class FrontendValidator {
  /**
   * Validate requirement before sending to API
   */
  static validateRequirement(requirement) {
    const errors = [];
    
    // Check if empty
    if (!requirement || requirement.trim().length === 0) {
      errors.push('Requirement cannot be empty');
    }
    
    // Check minimum length
    if (requirement && requirement.trim().length < 10) {
      errors.push('Requirement too short (minimum 10 characters)');
    }
    
    // Check maximum length
    if (requirement && requirement.length > 1000) {
      errors.push('Requirement too long (maximum 1000 characters)');
    }
    
    // Check for suspicious content
    const suspicious = ['<script', 'javascript:', 'onclick', 'onerror'];
    if (requirement && suspicious.some(s => requirement.toLowerCase().includes(s))) {
      errors.push('Requirement contains invalid content');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Determine project type and validate support
   */
  static analyzeRequirement(requirement) {
    const analysis = {
      type: 'unknown',
      confidence: 0,
      features: [],
      warnings: []
    };
    
    const lowerReq = requirement.toLowerCase();
    
    // Detect project type
    if (lowerReq.includes('counter')) {
      analysis.type = 'counter-app';
      analysis.confidence = 0.9;
      analysis.features = ['increment', 'decrement', 'display', 'reset'];
    } else if (lowerReq.includes('todo') || lowerReq.includes('task')) {
      analysis.type = 'todo-app';
      analysis.confidence = 0.9;
      analysis.features = ['add tasks', 'complete tasks', 'delete tasks', 'list tasks'];
    } else if (lowerReq.includes('blog')) {
      analysis.type = 'blog-app';
      analysis.confidence = 0.8;
      analysis.features = ['posts', 'categories', 'comments'];
    } else if (lowerReq.includes('dashboard')) {
      analysis.type = 'dashboard-app';
      analysis.confidence = 0.7;
      analysis.features = ['charts', 'metrics', 'data visualization'];
    } else {
      analysis.type = 'custom-app';
      analysis.confidence = 0.5;
      analysis.warnings.push('Custom app type - results may vary');
    }
    
    // Check for complex features that might not work well
    const complexFeatures = ['authentication', 'database', 'api', 'backend', 'server'];
    const foundComplex = complexFeatures.filter(f => lowerReq.includes(f));
    
    if (foundComplex.length > 0) {
      analysis.warnings.push(`Complex features detected: ${foundComplex.join(', ')}. These may require manual implementation.`);
      analysis.confidence *= 0.7;
    }
    
    return analysis;
  }

  /**
   * Pre-flight check summary
   */
  static runPreFlightCheck(requirement) {
    const validation = this.validateRequirement(requirement);
    const analysis = this.analyzeRequirement(requirement);
    
    const canProceed = validation.valid && analysis.confidence > 0.5;
    
    return {
      canProceed,
      validation,
      analysis,
      recommendations: this.getRecommendations(analysis)
    };
  }

  /**
   * Get recommendations based on analysis
   */
  static getRecommendations(analysis) {
    const recommendations = [];
    
    if (analysis.confidence < 0.7) {
      recommendations.push('Consider being more specific about your requirements');
    }
    
    if (analysis.type === 'custom-app') {
      recommendations.push('For best results, try starting with a known template (counter, todo, blog)');
    }
    
    if (analysis.warnings.length > 0) {
      recommendations.push('Some features may need manual implementation after generation');
    }
    
    return recommendations;
  }
}

// Example usage in React component:
/*
const handleSubmit = (requirement) => {
  const check = FrontendValidator.runPreFlightCheck(requirement);
  
  if (!check.canProceed) {
    // Show errors to user
    console.error('Validation failed:', check.validation.errors);
    return;
  }
  
  // Show warnings if any
  if (check.analysis.warnings.length > 0) {
    console.warn('Warnings:', check.analysis.warnings);
  }
  
  // Proceed with API call
  generateProject(requirement);
};
*/

// For Node.js testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FrontendValidator;
}

// Test examples
if (require.main === module) {
  const testCases = [
    'Create a counter app',
    'Build a todo application with authentication',
    'Make a blog',
    '',
    'x',
    'Create a dashboard with real-time data from database API'
  ];
  
  console.log('Frontend Validation Test Results:\n');
  
  testCases.forEach(req => {
    console.log(`\nRequirement: "${req}"`);
    const result = FrontendValidator.runPreFlightCheck(req);
    
    console.log(`Can proceed: ${result.canProceed ? '✅' : '❌'}`);
    if (!result.validation.valid) {
      console.log(`Errors: ${result.validation.errors.join(', ')}`);
    }
    console.log(`Type: ${result.analysis.type} (confidence: ${result.analysis.confidence})`);
    if (result.analysis.warnings.length > 0) {
      console.log(`Warnings: ${result.analysis.warnings.join('; ')}`);
    }
    if (result.recommendations.length > 0) {
      console.log(`Recommendations: ${result.recommendations.join('; ')}`);
    }
  });
}