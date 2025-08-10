#!/usr/bin/env node

/**
 * Run pre-flight checks before API calls
 * Usage: node run-preflight-check.js "Create a counter app"
 */

const AgentServiceValidator = require('./agent-service-validator');

async function main() {
  const requirement = process.argv[2];
  
  if (!requirement) {
    console.log('Usage: node run-preflight-check.js "Your requirement here"');
    console.log('Example: node run-preflight-check.js "Create a counter app"');
    process.exit(1);
  }
  
  const validator = new AgentServiceValidator();
  const results = await validator.runPreFlightChecks(requirement);
  
  // Exit with appropriate code
  const allPassed = results.checks.serviceConfig && 
                   results.checks.requirementValid && 
                   results.checks.flowReady;
  
  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);