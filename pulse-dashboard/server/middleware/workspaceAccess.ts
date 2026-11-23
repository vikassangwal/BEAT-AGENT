import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma';
import { AuthenticatedRequest } from './auth';
import { MembershipRole, PermissionAction, ResourceType } from '@prisma/client';
import { cacheRedis } from '../db/redis';
import { config } from '../config';

export interface WorkspaceAccessRequest extends AuthenticatedRequest {
  workspace?: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    settings: Record<string, unknown>;
    ipAllowlistEnabled: boolean;
    geoBlockingEnabled: boolean;
    requireMfa: boolean;
    maxConcurrentSessions: number;
    sessionTimeoutMinutes: number;
  };
  membership?: {
    id: string;
    role: MembershipRole;
    customRole: string | null;
    roleId: string | null;
    permissions: string[];
    isActive: boolean;
  };
  rolePermissions?: string[];
}

/**
 * Middleware to check workspace membership and permissions
 */
export async function workspaceAccess(
  req: WorkspaceAccessRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const workspaceId = (req as any).workspaceId || req.headers['x-workspace-id'] as string;

  if (!workspaceId) {
    res.status(400).json({
      error: 'WORKSPACE_REQUIRED',
      message: 'Workspace context is required',
      correlationId: req.correlationId,
    });
    return;
  }

  if (!req.user) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
      correlationId: req.correlationId,
    });
    return;
  }

  // Check cache first
  const cacheKey = `workspace_access:${req.user.sub}:${workspaceId}`;
  let cached = await cacheRedis.get<{
    workspace: WorkspaceAccessRequest['workspace'];
    membership: WorkspaceAccessRequest['membership'];
    rolePermissions: string[];
  }>(cacheKey);

  if (!cached) {
    // Fetch workspace
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        settings: true,
        ipAllowlistEnabled: true,
        geoBlockingEnabled: true,
        requireMfa: true,
        maxConcurrentSessions: true,
        sessionTimeoutMinutes: true,
      },
    });

    if (!workspace) {
      res.status(404).json({
        error: 'WORKSPACE_NOT_FOUND',
        message: 'Workspace not found',
        correlationId: req.correlationId,
      });
      return;
    }

    // Fetch membership
    const membership = await prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId: req.user.sub,
          workspaceId,
        },
      },
      include: {
        roleRel: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!membership || !membership.isActive) {
      res.status(403).json({
        error: 'NOT_A_MEMBER',
        message: 'You are not a member of this workspace',
        correlationId: req.correlationId,
      });
      return;
    }

    // Build permissions list
    const rolePermissions = membership.roleRel?.permissions.map(rp => `${rp.permission.resource}:${rp.permission.action}`) || [];
    const basePermissions = getBasePermissions(membership.role);
    const allPermissions = [...new Set([...basePermissions, ...rolePermissions])];

    cached = {
      workspace,
      membership: {
        id: membership.id,
        role: membership.role,
        customRole: membership.customRole,
        roleId: membership.roleId,
        permissions: allPermissions,
        isActive: membership.isActive,
      },
      rolePermissions: allPermissions,
    };

    // Cache for 5 minutes
    await cacheRedis.set(cacheKey, cached, 300);
  }

  req.workspace = cached.workspace;
  req.membership = cached.membership;
  req.rolePermissions = cached.rolePermissions;

  // Check IP allowlist
  if (req.workspace.ipAllowlistEnabled) {
    const allowed = await checkIpAllowlist(req.workspace.id, req.ip || '');
    if (!allowed) {
      res.status(403).json({
        error: 'IP_BLOCKED',
        message: 'Your IP address is not allowed to access this workspace',
        correlationId: req.correlationId,
      });
      return;
    }
  }

  // Check geo-blocking
  if (req.workspace.geoBlockingEnabled) {
    const allowed = await checkGeoBlocking(req.workspace.id, req.ip || '');
    if (!allowed) {
      res.status(403).json({
        error: 'GEO_BLOCKED',
        message: 'Access from your country is not allowed',
        correlationId: req.correlationId,
      });
      return;
    }
  }

  // Check MFA requirement
  if (req.workspace.requireMfa && !req.user.permissions?.includes('mfa:verified')) {
    res.status(403).json({
      error: 'MFA_REQUIRED',
      message: 'Multi-factor authentication is required for this workspace',
      correlationId: req.correlationId,
    });
    return;
  }

  next();
}

/**
 * Check if user has specific permission in workspace
 */
export function requireWorkspacePermission(resource: ResourceType, action: PermissionAction) {
  return (req: WorkspaceAccessRequest, res: Response, next: NextFunction): void => {
    if (!req.membership) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Workspace access required',
        correlationId: req.correlationId,
      });
      return;
    }

    const permission = `${resource}:${action}`;
    const hasPermission = req.rolePermissions?.includes(permission) ||
      req.rolePermissions?.includes(`${resource}:MANAGE`) ||
      req.rolePermissions?.includes('*:*');

    if (!hasPermission) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `Missing permission: ${permission}`,
        correlationId: req.correlationId,
      });
      return;
    }

    next();
  };
}

