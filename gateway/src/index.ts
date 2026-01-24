import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';
import { tenantMiddleware } from './middleware/tenant';
import { opaMiddleware } from './middleware/opa';
import { auditMiddleware } from './middleware/audit';
import { requestLogger } from './middleware/requestLogger';

import authRoutes from './routes/auth';
import leadsRoutes from './routes/leads';
import dealsRoutes from './routes/deals';
import ticketsRoutes from './routes/tickets';
import customersRoutes from './routes/customers';
import approvalsRoutes from './routes/approvals';
import agentsRoutes from './routes/agents';
import replayRoutes from './routes/replay';
import aggregatesRoutes from './routes/aggregates';
import governanceRoutes from './routes/governance';
import securityRoutes from './routes/security';

import { setupWebSocket } from './services/websocket';
import { kafkaProducer } from './services/kafka';
import { setupMetrics } from './services/metrics';
import { startApprovalsRequiredIngestor } from './consumers/approvalsRequired';
import { startAuditEventsIngestor } from './consumers/auditEvents';
import { startCacheInvalidationConsumer } from './consumers/cacheInvalidation';

const app: Application = express();
const PORT = process.env.GATEWAY_PORT || 4000;

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add correlation ID to all requests
app.use((req: Request, res: Response, next: NextFunction) => {
  req.headers['x-correlation-id'] = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('x-correlation-id', req.headers['x-correlation-id']);
  next();
});

// Request logging
app.use(requestLogger);

// Metrics endpoint (before auth)
setupMetrics(app);

// Health check (before auth)
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// Readiness check
app.get('/ready', async (req: Request, res: Response) => {
  try {
    // Check dependencies
    // TODO: Add actual health checks for Kafka, Redis, etc.
    res.json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: String(error) });
  }
});

// Public routes
app.use('/api/v1/auth', authRoutes);

// Protected routes - apply middleware stack
app.use('/api/v1',
  authMiddleware,
  tenantMiddleware,
  opaMiddleware,
  auditMiddleware
);

// API routes
app.use('/api/v1/leads', leadsRoutes);
app.use('/api/v1/deals', dealsRoutes);
app.use('/api/v1/tickets', ticketsRoutes);
app.use('/api/v1/customers', customersRoutes);
app.use('/api/v1/approvals', approvalsRoutes);
app.use('/api/v1/agents', agentsRoutes);
app.use('/api/v1/replay', replayRoutes);
app.use('/api/v1/aggregates', aggregatesRoutes);
app.use('/api/v1/governance', governanceRoutes);
app.use('/api/v1/security', securityRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
});

// Error handler
app.use(errorHandler);

// Create HTTP server
const server = createServer(app);

// Setup WebSocket
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss);

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down gracefully...');
  
  // Close WebSocket connections
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });
  
  if ((global as any).__approvalsIngestorStop) {
    await (global as any).__approvalsIngestorStop();
  }
  if ((global as any).__auditIngestorStop) {
    await (global as any).__auditIngestorStop();
  }
  if ((global as any).__cacheInvalidationStop) {
    await (global as any).__cacheInvalidationStop();
  }

  // Disconnect Kafka
  await kafkaProducer.disconnect();
  
  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  
  // Force exit after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const startServer = async () => {
  try {
    // Connect to Kafka
    await kafkaProducer.connect();
    logger.info('Connected to Kafka');

    if (process.env.ENABLE_APPROVAL_EVENT_INGESTOR !== 'false') {
      (global as any).__approvalsIngestorStop = await startApprovalsRequiredIngestor();
    }
    if (process.env.ENABLE_AUDIT_EVENT_INGESTOR !== 'false') {
      (global as any).__auditIngestorStop = await startAuditEventsIngestor();
    }
    if (process.env.ENABLE_CACHE_INVALIDATION_CONSUMER !== 'false') {
      (global as any).__cacheInvalidationStop = await startCacheInvalidationConsumer();
    }
    
    server.listen(PORT, () => {
      logger.info(`API Gateway running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

if (!process.env.JEST_WORKER_ID) {
  startServer();
}

export default app;
