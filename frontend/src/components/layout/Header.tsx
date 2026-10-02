'use client';

import { Bell, User, Moon, Sun, LogOut } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CommandBar } from '@/components/CommandBar';

export function Header() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(3);
  // Was hardcoded to "John Doe / Sales Manager"; now reflects whoever signed in.
  const [account, setAccount] = useState<{ name?: string; email?: string; roles?: string[] } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('user');
      if (raw) setAccount(JSON.parse(raw));
    } catch {
      // ignore malformed value
    }
  }, []);

  const signOut = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    router.replace('/login');
  };

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  return (
    <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-6">
      {/* Search */}
      <div className="flex-1 max-w-lg">
        <CommandBar />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4">
        {/* Dark mode toggle */}
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        {/* Notifications */}
        <button className="relative p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800">
          <Bell size={20} />
          {notifications > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
              {notifications}
            </span>
          )}
        </button>

        {/* User menu */}
        <div className="flex items-center gap-3 pl-4 border-l border-gray-200 dark:border-gray-700">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-medium text-gray-900 dark:text-white">
              {account?.name || 'Not signed in'}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {account?.roles?.join(', ') || account?.email || '-'}
            </div>
          </div>
          <button className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
            <User size={20} className="text-primary-600" />
          </button>
          <button
            onClick={signOut}
            title="Sign out"
            aria-label="Sign out"
            className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
