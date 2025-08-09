'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signIn, signOut } from 'next-auth/react';
import { Home, Server, Settings, FileText, Moon, Sun, Github, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useState, useEffect } from 'react';

export default function Header() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check if dark mode is set in localStorage or system preference
    const storedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (storedTheme === 'dark' || (!storedTheme && systemPrefersDark)) {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDark(false);
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    
    if (newTheme) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const navigation = [
    { name: 'Projects', href: '/', icon: Home },
    { name: 'MCP Servers', href: '/mcp-servers', icon: Server },
    { name: 'Settings', href: '/settings', icon: Settings },
    { name: 'Docs', href: '/docs', icon: FileText },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center space-x-2">
              <span className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                KANBANIX
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-6">
              {navigation.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary',
                      pathname === item.href
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-secondary transition-colors"
              aria-label="Toggle theme"
            >
              {isDark ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </button>

            {status === 'loading' ? (
              <div className="h-8 w-8 rounded-full bg-secondary animate-pulse"></div>
            ) : session ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2">
                  <img
                    src={session.user?.image || ''}
                    alt={session.user?.name || 'User'}
                    className="h-6 w-6 rounded-full"
                  />
                  <span className="text-sm font-medium">{session.user?.name}</span>
                </div>
                <button
                  onClick={() => signOut()}
                  className="p-2 rounded-lg hover:bg-secondary transition-colors"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => signIn('github', { 
                  callbackUrl: window.location.href 
                })}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Github className="h-4 w-4" />
                <span className="hidden sm:inline">Sign in with GitHub</span>
                <span className="sm:hidden">Sign in</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}