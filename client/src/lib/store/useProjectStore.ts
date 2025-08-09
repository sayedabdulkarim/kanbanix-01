import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Project, Column } from '@/types/project';

interface ProjectStore {
  projects: Project[];
  currentProject: Project | null;
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'modifiedAt' | 'columns'>) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  setCurrentProject: (project: Project | null) => void;
  getProject: (id: string) => Project | undefined;
}

const defaultColumns: Column[] = [
  { id: '1', name: 'To Do', order: 0, color: '#6B7280' },
  { id: '2', name: 'In Progress', order: 1, color: '#3B82F6' },
  { id: '3', name: 'In Review', order: 2, color: '#F59E0B' },
  { id: '4', name: 'Done', order: 3, color: '#10B981' },
  { id: '5', name: 'Cancelled', order: 4, color: '#EF4444' },
];

const gradients = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
];

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      currentProject: null,
      
      addProject: (projectData) => {
        const newProject: Project = {
          ...projectData,
          id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          createdAt: new Date(),
          modifiedAt: new Date(),
          columns: [...defaultColumns],
          gradient: projectData.gradient || gradients[Math.floor(Math.random() * gradients.length)],
          initials: projectData.initials || projectData.name.slice(0, 2).toUpperCase(),
        };
        
        set((state) => ({
          projects: [...state.projects, newProject],
        }));
      },
      
      updateProject: (id, updates) => {
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id
              ? { ...project, ...updates, modifiedAt: new Date() }
              : project
          ),
        }));
      },
      
      deleteProject: (id) => {
        set((state) => ({
          projects: state.projects.filter((project) => project.id !== id),
          currentProject: state.currentProject?.id === id ? null : state.currentProject,
        }));
      },
      
      setCurrentProject: (project) => {
        set({ currentProject: project });
      },
      
      getProject: (id) => {
        return get().projects.find((project) => project.id === id);
      },
    }),
    {
      name: 'kanbanix-projects',
    }
  )
);