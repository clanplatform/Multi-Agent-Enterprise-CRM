import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

// Create Prisma client with logging
export const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'error', emit: 'stdout' },
    { level: 'warn', emit: 'stdout' },
  ],
});

// Log slow queries in development
if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query', (e) => {
    if (e.duration > 100) {
      logger.warn('Slow query detected', {
        query: e.query,
        duration: `${e.duration}ms`,
      });
    }
  });
}

// Middleware to set tenant context for Row Level Security
export const withTenant = async (tenantId: string) => {
  await prisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
};

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
