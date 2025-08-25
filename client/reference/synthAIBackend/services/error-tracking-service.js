/**
 * Error Tracking Service
 * Tracks and learns from generation errors to prevent repeated issues
 */

const fs = require('fs').promises;
const path = require('path');

class ErrorTrackingService {
  constructor() {
    this.errorLogPath = path.join(__dirname, '../logs/generation-errors.json');
    this.knownFixes = this.loadKnownFixes();
  }

  /**
   * Load known error patterns and their fixes
   */
  loadKnownFixes() {
    return {
      // Pattern: Error message regex -> Fix action
      "You're importing a component that needs.*useState": {
        pattern: /You're importing a component that needs.*useState/,
        fix: "add_use_client",
        description: "Add 'use client' directive to top of file"
      },
      "Module.*has no exported member": {
        pattern: /Module.*has no exported member '(.+)'/,
        fix: "add_missing_export",
        description: "Add missing export to source file"
      },
      "Cannot find module": {
        pattern: /Cannot find module '(.+)'/,
        fix: "check_import_path",
        description: "Verify import path and file existence"
      },
      "Type.*is not assignable": {
        pattern: /Type '(.+)' is not assignable to type '(.+)'/,
        fix: "fix_type_mismatch",
        description: "Align types between components"
      },
      "@tailwindcss/postcss": {
        pattern: /@tailwindcss\/postcss/,
        fix: "update_postcss_config",
        description: "Update PostCSS config for Tailwind v4"
      }
    };
  }

  /**
   * Log an error occurrence
   */
  async logError(projectId, error, context) {
    try {
      let errorLog = {};
      
      try {
        const existing = await fs.readFile(this.errorLogPath, 'utf-8');
        errorLog = JSON.parse(existing);
      } catch (e) {
        // File doesn't exist yet
      }

      if (!errorLog[projectId]) {
        errorLog[projectId] = [];
      }

      errorLog[projectId].push({
        timestamp: new Date().toISOString(),
        error: error.substring(0, 500), // Limit error message size
        context: context,
        resolved: false
      });

      // Keep only last 100 errors per project
      if (errorLog[projectId].length > 100) {
        errorLog[projectId] = errorLog[projectId].slice(-100);
      }

      await fs.mkdir(path.dirname(this.errorLogPath), { recursive: true });
      await fs.writeFile(this.errorLogPath, JSON.stringify(errorLog, null, 2));
    } catch (e) {
      console.error('Failed to log error:', e);
    }
  }

  /**
   * Get suggested fix for an error
   */
  getSuggestedFix(errorMessage) {
    for (const [key, fixInfo] of Object.entries(this.knownFixes)) {
      if (fixInfo.pattern.test(errorMessage)) {
        return {
          fixType: fixInfo.fix,
          description: fixInfo.description,
          pattern: key
        };
      }
    }
    return null;
  }

  /**
   * Get error statistics
   */
  async getErrorStats() {
    try {
      const errorLog = JSON.parse(await fs.readFile(this.errorLogPath, 'utf-8'));
      const stats = {
        totalProjects: Object.keys(errorLog).length,
        totalErrors: 0,
        commonErrors: {},
        recentErrors: []
      };

      for (const [projectId, errors] of Object.entries(errorLog)) {
        stats.totalErrors += errors.length;
        
        // Track common error patterns
        errors.forEach(error => {
          const fix = this.getSuggestedFix(error.error);
          if (fix) {
            stats.commonErrors[fix.pattern] = (stats.commonErrors[fix.pattern] || 0) + 1;
          }
        });
      }

      // Get 10 most recent errors across all projects
      const allErrors = Object.values(errorLog).flat();
      stats.recentErrors = allErrors
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 10);

      return stats;
    } catch (e) {
      return {
        totalProjects: 0,
        totalErrors: 0,
        commonErrors: {},
        recentErrors: []
      };
    }
  }

  /**
   * Mark an error as resolved
   */
  async markResolved(projectId, errorIndex) {
    try {
      const errorLog = JSON.parse(await fs.readFile(this.errorLogPath, 'utf-8'));
      if (errorLog[projectId] && errorLog[projectId][errorIndex]) {
        errorLog[projectId][errorIndex].resolved = true;
        await fs.writeFile(this.errorLogPath, JSON.stringify(errorLog, null, 2));
      }
    } catch (e) {
      console.error('Failed to mark error as resolved:', e);
    }
  }

  /**
   * Generate report of common issues
   */
  async generateReport() {
    const stats = await this.getErrorStats();
    
    console.log('\n📊 Error Tracking Report');
    console.log('=' .repeat(50));
    console.log(`Total Projects: ${stats.totalProjects}`);
    console.log(`Total Errors: ${stats.totalErrors}`);
    console.log('\nMost Common Errors:');
    
    const sortedErrors = Object.entries(stats.commonErrors)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    
    sortedErrors.forEach(([pattern, count]) => {
      const fix = this.knownFixes[pattern];
      console.log(`\n  ${pattern}:`);
      console.log(`    Occurrences: ${count}`);
      console.log(`    Fix: ${fix.description}`);
    });
    
    if (stats.recentErrors.length > 0) {
      console.log('\n\nRecent Errors:');
      stats.recentErrors.slice(0, 3).forEach(error => {
        console.log(`\n  ${new Date(error.timestamp).toLocaleString()}`);
        console.log(`  ${error.error.substring(0, 100)}...`);
        console.log(`  Resolved: ${error.resolved ? 'Yes' : 'No'}`);
      });
    }
    
    console.log('\n' + '=' .repeat(50));
    
    return stats;
  }
}

module.exports = ErrorTrackingService;

// Example usage
if (require.main === module) {
  const tracker = new ErrorTrackingService();
  tracker.generateReport().catch(console.error);
}