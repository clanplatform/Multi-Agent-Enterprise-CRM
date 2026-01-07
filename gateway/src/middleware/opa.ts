import { Response, NextFunction } from 'express';
import axios from 'axios';
import { AuthenticatedRequest } from './auth';
import { forbidden } from './errorHandler';
import { logger } from '../utils/logger';

const OPA_URL = process.env.OPA_URL || 'http://localhost:8181';

interface OpaInput {
  tenant_id: string;
  user: {
    id: string;
    roles: string[];
    email?: string;
  };
  action: string;
  resource: {
    type: string;
    id?: string;
    tenant_id?: string;
    [key: string]: any;
  };
  actor_type: 'user' | 'agent' | 'system';
}

interface OpaResult {
  allow: boolean;
  deny?: string[];
  requires_approval?: boolean;
}

export const opaMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Skip OPA check for certain paths
    const skipPaths = ['/health', '/ready', '/metrics'];
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }
    
    // Build action from method and path
    const action = buildAction(req.method, req.path);
    
    // Build OPA input
    const input: OpaInput = {
      tenant_id: req.tenantId || '',
      user: {
        id: req.user?.sub || '',
        roles: req.user?.roles || [],
        email: req.user?.email,
      },
      action,
      resource: {
        type: extractResourceType(req.path),
        id: extractResourceId(req.path),
        tenant_id: req.tenantId,
        ...req.body,
      },
      actor_type: 'user',
    };
    
    logger.debug('OPA policy check', { action, resource: input.resource.type });
    
    // Query OPA
    const result = await queryOpa(input);
    
    if (!result.allow) {
      const denyReasons = result.deny?.join('; ') || 'Access denied by policy';
      logger.warn('OPA denied request', {
        userId: req.user?.sub,
        action,
        reasons: result.deny,
      });
      throw forbidden(denyReasons);
    }
    
    // Check if approval is required
    if (result.requires_approval) {
      // Add header to indicate approval is needed
      req.headers['x-requires-approval'] = 'true';
    }
    
    next();
  } catch (error) {
    // If OPA is unavailable, fail closed (deny)
    if (axios.isAxiosError(error) && !error.response) {
      logger.error('OPA unavailable, failing closed');
      next(forbidden('Policy engine unavailable'));
    } else {
      next(error);
    }
  }
};

async function queryOpa(input: OpaInput): Promise<OpaResult> {
  try {
    // Query multiple policies and combine results
    const [tenantResult, rbacResult, abacResult] = await Promise.all([
      queryOpaPolicy('crm/tenant', input),
      queryOpaPolicy('crm/rbac', input),
      queryOpaPolicy('crm/abac', input),
    ]);
    
    // Combine deny messages
    const allDeny: string[] = [
      ...(tenantResult.deny || []),
      ...(rbacResult.deny || []),
      ...(abacResult.deny || []),
    ];
    
    // All policies must allow (or not explicitly deny)
    const allow = 
      (tenantResult.allow !== false) &&
      (rbacResult.allow || allDeny.length === 0) &&
      (abacResult.allow !== false || allDeny.filter(d => d.includes('ABAC')).length === 0);
    
    return {
      allow: allow && allDeny.length === 0,
      deny: allDeny.length > 0 ? allDeny : undefined,
      requires_approval: tenantResult.requires_approval || rbacResult.requires_approval || abacResult.requires_approval,
    };
  } catch (error) {
    logger.error('OPA query failed', { error });
    throw error;
  }
}

async function queryOpaPolicy(policy: string, input: OpaInput): Promise<OpaResult> {
  try {
    const response = await axios.post(
      `${OPA_URL}/v1/data/${policy}`,
      { input },
      {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' },
      }
    );
    
    return response.data.result || { allow: true };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      // Policy not found, allow by default (but log warning)
      logger.warn(`OPA policy not found: ${policy}`);
      return { allow: true };
    }
    throw error;
  }
}

function buildAction(method: string, path: string): string {
  const resourceType = extractResourceType(path);
  
  const actionMap: Record<string, string> = {
    GET: 'read',
    POST: 'write',
    PUT: 'write',
    PATCH: 'write',
    DELETE: 'delete',
  };
  
  return `${resourceType}:${actionMap[method] || 'read'}`;
}

function extractResourceType(path: string): string {
  // /api/v1/leads/123 -> leads
  const parts = path.split('/').filter(Boolean);
  const apiIndex = parts.findIndex(p => p === 'v1');
  
  if (apiIndex >= 0 && parts[apiIndex + 1]) {
    return parts[apiIndex + 1];
  }
  
  return 'unknown';
}

function extractResourceId(path: string): string | undefined {
  // /api/v1/leads/123 -> 123
  const parts = path.split('/').filter(Boolean);
  const apiIndex = parts.findIndex(p => p === 'v1');
  
  if (apiIndex >= 0 && parts[apiIndex + 2]) {
    const id = parts[apiIndex + 2];
    // Check if it looks like a UUID
    if (/^[0-9a-f-]{36}$/i.test(id)) {
      return id;
    }
  }
  
  return undefined;
}

// Export for use in agent services
export { queryOpa, OpaInput, OpaResult };
