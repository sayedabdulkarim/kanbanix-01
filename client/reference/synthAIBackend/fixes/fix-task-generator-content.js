/**
 * Fix for task-based generator to ensure file content is always a string
 */

// This shows the fix needed in task-based-generator.js around line 320

// BEFORE:
// await fs.writeFile(filePath, file.content, 'utf-8');

// AFTER:
const fixes = {
  location: "task-based-generator.js, line 320",
  
  problem: "file.content might be an object instead of string",
  
  solution: `
    // Ensure content is a string
    let content = file.content;
    if (typeof content !== 'string') {
      // If it's an object, stringify it
      content = JSON.stringify(content, null, 2);
      console.warn(\`Warning: Task \${task.id} returned object content for \${file.path}, converting to string\`);
    }
    
    await fs.writeFile(filePath, content, 'utf-8');
  `,
  
  // Also add validation in parseJSON method
  additionalFix: `
    // In parseJSON method, validate the response structure
    parseJSON(content) {
      try {
        const parsed = JSON.parse(content);
        
        // Validate files array
        if (parsed.files && Array.isArray(parsed.files)) {
          parsed.files = parsed.files.map(file => {
            // Ensure content is string
            if (file.content && typeof file.content !== 'string') {
              console.warn(\`Converting object content to string for \${file.path}\`);
              file.content = JSON.stringify(file.content, null, 2);
            }
            return file;
          });
        }
        
        return parsed;
      } catch (error) {
        // ... existing error handling
      }
    }
  `
};

module.exports = fixes;