'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode, Plus, Minus } from 'lucide-react';

interface DiffViewerProps {
  projectId: string;
  changes?: any[];
  expandAll?: boolean;
}

interface FileDiff {
  path: string;
  hunks: Hunk[];
  expanded?: boolean;
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  changes: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

export default function DiffViewer({ projectId, changes = [], expandAll }: DiffViewerProps) {
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [loadingContent, setLoadingContent] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (changes.length > 0) {
      // Fetch diffs for modified files
      fetchDiffs();
    }
  }, [changes, projectId]);
  
  useEffect(() => {
    if (expandAll !== undefined) {
      if (expandAll) {
        // Expand all files from both changes and diffs
        const allPaths = new Set([
          ...changes.map(c => c.path),
          ...diffs.map(d => d.path)
        ]);
        setExpandedFiles(allPaths);
        // Fetch content for all created files
        changes.filter(c => c.type === 'created').forEach(change => {
          if (!fileContents[change.path]) {
            fetchFileContent(change.path);
          }
        });
      } else {
        setExpandedFiles(new Set());
      }
    }
  }, [expandAll, diffs, changes]);

  const fetchDiffs = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/workspace/diff?projectId=${projectId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.structuredDiff) {
          setDiffs(data.structuredDiff);
          // Auto-expand first few files
          const firstFiles = data.structuredDiff.slice(0, 3).map((f: FileDiff) => f.path);
          setExpandedFiles(new Set(firstFiles));
        }
      }
    } catch (error) {
      console.error('Error fetching diffs:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleFile = async (path: string, change: any) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
      // Fetch file content if it's a new file and we don't have it yet
      if (change.type === 'created' && !fileContents[path]) {
        await fetchFileContent(path);
      }
    }
    setExpandedFiles(newExpanded);
  };

  const fetchFileContent = async (path: string) => {
    const newLoading = new Set(loadingContent);
    newLoading.add(path);
    setLoadingContent(newLoading);
    
    try {
      const response = await fetch(`/api/workspace/file?projectId=${projectId}&path=${encodeURIComponent(path)}`);
      if (response.ok) {
        const data = await response.json();
        setFileContents(prev => ({ ...prev, [path]: data.content }));
      }
    } catch (error) {
      console.error('Error fetching file content:', error);
    } finally {
      const newLoading = new Set(loadingContent);
      newLoading.delete(path);
      setLoadingContent(newLoading);
    }
  };

  const getLineNumbers = (hunk: Hunk) => {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    
    return hunk.changes.map(change => {
      const result = {
        old: change.type === 'add' ? '' : oldLine.toString(),
        new: change.type === 'remove' ? '' : newLine.toString()
      };
      
      if (change.type !== 'add') oldLine++;
      if (change.type !== 'remove') newLine++;
      
      return result;
    });
  };

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading diff...</div>;
  }

  if (changes.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No changes to display</div>;
  }

  // Show enhanced file list with expandable content
  if (changes.length > 0) {
    return (
      <div className="space-y-2">
        {changes.map((change, index) => {
          const isExpanded = expandedFiles.has(change.path);
          const isLoadingContent = loadingContent.has(change.path);
          const hasContent = fileContents[change.path];
          const matchingDiff = diffs.find(d => d.path === change.path);
          
          return (
            <div key={index} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleFile(change.path, change)}
                className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <FileCode className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-sm">{change.path}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    change.type === 'created' ? 'bg-green-500/20 text-green-600' :
                    change.type === 'modified' ? 'bg-blue-500/20 text-blue-600' :
                    'bg-red-500/20 text-red-600'
                  }`}>
                    {change.type}
                  </span>
                  {change.type === 'created' && (
                    <span className="text-xs text-green-600">
                      <Plus className="h-3 w-3 inline" /> New file
                    </span>
                  )}
                  {change.type === 'modified' && matchingDiff && (
                    <>
                      <span className="text-xs text-green-600">
                        <Plus className="h-3 w-3 inline" />
                        {matchingDiff.hunks.reduce((acc, hunk) => 
                          acc + hunk.changes.filter(c => c.type === 'add').length, 0
                        )}
                      </span>
                      <span className="text-xs text-red-600">
                        <Minus className="h-3 w-3 inline" />
                        {matchingDiff.hunks.reduce((acc, hunk) => 
                          acc + hunk.changes.filter(c => c.type === 'remove').length, 0
                        )}
                      </span>
                    </>
                  )}
                </div>
              </button>
              
              {isExpanded && (
                <div className="border-t">
                  {isLoadingContent ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading file content...</div>
                  ) : change.type === 'created' && hasContent ? (
                    // Show full content for new files
                    <div className="font-mono text-xs bg-green-500/5">
                      <div className="px-3 py-2 bg-green-500/10 text-green-600 border-b">
                        + New file
                      </div>
                      <pre className="p-3 overflow-x-auto">
                        <code>{fileContents[change.path]}</code>
                      </pre>
                    </div>
                  ) : matchingDiff ? (
                    // Show diff for modified files
                    matchingDiff.hunks.map((hunk, hunkIndex) => {
                      const lineNumbers = getLineNumbers(hunk);
                      return (
                        <div key={hunkIndex}>
                          <div className="bg-muted/20 px-3 py-1 text-xs text-muted-foreground font-mono">
                            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@ {hunk.content}
                          </div>
                          <div className="font-mono text-xs">
                            {hunk.changes.map((change, changeIndex) => (
                              <div
                                key={changeIndex}
                                className={`flex ${
                                  change.type === 'add' ? 'bg-green-500/10' :
                                  change.type === 'remove' ? 'bg-red-500/10' :
                                  ''
                                }`}
                              >
                                <div className="flex">
                                  <span className="w-12 px-2 py-1 text-right text-muted-foreground select-none border-r">
                                    {lineNumbers[changeIndex].old}
                                  </span>
                                  <span className="w-12 px-2 py-1 text-right text-muted-foreground select-none border-r">
                                    {lineNumbers[changeIndex].new}
                                  </span>
                                  <span className={`px-2 py-1 select-none ${
                                    change.type === 'add' ? 'text-green-600' :
                                    change.type === 'remove' ? 'text-red-600' :
                                    'text-muted-foreground'
                                  }`}>
                                    {change.type === 'add' ? '+' :
                                     change.type === 'remove' ? '-' : ' '}
                                  </span>
                                </div>
                                <pre className="flex-1 py-1 overflow-x-auto">
                                  <code>{change.content}</code>
                                </pre>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-4 text-sm text-muted-foreground">
                      {change.type === 'created' ? 'Click to load file content' : 'No diff available'}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Full diff view when available */}
      {diffs.length > 0 && (
        diffs.map((file) => (
        <div key={file.path} className="border rounded-lg overflow-hidden">
          <button
            onClick={() => toggleFile(file.path)}
            className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              {expandedFiles.has(file.path) ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <FileCode className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-sm">{file.path}</span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              {file.hunks.reduce((acc, hunk) => {
                const adds = hunk.changes.filter(c => c.type === 'add').length;
                const removes = hunk.changes.filter(c => c.type === 'remove').length;
                return { adds: acc.adds + adds, removes: acc.removes + removes };
              }, { adds: 0, removes: 0 }).adds > 0 && (
                <span className="flex items-center gap-1 text-green-600">
                  <Plus className="h-3 w-3" />
                  {file.hunks.reduce((acc, hunk) => 
                    acc + hunk.changes.filter(c => c.type === 'add').length, 0
                  )}
                </span>
              )}
              {file.hunks.reduce((acc, hunk) => {
                const removes = hunk.changes.filter(c => c.type === 'remove').length;
                return acc + removes;
              }, 0) > 0 && (
                <span className="flex items-center gap-1 text-red-600">
                  <Minus className="h-3 w-3" />
                  {file.hunks.reduce((acc, hunk) => 
                    acc + hunk.changes.filter(c => c.type === 'remove').length, 0
                  )}
                </span>
              )}
            </div>
          </button>
          
          {expandedFiles.has(file.path) && (
            <div className="border-t">
              {file.hunks.map((hunk, hunkIndex) => {
                const lineNumbers = getLineNumbers(hunk);
                return (
                  <div key={hunkIndex}>
                    <div className="bg-muted/20 px-3 py-1 text-xs text-muted-foreground font-mono">
                      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@ {hunk.content}
                    </div>
                    <div className="font-mono text-xs">
                      {hunk.changes.map((change, changeIndex) => (
                        <div
                          key={changeIndex}
                          className={`flex ${
                            change.type === 'add' ? 'bg-green-500/10' :
                            change.type === 'remove' ? 'bg-red-500/10' :
                            ''
                          }`}
                        >
                          <div className="flex">
                            <span className="w-12 px-2 py-1 text-right text-muted-foreground select-none border-r">
                              {lineNumbers[changeIndex].old}
                            </span>
                            <span className="w-12 px-2 py-1 text-right text-muted-foreground select-none border-r">
                              {lineNumbers[changeIndex].new}
                            </span>
                            <span className={`px-2 py-1 select-none ${
                              change.type === 'add' ? 'text-green-600' :
                              change.type === 'remove' ? 'text-red-600' :
                              'text-muted-foreground'
                            }`}>
                              {change.type === 'add' ? '+' :
                               change.type === 'remove' ? '-' : ' '}
                            </span>
                          </div>
                          <pre className="flex-1 py-1 overflow-x-auto">
                            <code>{change.content}</code>
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        ))
      )}
    </div>
  );
}