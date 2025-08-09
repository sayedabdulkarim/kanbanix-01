'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Server, Settings, FileText, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useState, useEffect } from 'react';

export default function Header() {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDark(darkMode);
  }, []);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle('dark');
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

            <div className="h-8 w-8 rounded-full bg-gradient-to-r from-primary to-accent flex items-center justify-center text-white text-sm font-medium">
              U
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}