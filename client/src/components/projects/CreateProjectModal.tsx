'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Label from '@radix-ui/react-label';
import * as Select from '@radix-ui/react-select';
import { X, ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateProject: (project: {
    name: string;
    description?: string;
    type: 'ai-agent' | 'standard' | 'template';
    techStack: string[];
  }) => void;
}

const techStackOptions = [
  'Next.js',
  'React',
  'TypeScript',
  'JavaScript',
  'Tailwind CSS',
  'Node.js',
  'Python',
  'Go',
  'Rust',
  'Docker',
  'PostgreSQL',
  'MongoDB',
  'Redis',
  'GraphQL',
  'REST API',
];

export default function CreateProjectModal({
  open,
  onOpenChange,
  onCreateProject,
}: CreateProjectModalProps) {
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [projectType, setProjectType] = useState<'ai-agent' | 'standard' | 'template'>('standard');
  const [selectedTech, setSelectedTech] = useState<string[]>([]);
  const [aiEnabled, setAiEnabled] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) return;

    onCreateProject({
      name: projectName,
      description: description || undefined,
      type: projectType,
      techStack: selectedTech,
    });

    setProjectName('');
    setDescription('');
    setProjectType('standard');
    setSelectedTech([]);
    setAiEnabled(false);
    onOpenChange(false);
  };

  const toggleTech = (tech: string) => {
    setSelectedTech((prev) =>
      prev.includes(tech)
        ? prev.filter((t) => t !== tech)
        : [...prev, tech]
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in" />
        <Dialog.Content className="fixed left-[50%] top-[50%] max-h-[85vh] w-[90vw] max-w-[500px] translate-x-[-50%] translate-y-[-50%] rounded-2xl bg-card p-6 shadow-xl animate-in fade-in-0 zoom-in-95">
          <Dialog.Title className="text-xl font-semibold mb-4">
            Create New Project
          </Dialog.Title>
          
          <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Dialog.Close>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label.Root htmlFor="name" className="text-sm font-medium">
                Project Name *
              </Label.Root>
              <input
                id="name"
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="My Awesome Project"
                required
              />
            </div>

            <div className="space-y-2">
              <Label.Root htmlFor="description" className="text-sm font-medium">
                Description
              </Label.Root>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px] resize-none"
                placeholder="Brief description of your project..."
              />
            </div>

            <div className="space-y-2">
              <Label.Root className="text-sm font-medium">
                Project Type
              </Label.Root>
              <Select.Root value={projectType} onValueChange={(value) => setProjectType(value as 'ai-agent' | 'standard' | 'template')}>
                <Select.Trigger className="w-full px-3 py-2 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring flex items-center justify-between">
                  <Select.Value />
                  <Select.Icon>
                    <ChevronDown className="h-4 w-4" />
                  </Select.Icon>
                </Select.Trigger>
                
                <Select.Portal>
                  <Select.Content className="overflow-hidden bg-card rounded-lg shadow-lg border border-border">
                    <Select.Viewport className="p-1">
                      <Select.Item
                        value="standard"
                        className="relative flex items-center px-8 py-2 text-sm rounded-md hover:bg-secondary cursor-pointer outline-none"
                      >
                        <Select.ItemText>Standard</Select.ItemText>
                        <Select.ItemIndicator className="absolute left-2">
                          <Check className="h-4 w-4" />
                        </Select.ItemIndicator>
                      </Select.Item>
                      
                      <Select.Item
                        value="ai-agent"
                        className="relative flex items-center px-8 py-2 text-sm rounded-md hover:bg-secondary cursor-pointer outline-none"
                      >
                        <Select.ItemText>AI Agent</Select.ItemText>
                        <Select.ItemIndicator className="absolute left-2">
                          <Check className="h-4 w-4" />
                        </Select.ItemIndicator>
                      </Select.Item>
                      
                      <Select.Item
                        value="template"
                        className="relative flex items-center px-8 py-2 text-sm rounded-md hover:bg-secondary cursor-pointer outline-none"
                      >
                        <Select.ItemText>Template</Select.ItemText>
                        <Select.ItemIndicator className="absolute left-2">
                          <Check className="h-4 w-4" />
                        </Select.ItemIndicator>
                      </Select.Item>
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
            </div>

            <div className="space-y-2">
              <Label.Root className="text-sm font-medium">
                Technology Stack
              </Label.Root>
              <div className="flex flex-wrap gap-2">
                {techStackOptions.map((tech) => (
                  <button
                    key={tech}
                    type="button"
                    onClick={() => toggleTech(tech)}
                    className={cn(
                      "px-3 py-1 text-sm rounded-full border transition-colors",
                      selectedTech.includes(tech)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-input hover:bg-secondary"
                    )}
                  >
                    {tech}
                  </button>
                ))}
              </div>
            </div>

            {projectType === 'ai-agent' && (
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="ai-features"
                  checked={aiEnabled}
                  onChange={(e) => setAiEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                <Label.Root htmlFor="ai-features" className="text-sm">
                  Enable AI agent orchestration features
                </Label.Root>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-input hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Create Project
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}