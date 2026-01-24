import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { unauthorized } from './errorHandler';
import { logger } from '../utils/logger';
import { redisClient } from '../services/redis';

export interface TokenPayload {
  sub: string;           // User ID
  tenantId?: string;     // Tenant ID (legacy)
  tenant_id?: string;    // Tenant ID (Keycloak-style)
  email: string;
  roles: string[];
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
  tenantId?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-change-in-production';

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw unauthorized('Missing or invalid authorization header');
    }
    
    const token = authHeader.substring(7);
    
    // Check if token is blacklisted (for logout)
    try {
      const isBlacklisted = await redisClient.get(`blacklist:${token}`);
      if (isBlacklisted) {
        throw unauthorized('Token has been revoked');
      }
    } catch (error) {
      logger.error('Token blacklist check failed', { error: (error as Error).message });
    }
    
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    const tenantId = decoded.tenantId || decoded.tenant_id;
    
    // Validate required claims
    if (!decoded.sub || !tenantId) {
      throw unauthorized('Invalid token claims');
    }
    
    // Attach user info to request
    req.user = { ...decoded, tenantId };
    req.tenantId = tenantId;
    
    // Add user info to headers for downstream services
    req.headers['x-user-id'] = decoded.sub;
    req.headers['x-token-tenant-id'] = tenantId;
    req.headers['x-user-roles'] = (decoded.roles || []).join(',');
    
    logger.debug('User authenticated', {
      userId: decoded.sub,
      tenantId,
      roles: decoded.roles || [],
    });
    
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(unauthorized('Token has expired'));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(unauthorized('Invalid token'));
    } else {
      next(error);
    }
  }
};

// Generate JWT token
export const generateToken = (payload: Omit<TokenPayload, 'iat' | 'exp'>): string => {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '1h') as jwt.SignOptions['expiresIn'];
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

// Generate refresh token
export const generateRefreshToken = (userId: string, tenantId: string): string => {
  const expiresIn = (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];
  return jwt.sign(
    { sub: userId, tenantId, type: 'refresh' },
    JWT_SECRET,
    { expiresIn }
  );
};

// Verify refresh token
export const verifyRefreshToken = (token: string): { sub: string; tenantId: string } => {
  const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; tenantId: string; type: string };
  
  if (decoded.type !== 'refresh') {
    throw new Error('Invalid refresh token');
  }
  
  return { sub: decoded.sub, tenantId: decoded.tenantId };
};
