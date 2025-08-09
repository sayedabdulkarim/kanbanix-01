# Backend Architecture

## Overview
This backend directory contains all server-side logic for Kanbanix, including GitHub integration, API routes, database models, and authentication.

## Directory Structure

```
backend/
├── api/              # API route handlers
│   ├── auth/         # Authentication endpoints
│   ├── github/       # GitHub API integration
│   ├── projects/     # Project management
│   └── webhooks/     # Webhook handlers
├── lib/              # Shared utilities
│   ├── auth.ts       # Auth utilities
│   ├── github.ts     # GitHub client setup
│   └── prisma.ts     # Database client
├── prisma/           # Database schema & migrations
│   ├── schema.prisma # Database schema
│   └── migrations/   # Database migrations
├── types/            # TypeScript types
│   └── github.ts     # GitHub-related types
└── config/           # Configuration files
    └── constants.ts  # App constants
```

## Setup Instructions

1. Install dependencies:
```bash
npm install @prisma/client prisma @octokit/rest next-auth
```

2. Set up environment variables:
```bash
cp .env.example .env.local
```

3. Initialize database:
```bash
npx prisma generate
npx prisma db push
```

4. Run migrations:
```bash
npx prisma migrate dev
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - GitHub OAuth login
- `GET /api/auth/session` - Get current session
- `POST /api/auth/logout` - Logout user

### GitHub Integration
- `GET /api/github/repos` - List user repositories
- `POST /api/github/import-repo` - Import repository as project
- `GET /api/github/pr/:prNumber/comments` - Get PR comments
- `POST /api/github/pr/:prNumber/comments` - Post comment to PR
- `GET /api/github/pr/:prNumber/diff` - Get PR diff
- `POST /api/github/pr/:prNumber/resolve` - Resolve PR conversation

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create new project
- `GET /api/projects/:id` - Get project details
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Webhooks
- `POST /api/webhooks/github` - GitHub webhook handler