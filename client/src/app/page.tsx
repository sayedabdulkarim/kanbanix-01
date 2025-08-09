'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, Search, Github, Loader2 } from 'lucide-react';
import ProjectCard from '@/components/projects/ProjectCard';
import CreateProjectModal from '@/components/projects/CreateProjectModal';
import RepositorySelector from '@/components/github/RepositorySelector';
import { cn } from '@/lib/utils/cn';

// Landing page component for unauthenticated users
function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-4xl mx-auto text-center px-6">
        <div className="mb-8">
          <div className="mx-auto h-20 w-20 bg-gradient-to-r from-primary to-accent rounded-2xl flex items-center justify-center mb-6">
            <span className="text-3xl font-bold text-white">K</span>
          </div>
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Welcome to Kanbanix
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Transform your GitHub repositories into powerful Kanban boards. 
            Sync issues, track pull requests, and collaborate seamlessly.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="h-12 w-12 bg-blue-500/10 rounded-lg flex items-center justify-center mb-4">
              <svg className="h-6 w-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">GitHub Integration</h3>
            <p className="text-muted-foreground text-sm">
              Import your repositories as projects and sync GitHub issues with Kanban cards automatically.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="h-12 w-12 bg-green-500/10 rounded-lg flex items-center justify-center mb-4">
              <svg className="h-6 w-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Real-time Collaboration</h3>
            <p className="text-muted-foreground text-sm">
              Comment on tasks, track pull requests, and collaborate with your team directly from the board.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="h-12 w-12 bg-purple-500/10 rounded-lg flex items-center justify-center mb-4">
              <svg className="h-6 w-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Workflow Automation</h3>
            <p className="text-muted-foreground text-sm">
              Automate your development workflow with smart task management and progress tracking.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <div className="h-12 w-12 bg-orange-500/10 rounded-lg flex items-center justify-center mb-4">
              <svg className="h-6 w-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Progress Insights</h3>
            <p className="text-muted-foreground text-sm">
              Get detailed insights into your project progress with visual analytics and reporting.
            </p>
          </div>
        </div>

        <div className="bg-gradient-to-r from-primary/10 to-accent/10 rounded-2xl p-8 border border-primary/20">
          <h2 className="text-2xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-muted-foreground mb-6">
            Connect your GitHub account and start managing your projects with powerful Kanban boards.
          </p>
          <p className="text-sm text-muted-foreground">
            Click the "Sign in with GitHub" button in the header to begin your journey.
          </p>
        </div>
      </div>
    </div>
  );
}

// Dashboard component for authenticated users
function Dashboard() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isRepositorySelectorOpen, setIsRepositorySelectorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        setProjects(data);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.techStack.some((tech) =>
      tech.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  const handleCreateProject = async (projectData: {
    name: string;
    description?: string;
    type: 'ai-agent' | 'standard' | 'template';
    techStack: string[];
  }) => {
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(projectData),
      });
      
      if (response.ok) {
        await fetchProjects();
        setIsCreateModalOpen(false);
      }
    } catch (error) {
      console.error('Error creating project:', error);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (confirm('Are you sure you want to delete this project?')) {
      try {
        const response = await fetch(`/api/projects?id=${id}`, {
          method: 'DELETE',
        });
        
        if (response.ok) {
          await fetchProjects();
        }
      } catch (error) {
        console.error('Error deleting project:', error);
      }
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="text-center mb-6">
            <h1 className="text-4xl font-bold mb-4">Your Projects</h1>
            <p className="text-muted-foreground">
              Manage your GitHub repositories as Kanban projects
            </p>
          </div>
          
          {/* Action buttons */}
          <div className="flex justify-center gap-4 mb-6">
            <button
              onClick={() => setIsRepositorySelectorOpen(true)}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Github className="h-5 w-5" />
              Import from GitHub
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-6 py-3 border border-input rounded-lg hover:bg-secondary transition-colors"
            >
              <Plus className="h-5 w-5" />
              Create New Project
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading projects...</p>
            </div>
          </div>
        ) : (
          <>
        <div className="mb-6 max-w-md mx-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={handleDeleteProject}
            />
          ))}

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className={cn(
              "h-64 rounded-2xl border-2 border-dashed border-border",
              "flex flex-col items-center justify-center gap-4",
              "hover:border-primary hover:bg-secondary/50 transition-all cursor-pointer group"
            )}
          >
            <div className="p-4 rounded-full bg-secondary group-hover:bg-primary/10 transition-colors">
              <Plus className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <span className="text-lg font-medium text-muted-foreground group-hover:text-primary transition-colors">
              Create New Project
            </span>
          </button>
        </div>

        {filteredProjects.length === 0 && searchQuery && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              No projects found matching &quot;{searchQuery}&quot;
            </p>
          </div>
        )}

        {projects.length === 0 && !searchQuery && (
          <div className="text-center py-12">
            <h2 className="text-2xl font-semibold mb-2">No projects yet</h2>
            <p className="text-muted-foreground mb-6">
              Create your first project to get started
            </p>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="px-6 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
            >
              <Plus className="h-5 w-5" />
              Create Project
            </button>
          </div>
        )}
          </>
        )}
      </div>

      <CreateProjectModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onCreateProject={handleCreateProject}
      />

      {isRepositorySelectorOpen && (
        <RepositorySelector
          onSelectRepository={async (repo) => {
            console.log('Selected repository:', repo);
            setIsRepositorySelectorOpen(false);
            // Refresh projects after import
            setTimeout(() => fetchProjects(), 1000);
          }}
          onClose={() => setIsRepositorySelectorOpen(false)}
        />
      )}
    </div>
  );
}

export default function ProjectsDashboard() {
  const { data: session, status } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  // Show loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show landing page for unauthenticated users
  if (!session) {
    return <LandingPage />;
  }

  // Show dashboard for authenticated users
  return <Dashboard />;
}