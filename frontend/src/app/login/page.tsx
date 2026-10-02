'use client';

// Login screen.
//
// NOTE: this page is an addition. Upstream the frontend shipped with no auth UI
// at all -- src/lib/api.ts reads localStorage['accessToken'] and sends it as a
// Bearer token, but nothing in the app ever wrote that key and there was no
// /login route, so every API call left the browser unauthenticated and each
// page rendered empty off a 401.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, Loader2, AlertCircle } from 'lucide-react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export default function LoginPage() {
  const router = useRouter();
  const [tenantSlug, setTenantSlug] = useState('acme');
  const [email, setEmail] = useState('admin@acme.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, tenantSlug }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(body?.error?.message || `Sign in failed (HTTP ${res.status})`);
      }

      // The API client reads these two keys; the refresh token is kept so a
      // future refresh flow has it available.
      localStorage.setItem('accessToken', body.accessToken);
      if (body.refreshToken) localStorage.setItem('refreshToken', body.refreshToken);
      if (body.user) localStorage.setItem('user', JSON.stringify(body.user));

      router.push('/');
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="w-full max-w-md">
        <div className="card p-8 bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-primary-100 dark:bg-primary-900 rounded-lg">
              <LogIn size={22} className="text-primary-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Sign in</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Enterprise CRM</p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 mb-4 p-3 rounded-md bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="tenantSlug" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                Tenant
              </label>
              <input
                id="tenantSlug"
                name="tenantSlug"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                required
                autoComplete="organization"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="current-password"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-60"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
