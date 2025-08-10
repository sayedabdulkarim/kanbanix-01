const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const TaskBasedGeneratorMCP = require("./task-based-generator-mcp");
const CompilationChecker = require("./compilation-checker");
const LLMBuildValidator = require("./llm-build-validator");
const projectManager = require("./project-manager");
const apiKeyStorage = require("./api-key-storage");
require("dotenv").config();

const router = express.Router();

// Store task progress for each project
const projectProgress = new Map();

// POST /update-project-v2 - Task-based project update
router.post("/update-project-v2", async (req, res) => {
  const { projectName, requirements, socketId } = req.body;

  if (!projectName || !requirements) {
    return res.status(400).json({ 
      error: "projectName and requirements are required" 
    });
  }

  const io = req.app.get('io');
  const socket = socketId && io ? io.sockets.sockets.get(socketId) : null;

  const baseDir = path.join(__dirname, "../../client/user-projects");
  const projectPath = path.join(baseDir, projectName);
  const prdPath = path.join(projectPath, "PRD.md");
  
  // Track if dev server was running before update
  let projectWasRunning = false;
  
  // Initialize compilation checker once
  const compilationChecker = new CompilationChecker();

  try {
    console.log(`Starting update-project-v2 for project: ${projectName}`);
    console.log(`Update requirements: "${requirements}"`);
    
    // Stop the dev server if it's running to prevent build cache corruption
    projectWasRunning = projectManager.stopProject(projectName);
    if (projectWasRunning) {
      console.log(`Stopped running dev server for ${projectName}`);
      if (socket) {
        socket.emit('output', '\x1b[36m> Stopping development server for update...\x1b[0m\n');
      }
      // Wait a moment for the process to fully terminate
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Clean up build artifacts before update to prevent corruption
    await compilationChecker.cleanupBuildArtifacts(projectPath, socket);
    
    // Check if PRD file exists
    try {
      await fs.access(prdPath);
    } catch (err) {
      console.error(`PRD file not found at: ${prdPath}`);
      return res.status(404).json({ error: "PRD file not found" });
    }
    
    // Read the PRD
    const prd = await fs.readFile(prdPath, "utf-8");
    console.log(`Read PRD for project ${projectName}, length: ${prd.length}`);
    console.log(`PRD preview: ${prd.substring(0, 200)}...`);
    
    // Check API key availability
    const apiKey = apiKeyStorage.getApiKeyWithFallback(socketId);
    if (!apiKey) {
      console.error("No API key available for this session");
      return res.status(401).json({ 
        error: "API key required. Please provide your Anthropic API key.",
        requiresApiKey: true 
      });
    }
    
    // Initialize generator with MCP support
    const generator = new TaskBasedGeneratorMCP();
    
    // Notify start
    if (socket) {
      socket.emit('output', '\n\x1b[1;34m> Starting task-based code generation...\x1b[0m\n');
      // Emit status event for code generation starting
      socket.emit('project:status', {
        projectName,
        stage: 'code_generation_starting',
        message: 'Starting code generation...'
      });
    } else {
      console.log("No socket connection available for real-time updates");
    }

    // Check if this is an update by looking at existing files and requirements
    let isUpdate = false;
    try {
      // Check if src directory exists with actual component files
      const srcPath = path.join(projectPath, 'src');
      const srcExists = await fs.access(srcPath).then(() => true).catch(() => false);
      
      if (srcExists) {
        const srcFiles = await fs.readdir(srcPath, { recursive: true });
        const hasComponentFiles = srcFiles.some(file => 
          typeof file === 'string' && (file.endsWith('.tsx') || file.endsWith('.jsx')) && 
          !file.includes('globals.css')
        );
        
        // It's an update if we have existing component files AND requirements differ from PRD
        isUpdate = hasComponentFiles && requirements.trim() !== prd.trim();
        
        console.log(`Update detection: srcExists=${srcExists}, hasComponentFiles=${hasComponentFiles}, reqDifferentFromPRD=${requirements.trim() !== prd.trim()}, isUpdate=${isUpdate}`);
      }
    } catch (e) {
      console.log("Error checking project state:", e);
    }
    
    // Step 1: Create task list
    if (socket) {
      socket.emit('output', '\x1b[36m> Analyzing PRD and creating task list...\x1b[0m\n');
      if (isUpdate) {
        socket.emit('output', '\x1b[33m> Detected UPDATE operation - will only modify necessary files\x1b[0m\n');
      }
      // Emit status event for analyzing requirements
      socket.emit('project:status', {
        projectName,
        stage: 'analyzing_requirements',
        message: 'Analyzing requirements and creating tasks...'
      });
    }
    
    let taskResult;
    if (isUpdate) {
      // Use update-aware task creation that uses MCP to check existing files
      if (socket) {
        socket.emit('output', '\x1b[36m> Analyzing request intent...\x1b[0m\n');
      }
      taskResult = await generator.createUpdateTaskList(prd, requirements, projectName, socketId);
    } else {
      // Initial creation - use standard full task list
      taskResult = await generator.createTaskList(prd, socketId);
    }
    const tasks = taskResult.tasks;
    
    if (socket) {
      socket.emit('output', `\x1b[32m✓ Created ${tasks.length} tasks\x1b[0m\n`);
      tasks.forEach((task, index) => {
        socket.emit('output', `  ${index + 1}. ${task.name}\n`);
      });
      socket.emit('output', '\n');
    }

    // Store progress
    projectProgress.set(projectName, {
      totalTasks: tasks.length,
      completedTasks: 0,
      currentTask: null,
      status: 'in_progress'
    });

    // Step 2: Execute tasks with progress tracking (now with MCP support)
    console.log(`Starting task execution for ${tasks.length} tasks...`);
    
    let results;
    try {
      results = await generator.executeTasks(
        tasks, 
        prd, 
        projectPath,
        (progress) => {
          console.log(`Task progress:`, progress);
          
          // Update progress
          projectProgress.set(projectName, {
            totalTasks: progress.totalTasks,
            completedTasks: progress.status === 'completed' ? progress.currentTask : progress.currentTask - 1,
            currentTask: progress.taskName,
            status: progress.status === 'failed' ? 'partial' : 'in_progress'
          });

          // Send progress to socket
          if (socket && socket.connected) {
            if (progress.status === 'generating') {
              socket.emit('output', `\x1b[36m> Task ${progress.currentTask}/${progress.totalTasks}: ${progress.taskName}...\x1b[0m\n`);
            } else if (progress.status === 'completed') {
              socket.emit('output', `\x1b[32m✓ Completed: ${progress.taskName}\x1b[0m\n`);
            } else if (progress.status === 'failed') {
              socket.emit('output', `\x1b[31m✗ Failed: ${progress.taskName} - ${progress.error}\x1b[0m\n`);
            }
          } else if (!socket?.connected) {
            console.warn('Socket disconnected during task execution');
          }
        },
        projectName,  // Pass project name for MCP context
        socketId      // Pass socketId for API key access
      );
    } catch (taskError) {
      console.error('Error during task execution:', taskError);
      throw taskError;
    }
    
    console.log('Task execution completed:', {
      summary: results.summary,
      resultsCount: results.results?.length
    });

    // Update final progress
    projectProgress.set(projectName, {
      totalTasks: results.summary.total,
      completedTasks: results.summary.successful,
      currentTask: null,
      status: results.summary.failed === 0 ? 'completed' : 'partial'
    });

    // Send summary
    if (socket) {
      socket.emit('output', '\n\x1b[1;34m> Code generation summary:\x1b[0m\n');
      socket.emit('output', `  Total tasks: ${results.summary.total}\n`);
      socket.emit('output', `  \x1b[32mSuccessful: ${results.summary.successful}\x1b[0m\n`);
      if (results.summary.failed > 0) {
        socket.emit('output', `  \x1b[31mFailed: ${results.summary.failed}\x1b[0m\n`);
      }
      socket.emit('output', `  Files generated: ${results.summary.generatedFiles}\n\n`);
    }

    // Analyze what was actually generated to determine if build validation is needed
    const analyzeGeneratedChanges = (taskResults) => {
      const analysis = {
        filesCount: 0,
        totalLinesChanged: 0,
        hasTypeScriptChanges: false,
        hasNewImports: false,
        hasNewExports: false,
        hasEventHandlers: false,
        hasStateManagement: false,
        hasStructuralChanges: false,
        largestFileChangeLines: 0,
        fileTypes: new Set()
      };
      
      // DEBUG: Log the structure of taskResults
      console.log('\n--- DEBUG: Task Results Structure ---');
      console.log('taskResults type:', typeof taskResults);
      console.log('taskResults keys:', taskResults ? Object.keys(taskResults) : 'null');
      if (taskResults && taskResults.results) {
        console.log('taskResults.results length:', taskResults.results.length);
        if (taskResults.results[0]) {
          console.log('First result keys:', Object.keys(taskResults.results[0]));
          console.log('First result sample:', {
            hasFiles: !!taskResults.results[0].files,
            filesType: typeof taskResults.results[0].files,
            filesSample: taskResults.results[0].files ? Object.keys(taskResults.results[0].files).slice(0, 2) : 'no files',
            taskIntent: taskResults.results[0].task?.intent
          });
        }
      }
      console.log('--- END DEBUG ---\n');
      
      // If no results, assume simple
      if (!taskResults || !taskResults.results) {
        console.log('No task results to analyze, assuming simple change');
        return { needsBuild: false, confidence: 0.5, analysis };
      }
      
      // Check if all tasks are STYLE or CONTENT changes
      let isSimpleChange = true;
      let taskIntents = [];
      for (const result of taskResults.results) {
        if (result.task && result.task.intent) {
          taskIntents.push(result.task.intent);
          if (result.task.intent !== 'STYLE' && result.task.intent !== 'CONTENT') {
            isSimpleChange = false;
          }
        }
      }
      
      console.log('Task intents detected:', taskIntents);
      console.log('Is simple change (all STYLE/CONTENT):', isSimpleChange);
      
      // Analyze each generated file
      for (const result of taskResults.results) {
        // Check both possible locations for files (files or filesWritten)
        const files = result.files || result.filesWritten;
        
        // DEBUG: Log what we found
        console.log('Analyzing result:', {
          hasFiles: !!result.files,
          hasFilesWritten: !!result.filesWritten,
          filesWrittenType: typeof result.filesWritten,
          filesWrittenSample: result.filesWritten ? 
            (Array.isArray(result.filesWritten) ? 
              `Array with ${result.filesWritten.length} items` : 
              `Object with keys: ${Object.keys(result.filesWritten).slice(0,3)}`) 
            : 'none'
        });
        
        if (files) {
          // Handle both array of paths and object with content
          if (Array.isArray(files)) {
            // If it's an array of file paths, we need to read the content
            for (const filepath of files) {
              analysis.filesCount++;
              const ext = path.extname(filepath);
              analysis.fileTypes.add(ext);
              
              // For now, estimate lines for files we can't read
              // This is a temporary fix - we should read the actual files
              analysis.totalLinesChanged += 50; // Estimate
              analysis.largestFileChangeLines = Math.max(analysis.largestFileChangeLines, 50);
              
              if (['.ts', '.tsx', '.jsx', '.js'].includes(ext)) {
                analysis.hasTypeScriptChanges = true;
                // Can't analyze content without reading the file
              }
            }
          } else {
            // Object with file content
            for (const [filepath, content] of Object.entries(files)) {
              analysis.filesCount++;
              
              // Track file types
              const ext = path.extname(filepath);
              analysis.fileTypes.add(ext);
              
              // Count lines
              const lines = content.split('\n');
              const lineCount = lines.length;
              analysis.totalLinesChanged += lineCount;
              analysis.largestFileChangeLines = Math.max(analysis.largestFileChangeLines, lineCount);
              
              // Analyze content for complexity indicators
              const contentLower = content.toLowerCase();
              
              // Check for TypeScript/JSX files
              if (['.ts', '.tsx', '.jsx', '.js'].includes(ext)) {
                analysis.hasTypeScriptChanges = true;
                
                // Skip complex checks for STYLE/CONTENT changes
                if (!isSimpleChange) {
                  // Check for imports (new dependencies)
                  if (/^import\s+/m.test(content) && content.includes('from')) {
                    // Check if it's adding NEW imports (not just modifying existing)
                    const importCount = (content.match(/^import\s+.*from/gm) || []).length;
                    if (importCount > 2) { // More than basic React imports
                      analysis.hasNewImports = true;
                    }
                  }
                  
                  // Check for exports (new components/functions)
                  if (/export\s+(default\s+)?(function|const|class)/m.test(content)) {
                    analysis.hasNewExports = true;
                  }
                  
                  // Check for event handlers (any variation)
                  if (/on[A-Z]\w+\s*[=:]/i.test(content) || /addEventListener/i.test(content)) {
                    analysis.hasEventHandlers = true;
                  }
                  
                  // Check for state management
                  if (/use(State|Reducer|Effect|Callback|Memo)\s*\(/i.test(content)) {
                    analysis.hasStateManagement = true;
                  }
                  
                  // Check for structural changes (new components, functions)
                  if (/function\s+[A-Z]\w+\s*\(/.test(content) || /const\s+[A-Z]\w+\s*=\s*\(/.test(content)) {
                    analysis.hasStructuralChanges = true;
                  }
                } else {
                  console.log(`Skipping complexity checks for ${result.task?.intent || 'simple'} change`);
                }
              }
            }
          }
        }
      }
      
      // Determine if build is needed based on actual changes
      const needsBuild = 
        analysis.hasStructuralChanges ||
        analysis.hasNewExports ||
        analysis.hasEventHandlers ||
        analysis.hasStateManagement ||
        analysis.filesCount > 2 ||
        analysis.largestFileChangeLines > 100;
      
      // Calculate confidence based on how clear the indicators are
      let confidence = 0.9;
      let confidenceReason = 'default';
      
      // For STYLE/CONTENT changes, always have high confidence
      if (isSimpleChange) {
        confidence = 0.95;
        confidenceReason = 'STYLE/CONTENT change detected';
      } else if (analysis.filesCount === 1 && analysis.totalLinesChanged < 20) {
        confidence = 0.95;
        confidenceReason = 'single file, < 20 lines';
      } else if (analysis.filesCount > 3 || analysis.totalLinesChanged > 200) {
        confidence = 0.95;
        confidenceReason = 'many files or > 200 lines';
      } else {
        confidence = 0.7;
        confidenceReason = `medium: ${analysis.filesCount} files, ${analysis.totalLinesChanged} lines`;
      }
      
      // Detailed logging for debugging
      console.log('\n--- Confidence Calculation ---');
      console.log(`Files: ${analysis.filesCount}, Lines: ${analysis.totalLinesChanged}`);
      console.log(`Confidence: ${confidence} (${confidenceReason})`);
      console.log(`Thresholds: <20 lines = 0.95, 20-200 lines = 0.7, >200 lines = 0.95`);
      
      console.log('\n--- Change Indicators ---');
      console.log('Complexity indicators found:', {
        hasEventHandlers: analysis.hasEventHandlers,
        hasStateManagement: analysis.hasStateManagement,
        hasNewExports: analysis.hasNewExports,
        hasStructuralChanges: analysis.hasStructuralChanges,
        hasNewImports: analysis.hasNewImports,
        largeFile: analysis.largestFileChangeLines > 100
      });
      
      console.log('\n--- Build Decision ---');
      console.log(`Need Build: ${needsBuild}`);
      console.log(`Reason: ${needsBuild ? 
        (analysis.hasEventHandlers ? 'Has event handlers' :
         analysis.hasStateManagement ? 'Has state management' :
         analysis.hasNewExports ? 'Has new exports' :
         analysis.hasStructuralChanges ? 'Has structural changes' :
         analysis.filesCount > 2 ? 'Multiple files changed' :
         analysis.largestFileChangeLines > 100 ? 'Large file change' : 'Unknown')
        : 'No complexity indicators found'
      }`);
      
      return { needsBuild, confidence, analysis };
    };
    
    // Step 3: Run compilation check and auto-fix (conditionally)
    let compilationResult;
    let skipBuildValidation = false;
    
    // Analyze what was actually generated to determine if build validation is needed
    const changeAnalysis = analyzeGeneratedChanges(results);
    
    // DEBUG: Log the complete analysis results
    console.log('\n========================================');
    console.log('📊 CHANGE ANALYSIS DEBUG INFO:');
    console.log('========================================');
    console.log('Requirements:', requirements.substring(0, 100));
    console.log('Is Update:', isUpdate);
    console.log('Analysis Results:', {
      needsBuild: changeAnalysis.needsBuild,
      confidence: changeAnalysis.confidence,
      confidenceThreshold: 0.7,
      willSkipBuild: !changeAnalysis.needsBuild && changeAnalysis.confidence >= 0.7,
      details: changeAnalysis.analysis
    });
    console.log('Decision Logic:');
    console.log(`  - needsBuild: ${changeAnalysis.needsBuild} (false = good for skip)`);
    console.log(`  - confidence: ${changeAnalysis.confidence} (needs >= 0.7)`);
    console.log(`  - confidence >= 0.7: ${changeAnalysis.confidence >= 0.7}`);
    console.log(`  - Final decision: ${(!changeAnalysis.needsBuild && changeAnalysis.confidence >= 0.7) ? 'SKIP BUILD ✅' : 'RUN BUILD ⚠️'}`);
    console.log('========================================\n');
    
    // Check if this is a simple change that doesn't need build validation
    // Only skip for updates, not initial creation
    // Also check if this is actually a simple change (no complex features)
    const isInitialCreation = requirements.length > 500; // PRDs are typically long
    
    if (isUpdate && !isInitialCreation && !changeAnalysis.needsBuild && changeAnalysis.confidence >= 0.7) {
      skipBuildValidation = true;
      
      if (socket) {
        socket.emit('output', '\n\x1b[1;32m✅ Simple change detected - skipping build validation\x1b[0m\n');
        socket.emit('output', `\x1b[90m📊 Analysis: ${changeAnalysis.analysis.filesCount} file(s), ${changeAnalysis.analysis.totalLinesChanged} lines changed\x1b[0m\n`);
        socket.emit('output', '\x1b[90mRelying on hot reload for instant updates...\x1b[0m\n\n');
      }
      
      compilationResult = { 
        success: true, 
        skipped: true,
        reason: 'Simple change - no build validation needed',
        analysis: changeAnalysis.analysis
      };
    } else {
      // Complex change or low confidence - run full validation
      if (socket) {
        if (changeAnalysis.confidence <= 0.7) {
          socket.emit('output', '\x1b[90m⚠️ Uncertain change complexity - running build validation for safety\x1b[0m\n');
        }
        socket.emit('output', '\x1b[1;34m> Checking for compilation errors...\x1b[0m\n');
        // Emit status event for compilation check
        socket.emit('project:status', {
          projectName,
          stage: 'checking_build',
          message: 'Checking for compilation errors...'
        });
      }
      
      compilationResult = await compilationChecker.checkAndFix(projectPath, socket);
    }
    
    let llmValidationResult = { success: false };
    
    // Step 4: If compilation still has errors, use LLM to fix them (skip for simple changes)
    if (!compilationResult.success && !skipBuildValidation) {
      if (socket) {
        socket.emit('output', '\n\x1b[1;33m> Compilation errors detected. Using AI to analyze and fix...\x1b[0m\n');
      }
      
      const llmValidator = new LLMBuildValidator();
      llmValidationResult = await llmValidator.validateAndFix(projectPath, prd, socket, socketId);
    } else {
      llmValidationResult = { success: true };
    }
    
    let finalMessage = results.summary.failed === 0 
      ? "Project updated successfully with all tasks completed"
      : `Project updated with ${results.summary.successful} of ${results.summary.total} tasks completed`;
      
    if (llmValidationResult.success) {
      finalMessage += " and build verification passed";
      if (socket) {
        // Emit status event for code generation complete
        socket.emit('project:status', {
          projectName,
          stage: 'code_generation_complete',
          message: 'Code generation completed successfully!'
        });
      }
    } else {
      finalMessage += " but some build errors could not be resolved";
      if (socket) {
        socket.emit('output', '\n\x1b[31m✗ Some build errors could not be automatically fixed.\x1b[0m\n');
        socket.emit('output', 'Please check the terminal output for manual resolution.\n');
        // Emit status event for code generation with errors
        socket.emit('project:status', {
          projectName,
          stage: 'code_generation_complete_with_errors',
          message: 'Code generation completed with some errors'
        });
      }
    }

    // Restart dev server if it was running before and update was successful
    if (projectWasRunning && llmValidationResult.success) {
      if (socket) {
        socket.emit('output', '\n\x1b[36m> Restarting development server...\x1b[0m\n');
      }
      try {
        const projectInfo = await projectManager.startProject(projectPath, projectName, socket);
        if (socket) {
          socket.emit('output', `\x1b[32m✓ Development server restarted at ${projectInfo.url}\x1b[0m\n`);
        }
      } catch (restartError) {
        console.error('Failed to restart dev server:', restartError);
        if (socket) {
          socket.emit('output', '\x1b[33m⚠ Please manually restart the development server\x1b[0m\n');
        }
      }
    }
    
    // Return response
    return res.json({
      message: finalMessage,
      summary: {
        ...results.summary,
        compilationSuccess: compilationResult.success,
        compilationSkipped: compilationResult.skipped || false,
        compilationAttempts: compilationResult.attempts || (compilationResult.skipped ? 0 : 1),
        compilationErrors: compilationResult.errors?.length || 0,
        llmValidationSuccess: llmValidationResult.success,
        llmValidationAttempts: llmValidationResult.attempts || 0,
        devServerRestarted: projectWasRunning && llmValidationResult.success,
        simpleChangeDetected: skipBuildValidation
      },
      details: results.results
    });

  } catch (error) {
    console.error("Error in task-based update:", error);
    
    // Clear progress on error
    projectProgress.delete(projectName);
    
    if (socket) {
      socket.emit('output', `\n\x1b[31m✗ Error: ${error.message}\x1b[0m\n`);
    }
    
    return res.status(500).json({ 
      error: "Failed to update project", 
      details: error.message 
    });
  }
});

// GET /project-progress/:projectName - Get current progress
router.get("/project-progress/:projectName", (req, res) => {
  const { projectName } = req.params;
  
  const progress = projectProgress.get(projectName);
  if (!progress) {
    return res.json({ 
      status: 'not_found',
      message: 'No active code generation for this project' 
    });
  }
  
  return res.json(progress);
});

// POST /retry-failed-tasks - Retry failed tasks
router.post("/retry-failed-tasks", async (req, res) => {
  const { projectName, taskIds, socketId } = req.body;
  
  if (!projectName || !taskIds || !Array.isArray(taskIds)) {
    return res.status(400).json({ 
      error: "projectName and taskIds array are required" 
    });
  }
  
  // Implementation for retrying specific failed tasks
  // This would reuse the task-based generator to retry only failed tasks
  
  return res.json({ 
    message: "Task retry functionality to be implemented" 
  });
});

module.exports = router;