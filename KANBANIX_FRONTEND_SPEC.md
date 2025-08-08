# Kanbanix - Frontend Specification

## Overview
Kanbanix is a modern Kanban board application inspired by Vibe Kanban, focusing on clean UI/UX and efficient task management. The application features a projects dashboard for managing multiple Kanban boards and AI agent orchestration capabilities.

## Application Structure

### Landing Page - Projects Dashboard
The initial view displays all user projects in a grid layout, allowing users to manage and access multiple Kanban boards.

#### Projects Grid View
- **Page Title**: "Your AI Projects" - centered at top
- **Project Cards Grid**:
  - Responsive grid layout (3-4 cards per row on desktop, 2 on tablet, 1 on mobile)
  - Card spacing: 20-24px gap between cards
  - Maximum width container with centered alignment

#### Project Card Design
- **Card Structure**:
  - Gradient background (unique per project)
  - Large project initials or icon in center (e.g., "PR", "TE")
  - Project name below the gradient area
  - Metadata section at bottom
  - Rounded corners (12-16px radius)
  - Subtle shadow/glow effect on hover

- **Card Gradients** (examples):
  - Pink to yellow gradient (for PR projects)
  - Purple to blue gradient 
  - Blue to purple gradient
  - Each project gets a unique gradient combination

- **Card Content**:
  - **Project Identifier**: Large 2-3 letter abbreviation or icon
  - **Project Name**: e.g., "project-4b93e882", "test-01"
  - **Modified Date**: "Modified X hours/days ago" in muted text
  - **Technology Tags**: Small badge pills (Next.js, TypeScript, Tailwind, etc.)

- **Card Interactions**:
  - Click to open project's Kanban board
  - Hover effect: Slight scale (1.02) and glow
  - Context menu on right-click (rename, delete, duplicate)
  - Quick actions on hover (settings icon, delete icon)

#### Dashboard Actions
- **Create New Project** button/card:
  - Plus icon with dashed border
  - Same size as project cards
  - Opens project creation modal
- **Search/Filter** bar at top:
  - Search projects by name
  - Filter by technology stack
  - Sort by date modified, name, etc.

### Project Creation Modal
- **Project Name** input
- **Project Type** selection (AI Agent, Standard, Template)
- **Technology Stack** multi-select
- **Initial Columns** configuration
- **AI Features** toggle (for agent orchestration)
- **Create** and **Cancel** buttons

## Core Features

### 1. Board Layout (Individual Project View)
- **Multi-column layout** with standard Kanban columns:
  - To Do
  - In Progress  
  - In Review
  - Done
  - Cancelled
- **Column headers** with status indicators (colored dots)
- **Task count** per column
- **Responsive grid layout** that adapts to different screen sizes

### 2. Task Cards
#### Card Display
- **Compact card design** with:
  - Task title
  - Task description (preview)
  - Metadata indicators
  - Visual status indicators
  - Hover effects for interactivity

#### Card Actions
- **Drag and drop** between columns
- **Click to expand** for detailed view
- **Quick actions menu** (three dots)
- **Edit inline** capability

### 3. Task Management

#### Create New Task
- **Modal/Dialog for task creation** ("Create GitHub Pull Request" style):
  - Clean, centered modal with backdrop
  - **Header**: "Create New Task" or dynamic based on project type
  
  - **Form Fields**:
    - **Title** field (required)
      - Placeholder: "Update docs to change installation requirements"
      - Auto-focus on open
    
    - **Description** field (optional)
      - Rich text editor with markdown support
      - Placeholder: "All agents are now installed with npx but the user still needs to authenticate outside of vibe-kanban with each coding agent"
      - Min height: 100px, auto-expand
    
    - **Base Branch** selector (for dev tasks)
      - Dropdown with branch list
      - Default: main/master
    
  - **Footer Actions**:
    - **Cancel** button (secondary style)
    - **Create Task** button (primary style)
    - **Create PR** button (when applicable)
    
- **"Add Task" button** placement:
  - Fixed position in board header
  - Dark blue/navy background
  - Plus icon with text
  - Keyboard shortcut (Cmd/Ctrl + N)

#### Edit Task
- **Task Details Panel/Modal**
  - All fields from creation
  - Activity/Comment section
  - Attachments section
  - History/Audit trail
  - Delete option

