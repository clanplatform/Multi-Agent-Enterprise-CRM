'use client';

// Sends unauthenticated visitors to /login instead of leaving them on a page
// whose every API call 401s and therefore renders empty. Added alongside the
// login route; upstream had neither.

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const PUBLIC_PATHS = ['/login'];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (isPublic) return;

    if (!localStorage.getItem('accessToken')) {
      router.replace('/login');
      return;
    }
    setChecked(true);
  }, [isPublic, pathname, router]);

  // A public path renders straight through, so /login still server-renders.
  // Gating it too would have made the guard return null on the server for every
  // route, leaving the login form out of the initial HTML.
  if (isPublic) return <>{children}</>;

  // Protected paths wait for the token check so they never flash an empty state
  // before the redirect lands.
  if (!checked) return null;

  return <>{children}</>;
}
