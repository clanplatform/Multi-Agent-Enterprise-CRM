import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../services/prisma';
import { publishEvent, TOPICS } from '../services/kafka';
import { AuthenticatedRequest } from '../middleware/auth';
import { badRequest, notFound } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

// List leads
router.get('/',
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isString(),
  query('assignedTo').optional().isUUID(),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;
      
      const where: any = {
        tenantId: req.tenantId,
      };
      
      if (req.query.status) {
        where.status = req.query.status;
      }
      
      if (req.query.assignedTo) {
        where.assignedTo = req.query.assignedTo;
      }
      
      const [leads, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            assignedUser: {
              select: { id: true, name: true, email: true },
            },
          },
        }),
        prisma.lead.count({ where }),
      ]);
      
      res.json({
        data: leads,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get single lead
router.get('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: {
        id: req.params.id,
        tenantId: req.tenantId,
      },
      include: {
        assignedUser: {
          select: { id: true, name: true, email: true },
        },
        deals: true,
      },
    });
    
    if (!lead) {
      throw notFound('Lead not found');
    }
    
    res.json(lead);
  } catch (error) {
    next(error);
  }
});

// Create lead
router.post('/',
  body('name').isLength({ min: 1, max: 255 }),
  body('email').optional().isEmail(),
  body('phone').optional().isString(),
  body('company').optional().isString(),
  body('source').optional().isString(),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw badRequest('Validation failed', errors.array());
      }
      
      const leadId = uuidv4();
      const lead = await prisma.lead.create({
        data: {
          id: leadId,
          tenantId: req.tenantId!,
          name: req.body.name,
          email: req.body.email,
          phone: req.body.phone,
          company: req.body.company,
          source: req.body.source || 'manual',
          status: 'new',
          createdBy: req.user?.sub,
          metadata: req.body.metadata || {},
        },
      });
      
      // Publish event
      await publishEvent(TOPICS.LEADS_CREATED, {
        type: 'crm.leads.created',
        source: '/services/gateway',
        id: uuidv4(),
        tenantid: req.tenantId!,
        correlationid: req.headers['x-correlation-id'] as string,
        data: {
          leadId: lead.id,
          name: lead.name,
          email: lead.email,
          source: lead.source,
          createdBy: lead.createdBy,
        },
      });
      
      logger.info('Lead created', { leadId: lead.id, tenantId: req.tenantId });
      
      res.status(201).json(lead);
    } catch (error) {
      next(error);
    }
  }
);

// Update lead
router.patch('/:id',
  body('name').optional().isLength({ min: 1, max: 255 }),
  body('email').optional().isEmail(),
  body('status').optional().isIn(['new', 'contacted', 'qualified', 'unqualified', 'converted']),
  body('score').optional().isInt({ min: 0, max: 100 }),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw badRequest('Validation failed', errors.array());
      }
      
      // Check lead exists
      const existing = await prisma.lead.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
        },
      });
      
      if (!existing) {
        throw notFound('Lead not found');
      }
      
      const lead = await prisma.lead.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.name && { name: req.body.name }),
          ...(req.body.email && { email: req.body.email }),
          ...(req.body.phone && { phone: req.body.phone }),
          ...(req.body.company && { company: req.body.company }),
          ...(req.body.status && { status: req.body.status }),
          ...(req.body.score !== undefined && { score: req.body.score }),
          ...(req.body.assignedTo && { assignedTo: req.body.assignedTo }),
          ...(req.body.metadata && { metadata: req.body.metadata }),
        },
      });
      
      // Publish event
      await publishEvent(TOPICS.LEADS_UPDATED, {
        type: 'crm.leads.updated',
        source: '/services/gateway',
        id: uuidv4(),
        tenantid: req.tenantId!,
        correlationid: req.headers['x-correlation-id'] as string,
        data: {
          leadId: lead.id,
          changes: req.body,
          previousStatus: existing.status,
          newStatus: lead.status,
        },
      });
      
      logger.info('Lead updated', { leadId: lead.id, tenantId: req.tenantId });
      
      res.json(lead);
    } catch (error) {
      next(error);
    }
  }
);

// Delete lead
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: {
        id: req.params.id,
        tenantId: req.tenantId,
      },
    });
    
    if (!lead) {
      throw notFound('Lead not found');
    }
    
    await prisma.lead.delete({
      where: { id: req.params.id },
    });
    
    logger.info('Lead deleted', { leadId: req.params.id, tenantId: req.tenantId });
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Assign lead
router.post('/:id/assign',
  body('userId').isUUID(),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const lead = await prisma.lead.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
        },
      });
      
      if (!lead) {
        throw notFound('Lead not found');
      }
      
      const updated = await prisma.lead.update({
        where: { id: req.params.id },
        data: { assignedTo: req.body.userId },
        include: {
          assignedUser: {
            select: { id: true, name: true, email: true },
          },
        },
      });
      
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