/**
 * Check if user has any of the specified roles
 */
export function requireWorkspaceRole(...roles: MembershipRole[]) {
  return (req: WorkspaceAccessRequest, res: Response, next: NextFunction): void => {
    if (!req.membership) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Workspace access required',
        correlationId: req.correlationId,
      });
      return;
    }

    const hasRole = roles.includes(req.membership.role) ||
      (req.membership.customRole && roles.includes(req.membership.customRole as MembershipRole));

    if (!hasRole) {
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
 * Check if user is workspace owner or admin
 */
export function requireWorkspaceAdmin(req: WorkspaceAccessRequest, res: Response, next: NextFunction): void {
  if (!req.membership) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Workspace access required',
      correlationId: req.correlationId,
    });
    return;
  }

  const isAdmin = req.membership.role === MembershipRole.OWNER ||
    req.membership.role === MembershipRole.ADMIN;

  if (!isAdmin) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Admin access required',
      correlationId: req.correlationId,
    });
    return;
  }

  next();
}

/**
 * Check if user is workspace owner
 */
export function requireWorkspaceOwner(req: WorkspaceAccessRequest, res: Response, next: NextFunction): void {
  if (!req.membership) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Workspace access required',
      correlationId: req.correlationId,
    });
    return;
  }

  if (req.membership.role !== MembershipRole.OWNER) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Owner access required',
      correlationId: req.correlationId,
    });
    return;
  }

  next();
}

/**
 * Get base permissions for a role
 */
function getBasePermissions(role: MembershipRole): string[] {
  const permissions: Record<MembershipRole, string[]> = {
    [MembershipRole.OWNER]: ['*:*'],
    [MembershipRole.ADMIN]: [
      'WORKSPACE:READ', 'WORKSPACE:UPDATE', 'WORKSPACE:DELETE', 'WORKSPACE:MANAGE',
      'PROJECT:CREATE', 'PROJECT:READ', 'PROJECT:UPDATE', 'PROJECT:DELETE', 'PROJECT:MANAGE',
      'PAGE:CREATE', 'PAGE:READ', 'PAGE:UPDATE', 'PAGE:DELETE', 'PAGE:MANAGE', 'PAGE:SHARE',
      'BLOCK:CREATE', 'BLOCK:READ', 'BLOCK:UPDATE', 'BLOCK:DELETE', 'BLOCK:MANAGE',
      'DATABASE:CREATE', 'DATABASE:READ', 'DATABASE:UPDATE', 'DATABASE:DELETE', 'DATABASE:MANAGE',
      'AUTOMATION:CREATE', 'AUTOMATION:READ', 'AUTOMATION:UPDATE', 'AUTOMATION:DELETE', 'AUTOMATION:MANAGE', 'AUTOMATION:EXECUTE',
      'TEMPLATE:CREATE', 'TEMPLATE:READ', 'TEMPLATE:UPDATE', 'TEMPLATE:DELETE', 'TEMPLATE:MANAGE',
      'INTEGRATION:CREATE', 'INTEGRATION:READ', 'INTEGRATION:UPDATE', 'INTEGRATION:DELETE', 'INTEGRATION:MANAGE',
      'WEBHOOK:CREATE', 'WEBHOOK:READ', 'WEBHOOK:UPDATE', 'WEBHOOK:DELETE', 'WEBHOOK:MANAGE',
      'API_KEY:CREATE', 'API_KEY:READ', 'API_KEY:UPDATE', 'API_KEY:DELETE', 'API_KEY:MANAGE',
      'SECRET:CREATE', 'SECRET:READ', 'SECRET:UPDATE', 'SECRET:DELETE', 'SECRET:MANAGE',
      'USER:READ', 'USER:UPDATE', 'USER:MANAGE',
      'ROLE:CREATE', 'ROLE:READ', 'ROLE:UPDATE', 'ROLE:DELETE', 'ROLE:MANAGE',
      'AUDIT_LOG:READ', 'AUDIT_LOG:EXPORT',
      'SESSION:READ', 'SESSION:MANAGE',
      'DEVICE:READ', 'DEVICE:MANAGE',
      'IP_ALLOWLIST:CREATE', 'IP_ALLOWLIST:READ', 'IP_ALLOWLIST:UPDATE', 'IP_ALLOWLIST:DELETE', 'IP_ALLOWLIST:MANAGE',
      'SSO_CONFIG:CREATE', 'SSO_CONFIG:READ', 'SSO_CONFIG:UPDATE', 'SSO_CONFIG:DELETE', 'SSO_CONFIG:MANAGE',
      'SCIM_CONFIG:CREATE', 'SCIM_CONFIG:READ', 'SCIM_CONFIG:UPDATE', 'SCIM_CONFIG:DELETE', 'SCIM_CONFIG:MANAGE',
      'COMPLIANCE_REPORT:CREATE', 'COMPLIANCE_REPORT:READ', 'COMPLIANCE_REPORT:MANAGE',
      'RETENTION_POLICY:CREATE', 'RETENTION_POLICY:READ', 'RETENTION_POLICY:UPDATE', 'RETENTION_POLICY:DELETE', 'RETENTION_POLICY:MANAGE',
    ],
    [MembershipRole.MEMBER]: [
      'WORKSPACE:READ',
      'PROJECT:CREATE', 'PROJECT:READ', 'PROJECT:UPDATE',
      'PAGE:CREATE', 'PAGE:READ', 'PAGE:UPDATE', 'PAGE:SHARE',
      'BLOCK:CREATE', 'BLOCK:READ', 'BLOCK:UPDATE',
      'DATABASE:CREATE', 'DATABASE:READ', 'DATABASE:UPDATE',
      'AUTOMATION:CREATE', 'AUTOMATION:READ', 'AUTOMATION:UPDATE', 'AUTOMATION:EXECUTE',
      'TEMPLATE:READ', 'TEMPLATE:CREATE',
      'INTEGRATION:READ',
      'WEBHOOK:READ',
      'API_KEY:CREATE', 'API_KEY:READ',
      'SECRET:READ',
      'USER:READ',
      'ROLE:READ',
      'SESSION:READ',
      'DEVICE:READ',
    ],
    [MembershipRole.VIEWER]: [
      'WORKSPACE:READ',
      'PROJECT:READ',
      'PAGE:READ',
      'BLOCK:READ',
      'DATABASE:READ',
      'AUTOMATION:READ',
      'TEMPLATE:READ',
      'INTEGRATION:READ',
      'WEBHOOK:READ',
      'USER:READ',
      'ROLE:READ',
    ],
    [MembershipRole.GUEST]: [
      'PAGE:READ',
      'BLOCK:READ',
    ],
    [MembershipRole.CUSTOM]: [],
  };

  return permissions[role] || [];
}

