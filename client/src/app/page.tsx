'use client';

import { useState, useEffect } from 'react';
import { Plus, Search } from 'lucide-react';
import ProjectCard from '@/components/projects/ProjectCard';
import CreateProjectModal from '@/components/projects/CreateProjectModal';
import { useProjectStore } from '@/lib/store/useProjectStore';
import { cn } from '@/lib/utils/cn';

export default function ProjectsDashboard() {
  const { projects, addProject, deleteProject } = useProjectStore();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.techStack.some((tech) =>
      tech.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  const handleCreateProject = (projectData: {
    name: string;
    description?: string;
    type: 'ai-agent' | 'standard' | 'template';
    techStack: string[];
  }) => {
    addProject(projectData);
  };

  const handleDeleteProject = (id: string) => {
    if (confirm('Are you sure you want to delete this project?')) {
      deleteProject(id);
    }
  };

  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold mb-4">Your AI Projects</h1>
        </div>

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
              No projects found matching "{searchQuery}"
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
      </div>

      <CreateProjectModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onCreateProject={handleCreateProject}
      />
    </div>
  );
}