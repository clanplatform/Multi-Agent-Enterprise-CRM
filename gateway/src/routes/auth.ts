import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../services/prisma';
import { generateToken, generateRefreshToken, verifyRefreshToken } from '../middleware/auth';
import { badRequest, unauthorized, notFound } from '../middleware/errorHandler';
import { redisClient } from '../services/redis';
import { logger } from '../utils/logger';

const router = Router();

// Login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  async (req: Request, res: Response, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw badRequest('Validation failed', errors.array());
      }
      
      const { email, password } = req.body;
      
      // Find user
      const user = await prisma.user.findFirst({
        where: { email },
        include: {
          userRoles: {
            include: { role: true },
          },
          tenant: true,
        },
      });
      
      if (!user || !user.passwordHash) {
        throw unauthorized('Invalid credentials');
      }
      
      // Verify password
      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) {
        throw unauthorized('Invalid credentials');
      }
      
      // Check user status
      if (user.status !== 'active') {
        throw unauthorized('Account is not active');
      }
      
      // Generate tokens
      const roles = user.userRoles.map(ur => ur.role.name);
      const accessToken = generateToken({
        sub: user.id,
        tenantId: user.tenantId,
        email: user.email,
        roles,
      });
      const refreshToken = generateRefreshToken(user.id, user.tenantId);
      
      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      
      logger.info('User logged in', { userId: user.id, tenantId: user.tenantId });
      
      res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles,
          tenant: {
            id: user.tenant.id,
            name: user.tenant.name,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Refresh token
router.post('/refresh',
  body('refreshToken').notEmpty(),
  async (req: Request, res: Response, next) => {
    try {
      const { refreshToken } = req.body;
      
      // Check if token is blacklisted
      const isBlacklisted = await redisClient.get(`blacklist:${refreshToken}`);
      if (isBlacklisted) {
        throw unauthorized('Token has been revoked');
      }
      
      // Verify refresh token
      const { sub: userId, tenantId } = verifyRefreshToken(refreshToken);
      
      // Get user
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          userRoles: {
            include: { role: true },
          },
        },
      });
      
      if (!user || user.status !== 'active') {
        throw unauthorized('User not found or inactive');
      }
      
      // Generate new tokens
      const roles = user.userRoles.map(ur => ur.role.name);
      const newAccessToken = generateToken({
        sub: user.id,
        tenantId: user.tenantId,
        email: user.email,
        roles,
      });
      const newRefreshToken = generateRefreshToken(user.id, user.tenantId);
      
      // Blacklist old refresh token
      await redisClient.setex(`blacklist:${refreshToken}`, 86400 * 7, '1');
      
      res.json({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Logout
router.post('/logout', async (req: Request, res: Response, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      // Blacklist the access token
      await redisClient.setex(`blacklist:${token}`, 3600, '1');
    }
    
    const { refreshToken } = req.body;
    if (refreshToken) {
      await redisClient.setex(`blacklist:${refreshToken}`, 86400 * 7, '1');
    }
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
});

// Register (creates tenant and admin user)
router.post('/register',
  body('tenantName').isLength({ min: 2, max: 100 }),
  body('tenantSlug').isLength({ min: 2, max: 50 }).matches(/^[a-z0-9-]+$/),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').isLength({ min: 2, max: 100 }),
  async (req: Request, res: Response, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw badRequest('Validation failed', errors.array());
      }
      
      const { tenantName, tenantSlug, email, password, name } = req.body;
      
      // Check if tenant slug exists
      const existingTenant = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
      });
      
      if (existingTenant) {
        throw badRequest('Tenant slug already exists');
      }
      
      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);
      
      // Create tenant, user, and admin role in transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create tenant
        const tenant = await tx.tenant.create({
          data: {
            id: uuidv4(),
            name: tenantName,
            slug: tenantSlug,
          },
        });
        
        // Create admin role
        const adminRole = await tx.role.create({
          data: {
            id: uuidv4(),
            tenantId: tenant.id,
            name: 'admin',
            description: 'Administrator with full access',
            permissions: JSON.stringify(['*']),
            isSystem: true,
          },
        });
        
        // Create user
        const user = await tx.user.create({
          data: {
            id: uuidv4(),
            tenantId: tenant.id,
            email,
            passwordHash,
            name,
          },
        });
        
        // Assign admin role
        await tx.userRole.create({
          data: {
            id: uuidv4(),
            tenantId: tenant.id,
            userId: user.id,
            roleId: adminRole.id,
          },
        });
        
        return { tenant, user, adminRole };
      });
      
      logger.info('New tenant registered', {
        tenantId: result.tenant.id,
        userId: result.user.id,
      });
      
      // Generate tokens
      const accessToken = generateToken({
        sub: result.user.id,
        tenantId: result.tenant.id,
        email: result.user.email,
        roles: ['admin'],
      });
      const refreshToken = generateRefreshToken(result.user.id, result.tenant.id);
      
      res.status(201).json({
        accessToken,
        refreshToken,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          roles: ['admin'],
          tenant: {
            id: result.tenant.id,
            name: result.tenant.name,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
