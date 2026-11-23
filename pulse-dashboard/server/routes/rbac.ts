import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { rbacService } from '../services/rbacService';
import { authenticate, AuthenticatedRequest, requireWorkspace, requireWorkspaceAdmin, requirePermissions } from '../middleware/auth';
import { workspaceAccess, WorkspaceAccessRequest } from '../middleware/workspaceAccess';
import { validateRequestBody } from '../middleware/security';
import { MembershipRole, PermissionAction, ResourceType } from '@prisma/client';
import { auditService, AuditEventType } from '../services/auditService';

const router = Router();

// Validation schemas
const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string()).min(1),
  conditions: z.record(z.unknown()).optional(),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string()).optional(),
  conditions: z.record(z.unknown()).optional(),
});

const assignRoleSchema = z.object({
  userId: z.string().min(1),
  roleId: z.string().min(1),
});

const checkPermissionSchema = z.object({
  resource: z.nativeEnum(ResourceType),
  action: z.nativeEnum(PermissionAction),
  resourceId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

/**
 * GET /api/v1/rbac/roles
 * List all roles in workspace
 */
router.get('/roles', authenticate, requireWorkspace, requirePermissions('ROLE:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const roles = await rbacService.listRoles(authReq.workspaceId!);

    res.json({
      success: true,
      data: roles,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch roles',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/rbac/roles/:id
 * Get role by ID
 */
router.get('/roles/:id', authenticate, requireWorkspace, requirePermissions('ROLE:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const role = await rbacService.getRole(req.params.id, authReq.workspaceId!);

    if (!role) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Role not found',
        correlationId,
      });
      return;
    }

    res.json({
      success: true,
      data: role,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch role',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/rbac/roles
 * Create a custom role
 */
router.post('/roles', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('ROLE:CREATE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = createRoleSchema.parse(req.body);

    const role = await rbacService.createRole({
      workspaceId: authReq.workspaceId!,
      ...data,
      createdBy: authReq.user!.sub,
    });

    res.status(201).json({
      success: true,
      data: role,
      correlationId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: error.errors,
        correlationId,
      });
      return;
    }

    const message = (error as Error).message;
    let status = 400;

    switch (message) {
      case 'ROLE_NAME_EXISTS':
        status = 409;
        break;
      case 'INVALID_PERMISSIONS':
        status = 400;
        break;
    }

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * PUT /api/v1/rbac/roles/:id
 * Update a role
 */
router.put('/roles/:id', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('ROLE:UPDATE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = updateRoleSchema.parse(req.body);

    const role = await rbacService.updateRole(
      req.params.id,
      authReq.workspaceId!,
      data,
      authReq.user!.sub
    );

    res.json({
      success: true,
      data: role,
      correlationId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: error.errors,
        correlationId,
      });
      return;
    }

    const message = (error as Error).message;
    let status = 400;

    switch (message) {
      case 'ROLE_NOT_FOUND':
        status = 404;
        break;
      case 'CANNOT_MODIFY_SYSTEM_ROLE':
        status = 403;
        break;
      case 'INVALID_PERMISSIONS':
        status = 400;
        break;
    }

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * DELETE /api/v1/rbac/roles/:id
 * Delete a role
 */
router.delete('/roles/:id', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('ROLE:DELETE'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    await rbacService.deleteRole(req.params.id, authReq.workspaceId!, authReq.user!.sub);

    res.json({
      success: true,
      message: 'Role deleted',
      correlationId,
    });
  } catch (error) {
    const message = (error as Error).message;
    let status = 400;

    switch (message) {
      case 'ROLE_NOT_FOUND':
        status = 404;
        break;
      case 'CANNOT_DELETE_SYSTEM_ROLE':
        status = 403;
        break;
      case 'ROLE_IN_USE':
        status = 409;
        break;
    }

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * POST /api/v1/rbac/assign
 * Assign role to user
 */
router.post('/assign', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('ROLE:ASSIGN'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = assignRoleSchema.parse(req.body);

    await rbacService.assignRole({
      userId: data.userId,
      workspaceId: authReq.workspaceId!,
      roleId: data.roleId,
      assignedBy: authReq.user!.sub,
    });

    res.json({
      success: true,
      message: 'Role assigned',
      correlationId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: error.errors,
        correlationId,
      });
      return;
    }

    const message = (error as Error).message;
    let status = 400;

    switch (message) {
      case 'MEMBERSHIP_NOT_FOUND':
        status = 404;
        break;
      case 'ROLE_NOT_FOUND':
        status = 404;
        break;
    }

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * POST /api/v1/rbac/revoke
 * Revoke role from user
 */
router.post('/revoke', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('ROLE:REVOKE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({ userId: z.string().min(1) });
    const { userId } = schema.parse(req.body);

    await rbacService.revokeRole(userId, authReq.workspaceId!, authReq.user!.sub);

    res.json({
      success: true,
      message: 'Role revoked',
      correlationId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: error.errors,
        correlationId,
      });
      return;
    }

    res.status(500).json({
      error: 'REVOKE_FAILED',
      message: 'Failed to revoke role',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/rbac/check-permission
 * Check if user has permission
 */
router.post('/check-permission', authenticate, requireWorkspace, requirePermissions('ROLE:READ'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = checkPermissionSchema.parse(req.body);

    const hasPermission = await rbacService.checkPermission(
      authReq.user!.sub,
      authReq.workspaceId!,
      data
    );

    res.json({
      success: true,
      data: { hasPermission },
      correlationId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: error.errors,
        correlationId,
      });
      return;
    }

    res.status(500).json({
      error: 'CHECK_FAILED',
      message: 'Failed to check permission',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/rbac/permissions
 * Get all available permissions
 */
router.get('/permissions', authenticate, requireWorkspace, requirePermissions('ROLE:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const permissions = await rbacService['prisma'].permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });

    // Group by resource
    const grouped = permissions.reduce((acc, p) => {
      if (!acc[p.resource]) acc[p.resource] = [];
      acc[p.resource].push({ action: p.action, description: p.description });
      return acc;
    }, {} as Record<string, Array<{ action: string; description: string | null }>>);

    res.json({
      success: true,
      data: grouped,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch permissions',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/rbac/my-permissions
 * Get current user's effective permissions
 */
router.get('/my-permissions', authenticate, requireWorkspace, async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const permissions = await rbacService.getUserPermissions(authReq.user!.sub, authReq.workspaceId!);

    res.json({
      success: true,
      data: permissions,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch permissions',
      correlationId,
    });
  }
});

export default router;