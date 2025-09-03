import { TaskDiff, FileDiff } from '@/types/project';
import gitService from './gitService';

class DiffTrackingService {
  private currentTaskDiffs: Map<string, string[]> = new Map(); // taskId -> file paths being tracked

  /**
   * Start tracking files for a task before changes are made
   */
  async startTrackingTask(
    workspacePath: string,
    taskId: string,
    filesToTrack?: string[]
  ): Promise<void> {
    try {
      // Get current state of files before task starts
      const trackedFiles = filesToTrack || [];
      this.currentTaskDiffs.set(taskId, trackedFiles);
      
      console.log(`[DiffTracking] Started tracking task ${taskId} with ${trackedFiles.length} files`);
    } catch (error) {
      console.error(`[DiffTracking] Error starting tracking for task ${taskId}:`, error);
    }
  }

  /**
   * Capture diffs for a task when it's completed or moved to review
   */
  async captureTaskDiffs(
    workspacePath: string,
    taskId: string,
    taskTitle: string,
    type: 'initial' | 'follow-up' | 'chat-update' = 'initial'
  ): Promise<TaskDiff | null> {
    try {
      // Get uncommitted changes
      const changedFiles = await gitService.getUncommittedChanges(workspacePath);
      
      if (changedFiles.length === 0) {
        console.log(`[DiffTracking] No changes to capture for task ${taskId}`);
        return null;
      }

      const fileDiffs: FileDiff[] = [];
      let totalAdditions = 0;
      let totalDeletions = 0;

      // Get diff for each changed file
      for (const filePath of changedFiles) {
        const diff = await gitService.getDiffForFile(workspacePath, filePath);
        
        if (diff) {
          const stats = this.parseDiffStats(diff);
          fileDiffs.push({
            fileName: filePath.split('/').pop() || filePath,
            filePath: filePath,
            additions: stats.additions,
            deletions: stats.deletions,
            changes: diff,
            status: stats.status
          });
          
          totalAdditions += stats.additions;
          totalDeletions += stats.deletions;
        }
      }

      // Get existing diffs to determine version
      const existingDiffs = await this.getTaskDiffs(taskId);
      const version = existingDiffs.length + 1;

      const taskDiff: TaskDiff = {
        id: `diff-${taskId}-v${version}-${Date.now()}`,
        version,
        type,
        files: fileDiffs,
        timestamp: new Date(),
        message: `${type === 'initial' ? 'Initial changes' : 'Follow-up changes'} for: ${taskTitle}`,
        totalAdditions,
        totalDeletions
      };

      console.log(`[DiffTracking] Captured diff v${version} for task ${taskId}: +${totalAdditions} -${totalDeletions}`);
      return taskDiff;
    } catch (error) {
      console.error(`[DiffTracking] Error capturing diffs for task ${taskId}:`, error);
      return null;
    }
  }

  /**
   * Capture diffs from a specific commit (for tasks that were already committed)
   */
  async captureTaskDiffsFromCommit(
    workspacePath: string,
    taskId: string,
    commitSha: string,
    taskTitle: string
  ): Promise<TaskDiff | null> {
    try {
      // Get the parent commit to compare against
      const parentCommit = await gitService.getParentCommit(workspacePath, commitSha);
      
      if (!parentCommit) {
        console.log(`[DiffTracking] No parent commit found for ${commitSha}`);
        return null;
      }

      // Get diff between parent and current commit
      const diff = await gitService.getDiffBetweenCommits(workspacePath, parentCommit, commitSha);
      
      if (!diff) {
        console.log(`[DiffTracking] No diff found for commit ${commitSha}`);
        return null;
      }

      // Parse the diff to extract file changes
      const fileDiffs = this.parseDiffIntoFiles(diff);
      
      const totalAdditions = fileDiffs.reduce((sum, f) => sum + f.additions, 0);
      const totalDeletions = fileDiffs.reduce((sum, f) => sum + f.deletions, 0);

      const taskDiff: TaskDiff = {
        id: `diff-${taskId}-commit-${commitSha.substring(0, 7)}`,
        version: 1,
        type: 'initial',
        files: fileDiffs,
        timestamp: new Date(),
        message: `Changes from commit ${commitSha.substring(0, 7)}: ${taskTitle}`,
        totalAdditions,
        totalDeletions
      };

      console.log(`[DiffTracking] Captured diff from commit ${commitSha} for task ${taskId}`);
      return taskDiff;
    } catch (error) {
      console.error(`[DiffTracking] Error capturing diffs from commit:`, error);
      return null;
    }
  }

