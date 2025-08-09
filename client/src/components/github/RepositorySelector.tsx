'use client';

import { useState, useEffect } from 'react';
import { Search, Star, GitFork, Lock, Unlock, Calendar, Github, Loader2 } from 'lucide-react';
import { useSession } from 'next-auth/react';

interface Repository {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  private: boolean;
  owner: string;
  stargazersCount: number;
  forksCount: number;
  language: string | null;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

interface RepositorySelectorProps {
  onSelectRepository: (repo: Repository) => void;
  onClose: () => void;
}

export default function RepositorySelector({ onSelectRepository, onClose }: RepositorySelectorProps) {
  const { data: session } = useSession();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [importing, setImporting] = useState<number | null>(null);

  useEffect(() => {
    fetchRepositories();
  }, []);

  const fetchRepositories = async () => {
    if (!session) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/github/repos');
      if (!response.ok) {
        throw new Error('Failed to fetch repositories');
      }
      
      const data = await response.json();
      setRepositories(data);
    } catch (err: any) {
      setError(err.message);
      console.error('Error fetching repositories:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredRepositories = repositories.filter(repo =>
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    repo.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    repo.language?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleImportRepository = async (repo: Repository) => {
    setImporting(repo.id);
    
    try {
      const response = await fetch('/api/github/import-repo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoId: repo.id,
          repoName: repo.fullName,
          repoDescription: repo.description,
          repoUrl: repo.url,
          owner: repo.owner,
          repo: repo.name,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to import repository');
      }

      const { projectId } = await response.json();
      
      // Notify parent component
      onSelectRepository(repo);
      
      // Don't redirect, just close the modal and refresh
    } catch (err: any) {
      console.error('Error importing repository:', err);
      alert(`Failed to import repository: ${err.message}`);
    } finally {
      setImporting(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-background rounded-xl p-6 w-full max-w-4xl max-h-[80vh] m-4">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading your repositories...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-background rounded-xl p-6 w-full max-w-4xl max-h-[80vh] m-4">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                <Github className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Failed to load repositories</h3>
              <p className="text-muted-foreground mb-4">{error}</p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={fetchRepositories}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-input rounded-lg hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-xl w-full max-w-4xl max-h-[80vh] m-4 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-semibold">Import from GitHub</h2>
              <p className="text-muted-foreground">Choose a repository to import as a project</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-secondary transition-colors"
            >
              ✕
            </button>
          </div>
          
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search repositories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Repository List */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredRepositories.length === 0 ? (
            <div className="text-center py-12">
              <Github className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {searchQuery ? 'No repositories found' : 'No repositories available'}
              </h3>
              <p className="text-muted-foreground">
                {searchQuery 
                  ? `No repositories match "${searchQuery}"`
                  : 'You don\'t have any repositories yet'
                }
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredRepositories.map((repo) => (
                <div
                  key={repo.id}
                  className="border border-border rounded-lg p-4 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">{repo.name}</h3>
                        {repo.private ? (
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Unlock className="h-4 w-4 text-muted-foreground" />
                        )}
                        {repo.language && (
                          <span className="px-2 py-1 text-xs rounded-full bg-primary/10 text-primary">
                            {repo.language}
                          </span>
                        )}
                      </div>
                      
                      <p className="text-muted-foreground text-sm mb-3 line-clamp-2">
                        {repo.description || 'No description available'}
                      </p>
                      
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Star className="h-3 w-3" />
                          <span>{repo.stargazersCount}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <GitFork className="h-3 w-3" />
                          <span>{repo.forksCount}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>Updated {formatDate(repo.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => handleImportRepository(repo)}
                      disabled={importing === repo.id}
                      className="ml-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {importing === repo.id ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        'Import'
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}