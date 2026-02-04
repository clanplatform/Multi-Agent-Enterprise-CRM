'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { TelemetryProvider } from '@/components/TelemetryProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  // Capture unhandled errors and promise rejections to keep UI stable
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      console.error('Unhandled error', event.error || event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled rejection', event.reason);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return (
    <TelemetryProvider>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </TelemetryProvider>
  );
}
