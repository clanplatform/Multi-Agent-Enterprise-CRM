import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../services/prisma';
import { publishEvent, TOPICS } from '../services/kafka';
import { AuthenticatedRequest } from '../middleware/auth';
import { badRequest, notFound } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

// List tickets
router.get('/',
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isString(),
  query('priority').optional().isString(),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;
      
      const where: any = { tenantId: req.tenantId };
      if (req.query.status) where.status = req.query.status;
      if (req.query.priority) where.priority = req.query.priority;
      if (req.query.assignedTo) where.assignedTo = req.query.assignedTo;
      
      const [tickets, total] = await Promise.all([
        prisma.ticket.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: { select: { id: true, name: true } },
            assignedUser: { select: { id: true, name: true } },
          },
        }),
        prisma.ticket.count({ where }),
      ]);
      
      res.json({
        data: tickets,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get ticket
router.get('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: {
        customer: true,
        assignedUser: { select: { id: true, name: true, email: true } },
      },
    });
    
    if (!ticket) throw notFound('Ticket not found');
    res.json(ticket);
  } catch (error) {
    next(error);
  }
});

// Create ticket
router.post('/',
  body('subject').isLength({ min: 1, max: 500 }),
  body('description').optional().isString(),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('customerId').optional().isUUID(),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw badRequest('Validation failed', errors.array());
      
      // Calculate SLA due time based on priority
      const slaDurations: Record<string, number> = {
        urgent: 4,
        high: 8,
        medium: 24,
        low: 48,
      };
      const priority = req.body.priority || 'medium';
      const slaDueAt = new Date();
      slaDueAt.setHours(slaDueAt.getHours() + slaDurations[priority]);
      
      const ticketId = uuidv4();
      const ticket = await prisma.ticket.create({
        data: {
          id: ticketId,
          tenantId: req.tenantId!,
          subject: req.body.subject,
          description: req.body.description,
          customerId: req.body.customerId,
          priority,
          category: req.body.category,
          status: 'open',
          slaDueAt,
          createdBy: req.user?.sub,
          metadata: req.body.metadata || {},
        },
      });
      
      await publishEvent(TOPICS.TICKETS_CREATED, {
        type: 'crm.tickets.created',
        source: '/services/gateway',
        id: uuidv4(),
        tenantid: req.tenantId!,
        data: {
          ticketId: ticket.id,
          subject: ticket.subject,
          priority: ticket.priority,
          slaDueAt: ticket.slaDueAt,
        },
      });
      
      logger.info('Ticket created', { ticketId: ticket.id, tenantId: req.tenantId });
      res.status(201).json(ticket);
    } catch (error) {
      next(error);
    }
  }
);

// Update ticket
router.patch('/:id',
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const existing = await prisma.ticket.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      
      if (!existing) throw notFound('Ticket not found');
      
      const ticket = await prisma.ticket.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.subject && { subject: req.body.subject }),
          ...(req.body.description && { description: req.body.description }),
          ...(req.body.priority && { priority: req.body.priority }),
          ...(req.body.status && { status: req.body.status }),
          ...(req.body.category && { category: req.body.category }),
          ...(req.body.assignedTo && { assignedTo: req.body.assignedTo }),
        },
      });
      
      await publishEvent(TOPICS.TICKETS_UPDATED, {
        type: 'crm.tickets.updated',
        source: '/services/gateway',
        id: uuidv4(),
        tenantid: req.tenantId!,
        data: { ticketId: ticket.id, changes: req.body },
      });
      
      res.json(ticket);
    } catch (error) {
      next(error);
    }
  }
);

// Resolve ticket
router.post('/:id/resolve',
  body('resolution').isLength({ min: 1 }),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const existing = await prisma.ticket.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      
      if (!existing) throw notFound('Ticket not found');
      
      const ticket = await prisma.ticket.update({
        where: { id: req.params.id },
        data: {
          status: 'resolved',
          resolution: req.body.resolution,
          resolvedAt: new Date(),
        },
      });
      
      await publishEvent(TOPICS.TICKETS_RESOLVED, {
        type: 'crm.tickets.resolved',
        source: '/services/gateway',
        id: uuidv4(),
        tenantid: req.tenantId!,
        data: {
          ticketId: ticket.id,
          resolution: ticket.resolution,
          slaMet: ticket.resolvedAt && ticket.slaDueAt ? 
            ticket.resolvedAt <= ticket.slaDueAt : null,
        },
      });
      
      logger.info('Ticket resolved', { ticketId: ticket.id, tenantId: req.tenantId });
      res.json(ticket);
    } catch (error) {
      next(error);
    }
  }
);

// Delete ticket
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    
    if (!ticket) throw notFound('Ticket not found');
    
    await prisma.ticket.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
