# GitHub Integration Guide for Kanbanix

## Overview
This guide outlines the complete GitHub integration for Kanbanix, enabling users to sync their GitHub repositories with the Kanban board, manage issues, pull requests, and collaborate directly from within the application.

## Table of Contents
1. [Authentication Flow](#authentication-flow)
2. [Repository Management](#repository-management)
3. [Bidirectional Data Sync](#bidirectional-data-sync)
4. [Database Schema](#database-schema)
5. [API Implementation](#api-implementation)
6. [UI/UX Flow](#uiux-flow)

---

## 1. Authentication Flow

### GitHub OAuth Setup

#### Step 1: Register GitHub OAuth App
1. Go to GitHub Settings > Developer Settings > OAuth Apps
2. Create new OAuth App with:
   - **Application Name**: Kanbanix
   - **Homepage URL**: `http://localhost:3000` (development)
   - **Authorization callback URL**: `http://localhost:3000/api/auth/github/callback`
3. Save Client ID and Client Secret

#### Step 2: Environment Configuration
```env
# .env.local
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret
```

#### Step 3: Install Dependencies
```bash
npm install next-auth @octokit/rest @octokit/webhooks prisma @prisma/client
```

#### Step 4: NextAuth Configuration
```typescript
// src/app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth';
import GithubProvider from 'next-auth/providers/github';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { prisma } from '@/lib/prisma';

const handler = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'read:user user:email repo write:repo_hook',
        },
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.userId = token.sub;
      return session;
    },
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
  },
});

export { handler as GET, handler as POST };
```

---

## 2. Repository Management

### User Flow After Login

#### Step 1: Fetch User Repositories
After successful login, users can see all their GitHub repositories in a searchable dropdown.

```typescript
// src/app/api/github/repos/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Octokit } from '@octokit/rest';

export async function GET() {
  const session = await getServerSession();
  
  if (!session?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const octokit = new Octokit({
    auth: session.accessToken,
  });

  try {
    const { data: repos } = await octokit.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 100,
    });

    return NextResponse.json(repos);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch repositories' }, { status: 500 });
  }
}
```

#### Step 2: Repository Selection UI
```typescript
// src/components/github/RepositorySelector.tsx
import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';

export function RepositorySelector({ onSelectRepo }) {
  const [repos, setRepos] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRepositories();
  }, []);

  const fetchRepositories = async () => {
    const response = await fetch('/api/github/repos');
    const data = await response.json();
    setRepos(data);
    setLoading(false);
  };

  const filteredRepos = repos.filter(repo => 
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    repo.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="repository-selector">
      <div className="search-container">
        <Search className="search-icon" />
        <input
          type="text"
          placeholder="Search repositories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>
      
      <div className="repos-grid">
        {filteredRepos.map(repo => (
          <div 
            key={repo.id} 
            className="repo-card"
            onClick={() => onSelectRepo(repo)}
          >
            <h3>{repo.name}</h3>
            <p>{repo.description}</p>
            <div className="repo-stats">
              <span>⭐ {repo.stargazers_count}</span>
              <span>🍴 {repo.forks_count}</span>
              <span>{repo.language}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### Step 3: Import Repository as Project
When a user clicks on a repository, it creates a project in Kanbanix and redirects to the Kanban board:

```typescript
// src/app/api/github/import-repo/route.ts
export async function POST(request: Request) {
  const { repoId, repoName, repoDescription, repoUrl } = await request.json();
  const session = await getServerSession();

  // Create project in database
  const project = await prisma.project.create({
    data: {
      name: repoName,
      description: repoDescription,
      githubRepoId: repoId,
      githubRepoUrl: repoUrl,
      userId: session.userId,
      columns: {
        create: [
          { name: 'To Do', order: 0 },
          { name: 'In Progress', order: 1 },
          { name: 'In Review', order: 2 },
          { name: 'Done', order: 3 },
        ],
      },
    },
  });

  // Import existing issues as tasks
  const octokit = new Octokit({ auth: session.accessToken });
  const { data: issues } = await octokit.issues.listForRepo({
    owner: repoName.split('/')[0],
    repo: repoName.split('/')[1],
    state: 'open',
  });

  for (const issue of issues) {
    await prisma.task.create({
      data: {
        title: issue.title,
        description: issue.body,
        githubIssueNumber: issue.number,
        projectId: project.id,
        columnId: project.columns[0].id, // Default to "To Do"
      },
    });
  }

  return NextResponse.json({ projectId: project.id });
}
```

---

## 3. Bidirectional Data Sync

### Creating New Projects in GitHub

When a user creates a new project in Kanbanix, it automatically creates a corresponding repository in GitHub:

```typescript
// src/app/api/projects/create/route.ts
export async function POST(request: Request) {
  const { name, description, isPrivate } = await request.json();
  const session = await getServerSession();
  
  const octokit = new Octokit({ auth: session.accessToken });

  // Create GitHub repository
  const { data: repo } = await octokit.repos.createForAuthenticatedUser({
    name,
    description,
    private: isPrivate,
    auto_init: true,
  });

  // Create project in database
  const project = await prisma.project.create({
    data: {
      name,
      description,
      githubRepoId: repo.id,
      githubRepoUrl: repo.html_url,
      userId: session.userId,
    },
  });

  return NextResponse.json(project);
}
```

### Fetching and Posting GitHub Comments

#### Fetch PR Comments
```typescript
// src/app/api/github/pr/[prNumber]/comments/route.ts
export async function GET(request: Request, { params }) {
  const session = await getServerSession();
  const { projectId } = request.nextUrl.searchParams;
  
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  const octokit = new Octokit({ auth: session.accessToken });
  
  const { data: comments } = await octokit.issues.listComments({
    owner: project.githubRepoUrl.split('/')[3],
    repo: project.githubRepoUrl.split('/')[4],
    issue_number: params.prNumber,
  });

  return NextResponse.json(comments);
}
```

#### Post Comment to GitHub
```typescript
// src/app/api/github/pr/[prNumber]/comments/route.ts
export async function POST(request: Request, { params }) {
  const { body, projectId } = await request.json();
  const session = await getServerSession();
  
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  const octokit = new Octokit({ auth: session.accessToken });
  
  const { data: comment } = await octokit.issues.createComment({
    owner: project.githubRepoUrl.split('/')[3],
    repo: project.githubRepoUrl.split('/')[4],
    issue_number: params.prNumber,
    body,
  });

  return NextResponse.json(comment);
}
```

### Resolve PR Conversations
```typescript
// src/app/api/github/pr/[prNumber]/resolve/route.ts
export async function POST(request: Request, { params }) {
  const { threadId, projectId } = await request.json();
  const session = await getServerSession();
  
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  const octokit = new Octokit({ auth: session.accessToken });
  
  // GraphQL API for resolving conversation
  const mutation = `
    mutation($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) {
        thread {
          id
          isResolved
        }
      }
    }
  `;

  const result = await octokit.graphql(mutation, { threadId });
  
  return NextResponse.json(result);
}
```

### Fetch PR Diffs
```typescript
// src/app/api/github/pr/[prNumber]/diff/route.ts
export async function GET(request: Request, { params }) {
  const session = await getServerSession();
  const { projectId } = request.nextUrl.searchParams;
  
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  const octokit = new Octokit({ auth: session.accessToken });
  
  const { data: pr } = await octokit.pulls.get({
    owner: project.githubRepoUrl.split('/')[3],
    repo: project.githubRepoUrl.split('/')[4],
    pull_number: params.prNumber,
  });

  const { data: files } = await octokit.pulls.listFiles({
    owner: project.githubRepoUrl.split('/')[3],
    repo: project.githubRepoUrl.split('/')[4],
    pull_number: params.prNumber,
  });

  return NextResponse.json({ pr, files });
}
```

---

## 4. Database Schema

### Prisma Schema with GitHub Integration

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  githubId      String?   @unique
  githubToken   String?
  avatarUrl     String?
  projects      Project[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model Project {
  id            String    @id @default(cuid())
  name          String
  description   String?
  githubRepoId  String?   @unique
  githubRepoUrl String?
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  columns       Column[]
  tasks         Task[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model Column {
  id        String   @id @default(cuid())
  name      String
  order     Int
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tasks     Task[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Task {
  id                 String    @id @default(cuid())
  title              String
  description        String?
  status             String
  priority           String?
  githubIssueNumber  Int?
  githubPrNumber     Int?
  githubBranch       String?
  projectId          String
  project            Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  columnId           String
  column             Column    @relation(fields: [columnId], references: [id])
  assigneeGithubId   String?
  labels             String?   // JSON string
  order              Int
  metadata           String?   // JSON string for logs, comments, etc.
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
}
```

---

## 5. Webhook Integration

### GitHub Webhook Handler
Set up webhooks to receive real-time updates from GitHub:

```typescript
// src/app/api/webhooks/github/route.ts
import { createHmac } from 'crypto';

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  
  // Verify webhook signature
  const secret = process.env.GITHUB_WEBHOOK_SECRET!;
  const hash = createHmac('sha256', secret).update(body).digest('hex');
  const expectedSignature = `sha256=${hash}`;
  
  if (signature !== expectedSignature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(body);
  const event = request.headers.get('x-github-event');

  switch (event) {
    case 'issues':
      await handleIssueEvent(payload);
      break;
    case 'pull_request':
      await handlePullRequestEvent(payload);
      break;
    case 'issue_comment':
      await handleCommentEvent(payload);
      break;
    case 'push':
      await handlePushEvent(payload);
      break;
  }

  return NextResponse.json({ success: true });
}

async function handleIssueEvent(payload) {
  const { action, issue, repository } = payload;
  
  const project = await prisma.project.findUnique({
    where: { githubRepoId: repository.id.toString() },
  });

  if (!project) return;

  if (action === 'opened') {
    await prisma.task.create({
      data: {
        title: issue.title,
        description: issue.body,
        githubIssueNumber: issue.number,
        projectId: project.id,
        columnId: project.columns[0].id,
      },
    });
  } else if (action === 'closed') {
    await prisma.task.updateMany({
      where: { 
        githubIssueNumber: issue.number,
        projectId: project.id,
      },
      data: { status: 'done' },
    });
  }
}
```

---

## 6. UI/UX Flow

### Complete User Journey

1. **Login Flow**
   - User clicks "Login with GitHub"
   - Redirected to GitHub OAuth
   - After authorization, returned to app dashboard

2. **Project Dashboard**
   - Shows existing Kanbanix projects
   - "Import from GitHub" button
   - "Create New Project" button (creates in both Kanbanix and GitHub)

3. **Repository Import**
   ```typescript
   // src/app/page.tsx (Dashboard)
   const handleImportRepo = async (repo) => {
     const response = await fetch('/api/github/import-repo', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         repoId: repo.id,
         repoName: repo.full_name,
         repoDescription: repo.description,
         repoUrl: repo.html_url,
       }),
     });
     
     const { projectId } = await response.json();
     router.push(`/project/${projectId}`);
   };
   ```

4. **Kanban Board with GitHub Integration**
   - Tasks sync with GitHub Issues
   - PR status shown on cards
   - Comments sync bidirectionally
   - Activity feed from GitHub

5. **Task Details Panel**
   - **Logs Tab**: Build logs, CI/CD status
   - **Diffs Tab**: PR file changes from GitHub
   - **Comments Tab**: GitHub issue/PR comments (can reply)
   - **Activity Tab**: GitHub events (commits, reviews, etc.)

---

## 7. Implementation Checklist

### Phase 1: Authentication & Basic Setup
- [ ] Set up GitHub OAuth application
- [ ] Configure NextAuth with GitHub provider
- [ ] Create Prisma schema with GitHub fields
- [ ] Set up SQLite database

### Phase 2: Repository Management
- [ ] Implement repository fetching API
- [ ] Create repository selector UI
- [ ] Implement repository import functionality
- [ ] Add create new GitHub repo from app

### Phase 3: Bidirectional Sync
- [ ] Fetch GitHub issues as tasks
- [ ] Sync task status with issue status
- [ ] Implement comment fetching from GitHub
- [ ] Add ability to post comments to GitHub
- [ ] Implement resolve conversation feature

### Phase 4: Advanced Features
- [ ] Set up GitHub webhooks
- [ ] Implement real-time updates
- [ ] Add PR diff viewing
- [ ] Integrate GitHub Actions status
- [ ] Add commit history to activity feed

### Phase 5: Polish & Optimization
- [ ] Add caching for GitHub API calls
- [ ] Implement rate limiting handling
- [ ] Add offline support with sync queue
- [ ] Optimize webhook processing
- [ ] Add error handling and retry logic

---

## Environment Variables Summary

```env
# .env.local
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_WEBHOOK_SECRET=your_webhook_secret
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret
DATABASE_URL="file:./dev.db"
```

---

## Security Considerations

1. **Token Storage**: Store GitHub access tokens securely using encryption
2. **Webhook Verification**: Always verify webhook signatures
3. **Rate Limiting**: Implement rate limiting for API calls
4. **Permissions**: Request only necessary GitHub scopes
5. **Data Privacy**: Don't store sensitive GitHub data unnecessarily

---

## Testing

### Local Development
1. Use ngrok for webhook testing: `ngrok http 3000`
2. Update GitHub webhook URL to ngrok URL
3. Test with personal repositories first

### Integration Tests
```typescript
// __tests__/github-integration.test.ts
describe('GitHub Integration', () => {
  test('should fetch user repositories', async () => {
    // Test implementation
  });
  
  test('should create GitHub issue from task', async () => {
    // Test implementation
  });
  
  test('should sync comments bidirectionally', async () => {
    // Test implementation
  });
});
```

---

## Troubleshooting

### Common Issues

1. **401 Unauthorized**: Check if access token is valid and has required scopes
2. **Rate Limiting**: Implement caching and batch requests
3. **Webhook Not Receiving**: Verify webhook secret and URL
4. **Sync Delays**: Check webhook processing queue

---

## Resources

- [GitHub OAuth Documentation](https://docs.github.com/en/developers/apps/building-oauth-apps)
- [GitHub REST API](https://docs.github.com/en/rest)
- [GitHub GraphQL API](https://docs.github.com/en/graphql)
- [NextAuth.js Documentation](https://next-auth.js.org/)
- [Octokit Documentation](https://octokit.github.io/rest.js/)