'use client';

import { useRouter } from 'next/navigation';
import { MoreVertical, Settings, Trash2 } from 'lucide-react';
import { Project } from '@/types/project';
import { cn } from '@/lib/utils/cn';
import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface ProjectCardProps {
  project: Project;
  onDelete?: (id: string) => void;
  onEdit?: (id: string) => void;
}

export default function ProjectCard({ project, onDelete, onEdit }: ProjectCardProps) {
  const router = useRouter();
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    router.push(`/project/${project.id}`);
  };

  const getTimeAgo = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `Modified ${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `Modified ${hours} hour${hours > 1 ? 's' : ''} ago`;
    return 'Modified recently';
  };

  return (
    <div
      className={cn(
        "relative group cursor-pointer transition-all duration-300 transform",
        isHovered && "scale-[1.02]"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      <div className="relative h-64 rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow">
        <div
          className="absolute inset-0 opacity-90"
          style={{ background: project.gradient }}
        />
        
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
          <div className="text-5xl font-bold mb-4">
            {project.initials}
          </div>
        </div>

        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="p-2 rounded-lg bg-white/20 backdrop-blur hover:bg-white/30 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4 text-white" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-[160px] bg-card rounded-lg p-1 shadow-lg border border-border"
                sideOffset={5}
              >
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-secondary rounded-md outline-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit?.(project.id);
                  }}
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </DropdownMenu.Item>
                
                <DropdownMenu.Item
                  className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-destructive/10 text-destructive rounded-md outline-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete?.(project.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="font-semibold text-lg">{project.name}</h3>
        <p className="text-sm text-muted-foreground">
          {getTimeAgo(project.modifiedAt)}
        </p>
        
        {project.techStack.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {project.techStack.map((tech) => (
              <span
                key={tech}
                className="px-2 py-1 text-xs rounded-full bg-secondary text-secondary-foreground"
              >
                {tech}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}