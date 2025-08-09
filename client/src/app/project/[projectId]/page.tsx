'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { useProjectStore } from '@/lib/store/useProjectStore';
import { Project } from '@/types/project';

export default function ProjectBoard() {
  const params = useParams();
  const router = useRouter();
  const { getProject } = useProjectStore();
  const [project, setProject] = useState<Project | undefined>(undefined);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && params.projectId) {
      const foundProject = getProject(params.projectId as string);
      if (foundProject) {
        setProject(foundProject);
      } else {
        router.push('/');
      }
    }
  }, [params.projectId, getProject, router, mounted]);

  if (!mounted || !project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="p-2 rounded-lg hover:bg-secondary transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Link href="/" className="hover:text-foreground transition-colors">
                    Projects
                  </Link>
                  <span>/</span>
                  <span className="text-foreground">{project.name}</span>
                </nav>
                <h1 className="text-xl font-semibold">{project.name}</h1>
              </div>
            </div>
            
            <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Task
            </button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        <div className="flex gap-4 overflow-x-auto pb-4">
          {project.columns.map((column) => (
            <div
              key={column.id}
              className="flex-shrink-0 w-80"
            >
              <div className="bg-card rounded-lg border border-border">
                <div className="p-4 border-b border-border">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: column.color }}
                    />
                    <h3 className="font-medium">{column.name}</h3>
                    <span className="ml-auto text-sm text-muted-foreground">0</span>
                  </div>
                </div>
                
                <div className="p-4 min-h-[400px]">
                  <div className="text-center py-8 text-muted-foreground">
                    <p className="text-sm">No tasks yet</p>
                    <button className="mt-2 text-primary hover:underline text-sm">
                      Create your first task
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}