#### Task Search & Filter
- **Global search bar** at the top
- **Filter options**:
  - By status
  - By priority
  - By assignee
  - By date range
  - By labels

### 4. Navigation & Header

#### Top Navigation Bar (Global)
- **Logo/Brand** (KANBANIX style)
- **Main navigation tabs**:
  - Projects (returns to dashboard)
  - MCP Servers
  - Settings
  - Docs
- **User profile/avatar** section
- **Theme toggle** (light/dark mode)

#### Project-Level Navigation (When inside a project)
- **Breadcrumb navigation**: Projects > [Project Name]
- **Back to Projects** button/link
- **Project settings** gear icon
- **Project info** display (name, last modified)
- **Quick project switcher** dropdown

### 5. Advanced Features

#### Task Details Extended View
When a task card is expanded or clicked, show a detailed panel/modal with:

- **Task Header Section**:
  - Task title (large, editable)
  - Status badge with color
  - Priority indicator
  - Task ID for reference

- **Metadata Display**:
  - Created date/time
  - Last modified date/time
  - Started date/time
  - Completed date/time
  - Time tracking display
  - Task creator/owner

- **Main Content Area**:
  - Rich text description editor
  - Markdown support
  - Code block formatting
  - Image attachments
  - File attachments list

- **Action Buttons Bar**:
  - **Stop Dev** - Red button to stop current process
  - **Create PR** - Blue button to create pull request
  - **Merge** - Green button when PR is ready
  - **New Attempt** - Retry button for failed tasks
  - **Delete** - Danger zone action
  - **Archive** - Soft delete option

- **Tabbed Content Section**:
  - **Logs Tab**:
    - Real-time log streaming area
    - Terminal-style output display
    - Search within logs
    - Copy logs button
    - Clear logs option
    - Timestamp toggles
    - Log level filters (info, warning, error)
    - Auto-scroll toggle
    - "Show X more lines" expansion
  
  - **Diffs Tab**:
    - File changes viewer
    - Syntax highlighted code diffs
    - Side-by-side or unified diff view toggle
    - File tree navigation
    - "X files changed" summary
    - Expand/collapse all files
    - Copy diff to clipboard
    - Line numbers display
  
  - **Comments Tab**:
    - Thread discussions
    - @mentions support
    - Markdown in comments
    - Edit/delete own comments
    - Reactions/emojis
    - Sort by newest/oldest
  
  - **Activity Tab**:
    - Timeline of all actions
    - Status changes history
    - User actions audit trail
    - Automated system events

- **Side Panel Information**:
  - Assignee selector
  - Labels/tags manager
  - Due date picker
  - Time estimate field
  - Actual time spent
  - Related tasks links
  - Blocking/blocked by

#### Real-time Updates
- **Live task status updates**
- **Progress indicators** for running tasks
- **Notification system** for changes

### 6. UI/UX Design System

