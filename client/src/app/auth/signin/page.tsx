'use client';

import { signIn, getSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Github } from 'lucide-react';

export default function SignIn() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const callbackUrl = searchParams.get('callbackUrl') || '/';

  useEffect(() => {
    // Check if user is already signed in
    const checkSession = async () => {
      const session = await getSession();
      if (session) {
        router.push('/');
      }
    };
    checkSession();
  }, [router]);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      await signIn('github', { 
        callbackUrl,
        redirect: true,
      });
    } catch (error) {
      console.error('Sign in error:', error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 bg-gradient-to-r from-primary to-secondary rounded-lg flex items-center justify-center mb-4">
            <span className="text-xl font-bold text-white">K</span>
          </div>
          <h2 className="text-3xl font-bold">Welcome to Kanbanix</h2>
          <p className="mt-2 text-muted-foreground">
            Connect your GitHub account to get started
          </p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive text-center">
              {error === 'Callback' 
                ? 'Authentication failed. Please try signing in again.'
                : `Error: ${error}`}
            </p>
          </div>
        )}

        <div className="mt-8 space-y-4">
          <button
            onClick={handleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-input rounded-lg bg-card hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-foreground"></div>
            ) : (
              <Github className="h-5 w-5" />
            )}
            <span className="font-medium">
              {loading ? 'Signing in...' : 'Continue with GitHub'}
            </span>
          </button>

          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              By signing in, you agree to sync your GitHub repositories
              <br />
              with your Kanban boards
            </p>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-border">
          <div className="text-center space-y-2">
            <h3 className="font-medium">What you can do:</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Import GitHub repositories as Kanban projects</li>
              <li>• Sync GitHub Issues with task cards</li>
              <li>• Track Pull Requests in your boards</li>
              <li>• Comment and collaborate directly from the app</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}