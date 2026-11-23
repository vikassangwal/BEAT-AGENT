import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma';
import { verifyAccessToken, extractTokenFromHeader, JwtPayload } from '../utils/jwt';
import { sessionRedis } from '../db/redis';
import { config } from '../config';
import { AuditEventType, SessionStatus } from '@prisma/client';
import { auditService } from '../services/auditService';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  session?: {
    id: string;
    workspaceId: string | null;
    deviceId: string | null;
  };
  correlationId: string;
}

/**
 * Authentication middleware - validates access token
 */
export async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  req.correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', req.correlationId);

  const token = extractTokenFromHeader(req.headers.authorization);
  if (!token) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
      correlationId: req.correlationId,
    });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    // Log failed auth attempt
    await auditService.log({
      workspaceId: req.headers['x-workspace-id'] as string || 'unknown',
      eventType: AuditEventType.LOGIN_FAILED,
      severity: 'LOW',
      description: 'Invalid or expired access token',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { tokenPreview: token.slice(0, 20) },
      correlationId: req.correlationId,
    });

    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid or expired token',
      correlationId: req.correlationId,
    });
    return;
  }

  // Check if session exists and is active in Redis
  const sessionData = await sessionRedis.get<{
    id: string;
    workspaceId: string | null;
    deviceId: string | null;
    status: string;
  }>(payload.sessionId);

  if (!sessionData || sessionData.status !== SessionStatus.ACTIVE) {
    res.status(401).json({
      error: 'SESSION_REVOKED',
      message: 'Session has been revoked or expired',
      correlationId: req.correlationId,
    });
    return;
  }

  // Check if user exists and is active
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, status: true, email: true },
  });

  if (!user || user.status !== 'ACTIVE') {
    res.status(401).json({
      error: 'ACCOUNT_DISABLED',
      message: 'Account is disabled or deleted',
      correlationId: req.correlationId,
    });
    return;
  }

  req.user = payload;
  req.session = {
    id: sessionData.id,
    workspaceId: sessionData.workspaceId,
    deviceId: sessionData.deviceId,
  };

  next();
}

/**
 * Optional authentication - doesn't fail if no token
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  req.correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', req.correlationId);

  const token = extractTokenFromHeader(req.headers.authorization);
  if (!token) {
    return next();
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    return next();
  }

  const sessionData = await sessionRedis.get<{
    id: string;
    workspaceId: string | null;
    deviceId: string | null;
    status: string;
  }>(payload.sessionId);

  if (!sessionData || sessionData.status !== SessionStatus.ACTIVE) {
    return next();
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, status: true },
  });

  if (!user || user.status !== 'ACTIVE') {
    return next();
  }

  req.user = payload;
  req.session = {
    id: sessionData.id,
    workspaceId: sessionData.workspaceId,
    deviceId: sessionData.deviceId,
  };

  next();
}

/**
 * Require specific workspace context
 */
export function requireWorkspace(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const workspaceId = req.headers['x-workspace-id'] as string || req.params.workspaceId || req.query.workspaceId as string;

  if (!workspaceId) {
    res.status(400).json({
      error: 'WORKSPACE_REQUIRED',
      message: 'Workspace context is required',
      correlationId: req.correlationId,
    });
    return;
  }

  if (req.session?.workspaceId && req.session.workspaceId !== workspaceId) {
    res.status(403).json({
      error: 'WORKSPACE_MISMATCH',
      message: 'Token workspace does not match requested workspace',
      correlationId: req.correlationId,
    });
    return;
  }

  // Attach workspace ID to request for convenience
  (req as any).workspaceId = workspaceId;
  next();
}

/**
 * Require specific permissions
 */
export function requirePermissions(...permissions: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
        correlationId: req.correlationId,
      });
      return;
    }

    const userPermissions = req.user.permissions || [];
    const hasPermission = permissions.every(p => userPermissions.includes(p));

    if (!hasPermission) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `Missing required permissions: ${permissions.filter(p => !userPermissions.includes(p)).join(', ')}`,
        correlationId: req.correlationId,
      });
      return;
    }

    next();
  };
}

/**
 * Require specific role
 */
export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
        correlationId: req.correlationId,
      });
      return;
    }

    if (!req.user.role || !roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `Required role: ${roles.join(' or ')}`,
        correlationId: req.correlationId,
      });
      return;
    }

    next();
  };
}

/**
 * Rate limiting by user
 */
export function userRateLimit(maxRequests: number, windowMs: number) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return next();
    }

    const key = `user:${req.user.sub}`;
    const { count, ttl } = await rateLimitRedis.increment(key, windowMs);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count));
    res.setHeader('X-RateLimit-Reset', Date.now() + ttl);

    if (count > maxRequests) {
      res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Too many requests',
        retryAfter: Math.ceil(ttl / 1000),
        correlationId: req.correlationId,
      });
      return;
    }

    next();
  };
}

// Import rateLimitRedis
import { rateLimitRedis } from '../db/redis';