#### Color Palette
- **Primary colors**:
  - Background: Dark navy/black (#0A0E27 or similar)
  - Card background: Dark gray (#1A1D3A)
  - Accent: Purple/Blue gradient
  - Success: Green
  - Warning: Yellow/Orange
  - Error: Red

#### Typography
- **Font family**: Inter, system-ui, or similar modern sans-serif
- **Font sizes**:
  - Headers: 24-32px
  - Subheaders: 18-20px
  - Body: 14-16px
  - Small text: 12px

#### Spacing & Layout
- **Consistent padding**: 8px grid system
- **Card spacing**: 12-16px gap
- **Border radius**: 8-12px for cards and buttons
- **Shadows**: Subtle elevation for depth

#### Interactive Elements
- **Buttons**:
  - Primary: Gradient or solid color with hover states
  - Secondary: Outlined or ghost buttons
  - Icon buttons: Circular or square with hover effects
- **Transitions**: Smooth 200-300ms for all interactions
- **Loading states**: Skeleton screens or spinners
- **Empty states**: Helpful messages and actions

### 7. Responsive Design

#### Desktop (1200px+)
- Full multi-column layout
- Side panels for details
- Expanded navigation

#### Tablet (768px - 1199px)
- Collapsible sidebar
- Adjustable column widths
- Touch-friendly controls

#### Mobile (< 768px)
- Single column view with horizontal scroll
- Bottom navigation
- Simplified task cards
- Full-screen modals

### 8. Performance Considerations

- **Virtual scrolling** for large task lists
- **Lazy loading** for task details
- **Optimistic UI updates** for better perceived performance
- **Code splitting** by route
- **Image optimization** and lazy loading
- **Service worker** for offline capability

### 9. Accessibility

- **ARIA labels** for all interactive elements
- **Keyboard navigation** support
- **Focus management** in modals
- **Color contrast** WCAG AA compliance
- **Screen reader** announcements for updates

### 10. State Management

#### Local State
- UI state (modals, dropdowns, selections)
- Form state
- Filter/search state

#### Global State
- User authentication
- Current board/project
- Tasks data
- User preferences

#### Persistence
- Local storage for:
  - User preferences
  - Draft tasks
  - Recent searches
- IndexedDB for:
  - Offline task cache
  - Large data sets

## Technology Stack

### Core
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand or Redux Toolkit
- **Data Fetching**: TanStack Query (React Query)

### UI Libraries
- **Drag & Drop**: @dnd-kit or react-beautiful-dnd
- **Modals/Dialogs**: Radix UI or Headless UI
- **Forms**: React Hook Form + Zod
- **Date Picker**: react-datepicker or date-fns
- **Rich Text Editor**: TipTap or Lexical
- **Icons**: Lucide React or Heroicons

### Development Tools
- **Testing**: Jest + React Testing Library
- **E2E Testing**: Playwright or Cypress
- **Linting**: ESLint + Prettier
- **Git Hooks**: Husky + lint-staged

## Implementation Phases

### Phase 1: Foundation & Projects Dashboard (Week 1)
1. Project setup with Next.js, TypeScript, Tailwind
2. Projects dashboard with grid layout
3. Project cards with gradients and metadata
4. Project creation modal
5. Routing between dashboard and individual boards
6. Basic navigation structure

### Phase 2: Kanban Board Core (Week 2)
1. Individual project Kanban view
2. Static board with columns
3. Task cards display
4. Drag and drop implementation
5. Create/Edit task modals
6. Task state management

### Phase 3: Data & Persistence (Week 3)
1. Local storage for projects and tasks
2. Project management (CRUD operations)
3. Task management within projects
4. Search and filter functionality
5. Task details panel

### Phase 4: Enhanced UX (Week 4)
1. Animations and transitions
2. Loading states and error handling
3. Responsive design for all views
4. User preferences per project
5. Performance optimization
6. Accessibility improvements

### Phase 5: Advanced Features (Future)
1. Real-time collaboration
2. AI agent integration
3. Project templates
4. Analytics dashboard per project
5. Export/Import functionality
6. Keyboard shortcuts
7. Command palette
8. Project sharing and permissions


## Routing Structure

### Routes
- `/` - Projects dashboard (landing page)
- `/projects` - Alias for dashboard
- `/project/[projectId]` - Individual Kanban board view
- `/project/[projectId]/settings` - Project settings
- `/project/[projectId]/task/[taskId]` - Direct link to task detail
- `/settings` - Global application settings
- `/docs` - Documentation

### Navigation Flow
1. User lands on Projects Dashboard
2. Clicks on a project card → navigates to `/project/[projectId]`
3. Can navigate back to dashboard via breadcrumb or Projects tab
4. Can switch between projects using quick switcher

## Data Structure

### Project Model
```typescript
interface Project {
  id: string;
  name: string;
  description?: string;
  type: 'ai-agent' | 'standard' | 'template';
  gradient: string; // CSS gradient string
  initials: string; // 2-3 letter abbreviation
  techStack: string[];
  createdAt: Date;
  modifiedAt: Date;
  columns: Column[];
  settings: ProjectSettings;
}
```

### Task Model
```typescript
interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: 'todo' | 'inProgress' | 'inReview' | 'done' | 'cancelled';
  columnId: string;
  order: number;
  priority?: 'low' | 'medium' | 'high';
  assignee?: string;
  labels?: string[];
  createdAt: Date;
  modifiedAt: Date;
  metadata?: TaskMetadata;
}
```

## Questions to Address
1. **Authentication**: Will we implement user authentication initially or start with local-only?
2. **Data Storage**: Start with local storage or implement backend API from beginning?
3. **Collaboration**: Single user or multi-user from start?
4. **Project Limits**: Maximum number of projects per user?
5. **Customization**: Allow custom columns per project or global columns?
6. **Integrations**: GitHub, Jira, Slack integrations planned?
7. **AI Features**: Which AI capabilities to prioritize first?