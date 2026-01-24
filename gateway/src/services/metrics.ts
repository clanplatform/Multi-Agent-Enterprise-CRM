import { Application } from 'express';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Create a custom registry
const register = new Registry();

// Collect default metrics (CPU, memory, etc.)
collectDefaultMetrics({ register });

// Custom metrics
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const activeConnections = new Gauge({
  name: 'websocket_active_connections',
  help: 'Number of active WebSocket connections',
  labelNames: ['tenant'],
  registers: [register],
});

export const kafkaMessagesPublished = new Counter({
  name: 'kafka_messages_published_total',
  help: 'Total number of Kafka messages published',
  labelNames: ['topic'],
  registers: [register],
});

export const kafkaMessagesConsumed = new Counter({
  name: 'kafka_messages_consumed_total',
  help: 'Total number of Kafka messages consumed',
  labelNames: ['topic', 'group'],
  registers: [register],
});

export const opaDecisions = new Counter({
  name: 'opa_decisions_total',
  help: 'Total number of OPA policy decisions',
  labelNames: ['result', 'policy'],
  registers: [register],
});

export const agentTasksTotal = new Counter({
  name: 'agent_tasks_total',
  help: 'Total number of agent tasks',
  labelNames: ['agent', 'status'],
  registers: [register],
});

export const approvalsPending = new Gauge({
  name: 'approvals_pending',
  help: 'Number of pending approvals',
  labelNames: ['tenant', 'type'],
  registers: [register],
});

export const cacheHitTotal = new Counter({
  name: 'cache_hit_total',
  help: 'Total cache hits',
  labelNames: ['tenant', 'cache'],
  registers: [register],
});

export const cacheMissTotal = new Counter({
  name: 'cache_miss_total',
  help: 'Total cache misses',
  labelNames: ['tenant', 'cache'],
  registers: [register],
});

export const cacheInvalidationTotal = new Counter({
  name: 'cache_invalidation_total',
  help: 'Total cache invalidations',
  labelNames: ['tenant', 'reason'],
  registers: [register],
});

export const cacheFailClosedTotal = new Counter({
  name: 'cache_fail_closed_total',
  help: 'Total fail-closed security events during caching and auth',
  labelNames: ['component', 'reason'],
  registers: [register],
});

export const authRecheckLatencyMs = new Histogram({
  name: 'auth_recheck_latency_ms',
  help: 'Authorization recheck latency on cache miss in milliseconds',
  labelNames: ['component'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [register],
});

// Setup metrics endpoint
export const setupMetrics = (app: Application): void => {
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (error) {
      res.status(500).end(String(error));
    }
  });
};

export { register };