/**
 * Check IP allowlist
 */
async function checkIpAllowlist(workspaceId: string, ip: string): Promise<boolean> {
  // Normalize IP (handle IPv6 mapped IPv4)
  const normalizedIp = ip.replace(/^::ffff:/, '');

  // Check cache
  const cacheKey = `ip_allowlist:${workspaceId}`;
  let entries = await cacheRedis.get<{ type: string; value: string }[]>(cacheKey);

  if (!entries) {
    const allowlist = await prisma.ipAllowlist.findMany({
      where: { workspaceId, enabled: true },
      select: { type: true, value: true },
    });

    entries = allowlist.map(e => ({ type: e.type, value: e.value }));
    await cacheRedis.set(cacheKey, entries, 300);
  }

  // Check deny rules first
  for (const entry of entries) {
    if (entry.type === 'DENY' && matchIp(normalizedIp, entry.value)) {
      return false;
    }
    if (entry.type === 'GEO_DENY') {
      // Geo check would need a GeoIP service
      // For now, skip
    }
  }

  // Check allow rules
  for (const entry of entries) {
    if (entry.type === 'ALLOW' && matchIp(normalizedIp, entry.value)) {
      return true;
    }
    if (entry.type === 'GEO_ALLOW') {
      // Geo check would need a GeoIP service
    }
  }

  // If there are allow rules but no match, deny
  const hasAllowRules = entries.some(e => e.type === 'ALLOW' || e.type === 'GEO_ALLOW');
  if (hasAllowRules) {
    return false;
  }

  // Default allow if no explicit rules
  return true;
}

/**
 * Check geo-blocking
 */
async function checkGeoBlocking(workspaceId: string, ip: string): Promise<boolean> {
  // This would integrate with a GeoIP service like MaxMind
  // For now, return true (allow all)
  // In production, implement with a GeoIP database or service
  return true;
}

/**
 * Match IP against CIDR or exact IP
 */
function matchIp(ip: string, pattern: string): boolean {
  if (pattern.includes('/')) {
    // CIDR notation
    const [rangeIp, bits] = pattern.split('/');
    const mask = parseInt(bits, 10);
    return cidrMatch(ip, rangeIp, mask);
  }
  return ip === pattern;
}

/**
 * Check if IP matches CIDR range
 */
function cidrMatch(ip: string, rangeIp: string, bits: number): boolean {
  const ipParts = ip.split('.').map(Number);
  const rangeParts = rangeIp.split('.').map(Number);

  if (ipParts.length !== 4 || rangeParts.length !== 4) {
    // IPv6 not implemented
    return false;
  }

  const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
  const rangeNum = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3];
  const mask = ~((1 << (32 - bits)) - 1);

  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Invalidate workspace access cache
 */
export async function invalidateWorkspaceAccessCache(userId: string, workspaceId: string): Promise<void> {
  await cacheRedis.delete(`workspace_access:${userId}:${workspaceId}`);
  await cacheRedis.delete(`ip_allowlist:${workspaceId}`);
}