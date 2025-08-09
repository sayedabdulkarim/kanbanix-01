import NextAuth from 'next-auth';
import GithubProvider from 'next-auth/providers/github';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

const prisma = global.prisma || new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: 'jwt' as const,
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'read:user user:email repo write:repo_hook admin:repo_hook read:org',
        },
      },
    }),
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Always redirect to the base URL after sign in
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      else if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
    async session({ session, token }: any) {
      if (token) {
        session.user.id = token.sub; // Use sub which contains the user ID
        session.user.name = token.name;
        session.user.email = token.email;
        session.user.image = token.picture;
        session.accessToken = token.accessToken;
      }
      return session;
    },
    async jwt({ token, account, user, profile }: any) {
      // Initial sign in
      if (account && profile) {
        // Create or update user in database
        const githubId = profile.id.toString();
        const email = profile.email;
        
        // First try to find by githubId
        let dbUser = await prisma.user.findUnique({
          where: { githubId },
        });
        
        // If not found by githubId, try to find by email
        if (!dbUser && email) {
          dbUser = await prisma.user.findUnique({
            where: { email },
          });
          
          // If found by email, update the githubId
          if (dbUser) {
            dbUser = await prisma.user.update({
              where: { id: dbUser.id },
              data: {
                githubId,
                name: profile.name || profile.login,
                image: profile.avatar_url,
              },
            });
          }
        }
        
        // If still not found, create new user
        if (!dbUser) {
          dbUser = await prisma.user.create({
            data: {
              githubId,
              email: email || `${profile.login}@github.local`, // Fallback email if null
              name: profile.name || profile.login,
              image: profile.avatar_url,
            },
          });
        }
        
        token.accessToken = account.access_token;
        token.sub = dbUser.id; // Store database user ID
        token.name = dbUser.name;
        token.email = dbUser.email;
        token.picture = dbUser.image;
      }
      return token;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };