import { Kafka, Producer, Consumer, EachMessagePayload, logLevel } from 'kafkajs';
import { logger } from '../utils/logger';
import { kafkaMessagesConsumed, kafkaMessagesPublished } from './metrics';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID || 'enterprise-crm-gateway';

// Create Kafka instance
const kafka = new Kafka({
  clientId: KAFKA_CLIENT_ID,
  brokers: KAFKA_BROKERS,
  logLevel: logLevel.WARN,
  retry: {
    initialRetryTime: 100,
    retries: 8,
  },
});

// Create producer
export const kafkaProducer: Producer = kafka.producer({
  allowAutoTopicCreation: true,
  transactionTimeout: 30000,
});

// Domain event types
export interface DomainEvent {
  specversion: string;
  type: string;
  source: string;
  id: string;
  time: string;
  datacontenttype: string;
  tenantid: string;
  correlationid?: string;
  data: Record<string, any>;
}

// Publish domain event
export const publishEvent = async (
  topic: string,
  event: Omit<DomainEvent, 'specversion' | 'time' | 'datacontenttype'>,
  options?: { key?: string }
): Promise<void> => {
  const fullEvent: DomainEvent = {
    ...event,
    specversion: '1.0',
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
  };
  
  try {
    if (process.env.JEST_WORKER_ID) {
      return;
    }
    await kafkaProducer.send({
      topic,
      messages: [{
        key: options?.key ?? event.tenantid,
        value: JSON.stringify(fullEvent),
        headers: {
          'ce-type': event.type,
          'ce-source': event.source,
          'ce-id': event.id,
          'ce-tenantid': event.tenantid,
        },
      }],
    });

    kafkaMessagesPublished.labels(topic).inc();
    
    logger.debug('Event published', { topic, type: event.type, id: event.id });
  } catch (error) {
    logger.error('Failed to publish event', { topic, type: event.type, error });
    if (process.env.JEST_WORKER_ID) {
      return;
    }
    throw error;
  }
};

// Create consumer
export const createConsumer = (groupId: string): Consumer => {
  return kafka.consumer({
    groupId,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
  });
};

// Consumer handler type
export type MessageHandler = (payload: EachMessagePayload) => Promise<void>;

// Start consuming
export const startConsumer = async (
  consumer: Consumer,
  topics: string[],
  handler: MessageHandler
): Promise<void> => {
  await consumer.connect();
  
  for (const topic of topics) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }
  
  await consumer.run({
    eachMessage: async (payload) => {
      try {
        await handler(payload);
        kafkaMessagesConsumed.labels(payload.topic, consumer.groupId).inc();
      } catch (error) {
        logger.error('Message processing failed', {
          topic: payload.topic,
          partition: payload.partition,
          offset: payload.message.offset,
          error,
        });
        
        // TODO: Send to DLQ
      }
    },
  });
  
  logger.info('Consumer started', { topics });
};

// Topic names
export const TOPICS = {
  // Leads
  LEADS_CREATED: 'crm.leads.created',
  LEADS_UPDATED: 'crm.leads.updated',
  LEADS_QUALIFIED: 'crm.leads.qualified',
  LEADS_EVENTS: 'crm.leads.events',
  
  // Deals
  DEALS_CREATED: 'crm.deals.created',
  DEALS_UPDATED: 'crm.deals.updated',
  DEALS_STAGE_CHANGED: 'crm.deals.stage-changed',
  DEALS_CLOSED: 'crm.deals.closed',
  
  // Tickets
  TICKETS_CREATED: 'crm.tickets.created',
  TICKETS_UPDATED: 'crm.tickets.updated',
  TICKETS_RESOLVED: 'crm.tickets.resolved',
  TICKETS_SLA_BREACHED: 'crm.tickets.sla-breached',
  TICKETS_EVENTS: 'crm.tickets.events',
  
  // Customers
  CUSTOMERS_CREATED: 'crm.customers.created',
  CUSTOMERS_UPDATED: 'crm.customers.updated',
  
  // Agents
  AGENTS_TASK_ASSIGNED: 'crm.agents.task-assigned',
  AGENTS_ACTION_PROPOSED: 'crm.agents.action-proposed',
  AGENTS_ACTION_EXECUTED: 'crm.agents.action-executed',
  AGENTS_REASONING: 'crm.agents.reasoning',
  
  // Approvals
  APPROVALS_REQUIRED: 'crm.approvals.required',
  APPROVALS_DECISION: 'crm.approvals.decision',

  // Compliance
  GDPR_FORGET: 'crm.gdpr.forget',
  
  // Audit & Security
  AUDIT_EVENTS: 'crm.audit.events',
  SECURITY_EVENTS: 'crm.security.events',
  
  // Dead Letter Queues
  DLQ_LEADS: 'crm.dlq.leads',
  DLQ_AGENTS: 'crm.dlq.agents',
  DLQ_APPROVALS: 'crm.dlq.approvals',
};
