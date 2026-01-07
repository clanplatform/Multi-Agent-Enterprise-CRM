import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../services/prisma';
import { publishEvent, TOPICS } from '../services/kafka';
import { sendToUser } from '../services/websocket';
import { AuthenticatedRequest } from '../middleware/auth';
import { badRequest, notFound, forbidden } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

// List pending approvals for current user
router.get('/',
  query('status').optional().isIn(['pending', 'approved', 'rejected', 'expired']),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;
      
      const where: any = { tenantId: req.tenantId };
      
      // Filter by status
      if (req.query.status) {
        where.status = req.query.status;
      } else {
        where.status = 'pending';
      }
      
      const [approvals, total] = await Promise.all([
        prisma.approval.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.approval.count({ where }),
      ]);
      
      res.json({
        data: approvals,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get approval details
router.get('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const approval = await prisma.approval.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: {
        decidedUser: { select: { id: true, name: true, email: true } },
      },
    });
    
    if (!approval) throw notFound('Approval not found');
    res.json(approval);
  } catch (error) {
    next(error);
  }
});

// Create approval request (typically called by agents)
router.post('/',
  body('requestType').isString(),
  body('requestorType').isIn(['user', 'agent']),
  body('requestorId').isUUID(),
  body('actionType').isString(),
  body('context').isObject(),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw badRequest('Validation failed', errors.array());
      
      // Calculate expiration time (default 24 hours)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + (req.body.expiresInHours || 24));
      
      const approvalId = uuidv4();
      const approval = await prisma.approval.create({
        data: {
          id: approvalId,
          tenantId: req.tenantId!,
          requestType: req.body.requestType,
          requestorType: req.body.requestorType,
          requestorId: req.body.requestorId,
          actionType: req.body.actionType,
          targetEntity: req.body.targetEntity,
          targetId: req.body.targetId,
          context: req.body.context,
          status: 'pending',
          expiresAt,
        },
      });
      
      // Publish event
      await publishEvent(TOPICS.APPROVALS_REQUIRED, {
        type: 'crm.approvals.required',
        source: '/services/gateway',
        id: uuidv4(),
        tenantid: req.tenantId!,
        data: {
          approvalId: approval.id,
          requestType: approval.requestType,
          actionType: approval.actionType,
          expiresAt: approval.expiresAt,
        },
      });
      
      logger.info('Approval request created', {
        approvalId: approval.id,
        actionType: approval.actionType,
        tenantId: req.tenantId,
      });
      
      res.status(201).json(approval);
    } catch (error) {
      next(error);
    }
  }
);

// Submit decision (approve/reject)
router.post('/:id/decide',
  body('decision').isIn(['approved', 'rejected']),
  body('reason').optional().isString(),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw badRequest('Validation failed', errors.array());
      
      const existing = await prisma.approval.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      
      if (!existing) throw notFound('Approval not found');
      
      if (existing.status !== 'pending') {
        throw badRequest('Approval has already been decided');
      }
      
      // Check if expired
      if (existing.expiresAt && new Date() > existing.expiresAt) {
        await prisma.approval.update({
          where: { id: req.params.id },
          data: { status: 'expired' },
        });
        throw badRequest('Approval has expired');
      }
      
      // TODO: Check if user has permission to approve based on OPA policy
      
      const approval = await prisma.approval.update({
        where: { id: req.params.id },
        data: {
          status: req.body.decision,
          decidedBy: req.user?.sub,
          decidedAt: new Date(),
          decisionReason: req.body.reason,
        },
      });
      
      // Publish decision event
      await publishEvent(TOPICS.APPROVALS_DECISION, {
        type: 'crm.approvals.decision',
        source: '/services/gateway',
        id: uuidv4(),
        tenantid: req.tenantId!,
        data: {
          approvalId: approval.id,
          decision: approval.status,
          decidedBy: approval.decidedBy,
          actionType: approval.actionType,
          targetEntity: approval.targetEntity,
          targetId: approval.targetId,
          context: approval.context,
        },
      });
      
      // Notify the requestor via WebSocket if it's a user
      if (existing.requestorType === 'user') {
        sendToUser(req.tenantId!, existing.requestorId, {
          type: 'approval_decision',
          payload: {
            approvalId: approval.id,
            decision: approval.status,
            actionType: approval.actionType,
          },
        });
      }
      
      logger.info('Approval decided', {
        approvalId: approval.id,
        decision: req.body.decision,
        decidedBy: req.user?.sub,
        tenantId: req.tenantId,
      });
      
      res.json(approval);
    } catch (error) {
      next(error);
    }
  }
);

// Cancel approval request
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const existing = await prisma.approval.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });
    
    if (!existing) throw notFound('Approval not found');
    
    // Only the requestor or an admin can cancel
    if (existing.requestorId !== req.user?.sub && !req.user?.roles.includes('admin')) {
      throw forbidden('Only the requestor or admin can cancel this approval');
    }
    
    if (existing.status !== 'pending') {
      throw badRequest('Only pending approvals can be cancelled');
    }
    
    await prisma.approval.update({
      where: { id: req.params.id },
      data: { status: 'cancelled' },
    });
    
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
