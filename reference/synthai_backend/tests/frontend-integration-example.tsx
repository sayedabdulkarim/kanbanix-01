/**
 * Example React component showing how to integrate pre-flight validation
 * This can be added to the frontend to validate before API calls
 */

import React, { useState } from 'react';
import FrontendValidator from './frontend-validator';

const ProjectGenerator: React.FC = () => {
  const [requirement, setRequirement] = useState('');
  const [validationResult, setValidationResult] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleValidate = () => {
    const result = FrontendValidator.runPreFlightCheck(requirement);
    setValidationResult(result);
    return result;
  };

  const handleGenerate = async () => {
    // Run validation first
    const validation = handleValidate();
    
    if (!validation.canProceed) {
      // Don't proceed if validation fails
      return;
    }

    // Show confirmation for warnings
    if (validation.analysis.warnings.length > 0) {
      const proceed = window.confirm(
        `Warning:\n${validation.analysis.warnings.join('\n')}\n\nDo you want to continue?`
      );
      if (!proceed) return;
    }

    // Proceed with API call
    setIsGenerating(true);
    try {
      // Your existing API call
      const response = await fetch('http://localhost:5001/generate-prd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement })
      });
      
      if (!response.ok) {
        throw new Error('Generation failed');
      }
      
      const result = await response.json();
      // Handle success
      console.log('Generated:', result);
      
    } catch (error) {
      console.error('Generation error:', error);
      alert('Failed to generate project. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="project-generator">
      <h2>Generate New Project</h2>
      
      <div className="input-section">
        <textarea
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          placeholder="Describe your project (e.g., 'Create a counter app')"
          className="requirement-input"
          rows={4}
        />
        
        <div className="button-group">
          <button 
            onClick={handleValidate}
            className="validate-btn"
          >
            Validate
          </button>
          
          <button 
            onClick={handleGenerate}
            disabled={isGenerating}
            className="generate-btn"
          >
            {isGenerating ? 'Generating...' : 'Generate Project'}
          </button>
        </div>
      </div>

      {validationResult && (
        <div className={`validation-results ${validationResult.canProceed ? 'valid' : 'invalid'}`}>
          <h3>Validation Results</h3>
          
          {/* Validation Status */}
          <div className="status">
            Status: {validationResult.canProceed ? '✅ Ready' : '❌ Not Ready'}
          </div>

          {/* Errors */}
          {validationResult.validation.errors.length > 0 && (
            <div className="errors">
              <h4>Errors:</h4>
              <ul>
                {validationResult.validation.errors.map((error: string, i: number) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Project Analysis */}
          <div className="analysis">
            <h4>Analysis:</h4>
            <p>Project Type: {validationResult.analysis.type}</p>
            <p>Confidence: {(validationResult.analysis.confidence * 100).toFixed(0)}%</p>
            {validationResult.analysis.features.length > 0 && (
              <p>Features: {validationResult.analysis.features.join(', ')}</p>
            )}
          </div>

          {/* Warnings */}
          {validationResult.analysis.warnings.length > 0 && (
            <div className="warnings">
              <h4>Warnings:</h4>
              <ul>
                {validationResult.analysis.warnings.map((warning: string, i: number) => (
                  <li key={i}>⚠️ {warning}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {validationResult.recommendations.length > 0 && (
            <div className="recommendations">
              <h4>Recommendations:</h4>
              <ul>
                {validationResult.recommendations.map((rec: string, i: number) => (
                  <li key={i}>💡 {rec}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectGenerator;

// CSS (add to your styles)
/*
.project-generator {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
}

.requirement-input {
  width: 100%;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 16px;
}

.button-group {
  margin-top: 10px;
  display: flex;
  gap: 10px;
}

.validate-btn, .generate-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
}

.validate-btn {
  background: #6c757d;
  color: white;
}

.generate-btn {
  background: #007bff;
  color: white;
}

.generate-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.validation-results {
  margin-top: 20px;
  padding: 15px;
  border-radius: 4px;
  border: 1px solid #ddd;
}

.validation-results.valid {
  border-color: #28a745;
  background: #f8f9fa;
}

.validation-results.invalid {
  border-color: #dc3545;
  background: #fff5f5;
}

.errors {
  color: #dc3545;
}

.warnings {
  color: #ffc107;
}

.recommendations {
  color: #17a2b8;
}
*/