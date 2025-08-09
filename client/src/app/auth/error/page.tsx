'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export default function AuthError() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const getErrorMessage = (error: string | null) => {
    switch (error) {
      case 'Configuration':
        return 'There was a problem with the authentication configuration.';
      case 'AccessDenied':
        return 'Access denied. You may have cancelled the GitHub authorization.';
      case 'Verification':
        return 'The verification token was invalid or has expired.';
      default:
        return 'An unexpected error occurred during authentication.';
    }
  };

  const getErrorSuggestion = (error: string | null) => {
    switch (error) {
      case 'AccessDenied':
        return 'Try signing in again and make sure to authorize the application.';
      case 'Verification':
        return 'Please try signing in again.';
      default:
        return 'Please try again or contact support if the problem persists.';
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 bg-destructive rounded-lg flex items-center justify-center mb-4">
            <AlertCircle className="h-6 w-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold">Authentication Error</h2>
          <p className="mt-2 text-muted-foreground">
            {getErrorMessage(error)}
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm">
            {getErrorSuggestion(error)}
          </p>
          {error === 'Configuration' && (
            <div className="mt-2 text-xs text-muted-foreground">
              <p>If you're a developer, please check:</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>GitHub OAuth app configuration</li>
                <li>Environment variables (CLIENT_ID, CLIENT_SECRET)</li>
                <li>Callback URL: http://localhost:3000/api/auth/callback/github</li>
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Link
            href="/auth/signin"
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Try Again
          </Link>
          <Link
            href="/"
            className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-input rounded-lg hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
        </div>

        {error && (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              Error code: {error}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}