  /**
   * Parse diff stats from git diff output
   */
  private parseDiffStats(diff: string): { additions: number; deletions: number; status: 'added' | 'modified' | 'deleted' } {
    const lines = diff.split('\n');
    let additions = 0;
    let deletions = 0;
    let isNewFile = false;
    let isDeletedFile = false;

    for (const line of lines) {
      if (line.startsWith('new file mode')) {
        isNewFile = true;
      } else if (line.startsWith('deleted file mode')) {
        isDeletedFile = true;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    let status: 'added' | 'modified' | 'deleted' = 'modified';
    if (isNewFile) status = 'added';
    if (isDeletedFile) status = 'deleted';

    return { additions, deletions, status };
  }

  /**
   * Parse a full diff into individual file diffs
   */
  private parseDiffIntoFiles(fullDiff: string): FileDiff[] {
    const fileDiffs: FileDiff[] = [];
    const fileSections = fullDiff.split(/^diff --git /m).filter(Boolean);

    for (const section of fileSections) {
      const fileMatch = section.match(/a\/(.*?) b\/(.*?)\n/);
      if (!fileMatch) continue;

      const filePath = fileMatch[2];
      const fileName = filePath.split('/').pop() || filePath;
      const stats = this.parseDiffStats(section);

      fileDiffs.push({
        fileName,
        filePath,
        additions: stats.additions,
        deletions: stats.deletions,
        changes: `diff --git ${section}`, // Preserve the full diff for this file
        status: stats.status
      });
    }

    return fileDiffs;
  }

  /**
   * Store task diffs in the database (via API)
   */
  async storeTaskDiffs(taskId: string, diffs: TaskDiff[]): Promise<void> {
    try {
      const response = await fetch('/api/tasks/update-diffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId,
          diffs: JSON.stringify(diffs) // Store as JSON string
        })
      });

      if (!response.ok) {
        throw new Error('Failed to store task diffs');
      }

      console.log(`[DiffTracking] Stored ${diffs.length} diff versions for task ${taskId}`);
    } catch (error) {
      console.error(`[DiffTracking] Error storing diffs:`, error);
      throw error;
    }
  }

  /**
   * Retrieve task diffs from the database
   */
  async getTaskDiffs(taskId: string): Promise<TaskDiff[]> {
    try {
      const response = await fetch(`/api/tasks/${taskId}/diffs`);
      
      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const diffs = data.diffs ? JSON.parse(data.diffs) : [];
      
      return diffs;
    } catch (error) {
      console.error(`[DiffTracking] Error retrieving diffs:`, error);
      return [];
    }
  }

  /**
   * Check which other tasks are affected by changes to specific files
   */
  async findAffectedTasks(
    projectId: string,
    modifiedFiles: string[],
    excludeTaskId: string
  ): Promise<string[]> {
    try {
      const response = await fetch('/api/tasks/find-affected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          modifiedFiles,
          excludeTaskId
        })
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.affectedTaskIds || [];
    } catch (error) {
      console.error(`[DiffTracking] Error finding affected tasks:`, error);
      return [];
    }
  }

  /**
   * Mark tasks as affected by another task's follow-up changes
   */
  async markTasksAsAffected(
    affectedTaskIds: string[],
    sourceTaskId: string
  ): Promise<void> {
    try {
      await fetch('/api/tasks/mark-affected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affectedTaskIds,
          sourceTaskId
        })
      });

      console.log(`[DiffTracking] Marked ${affectedTaskIds.length} tasks as affected by ${sourceTaskId}`);
    } catch (error) {
      console.error(`[DiffTracking] Error marking affected tasks:`, error);
    }
  }
}

export default new DiffTrackingService();