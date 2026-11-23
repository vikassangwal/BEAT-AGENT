import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { scimService } from '../services/scimService';
import { authenticate, AuthenticatedRequest, requireWorkspace, requireWorkspaceAdmin } from '../middleware/auth';
import { workspaceAccess, WorkspaceAccessRequest } from '../middleware/workspaceAccess';
import { validateRequestBody } from '../middleware/security';
import { config } from '../config';
import { auditService, AuditEventType } from '../services/auditService';

const router = Router();

// Validation schemas
const scimConfigSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().url(),
  bearerToken: z.string().min(1),
  userSchema: z.record(z.unknown()).optional(),
  groupSchema: z.record(z.unknown()).optional(),
  attributeMapping: z.record(z.string()).optional(),
  filterConfig: z.record(z.unknown()).optional(),
  provisioningRules: z.record(z.unknown()).optional(),
});

const scimUserSchema = z.object({
  externalId: z.string().optional(),
  userName: z.string().min(1),
  displayName: z.string().optional(),
  emails: z.array(z.object({
    value: z.string().email(),
    primary: z.boolean().optional(),
    type: z.string().optional(),
  })).optional(),
  groups: z.array(z.object({
    value: z.string(),
    display: z.string().optional(),
  })).optional(),
  active: z.boolean().optional(),
  schemas: z.array(z.string()).optional(),
  meta: z.record(z.unknown()).optional(),
});

const scimGroupSchema = z.object({
  externalId: z.string().optional(),
  displayName: z.string().min(1),
  members: z.array(z.object({
    value: z.string(),
    display: z.string().optional(),
  })).optional(),
  schemas: z.array(z.string()).optional(),
  meta: z.record(z.unknown()).optional(),
});

const scimPatchSchema = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z.array(z.object({
    op: z.enum(['add', 'remove', 'replace']),
    path: z.string(),
    value: z.unknown().optional(),
  })),
});

/**
 * GET /api/v1/scim/config
 * Get SCIM configuration
 */
router.get('/config', authenticate, requireWorkspace, requireWorkspaceAdmin, async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const config = await scimService.getScimConfig(authReq.workspaceId!);

    // Don't return sensitive fields
    const safeConfig = config ? {
      ...config,
      bearerToken: config.bearerToken ? '[REDACTED]' : undefined,
    } : null;

    res.json({
      success: true,
      data: safeConfig,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch SCIM configuration',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/scim/config
 * Configure SCIM for workspace
 */
router.post('/config', authenticate, requireWorkspace, requireWorkspaceAdmin, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = scimConfigSchema.parse(req.body);

    await scimService.configureScim({
      workspaceId: authReq.workspaceId!,
      ...data,
    }, authReq.user!.sub);

    res.json({
      success: true,
      message: 'SCIM configuration saved',
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
      error: 'CONFIG_FAILED',
      message: 'Failed to configure SCIM',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/scim/sync
 * Trigger manual sync from IdP
 */
router.post('/sync', authenticate, requireWorkspace, requireWorkspaceAdmin, async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const result = await scimService.syncFromIdP(authReq.workspaceId!);

    res.json({
      success: true,
      data: result,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'SYNC_FAILED',
      message: 'Failed to sync from IdP',
      correlationId,
    });
  }
});

/**
 * SCIM Standard Endpoints (for IdP integration)
 * These are called by the IdP, not by our frontend
 */

// GET /scim/v2/Users
router.get('/Users', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    // Validate bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const workspaceId = req.headers['x-workspace-id'] as string;

    if (!workspaceId || !(await scimService.validateToken(workspaceId, token))) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Invalid token',
      });
      return;
    }

    const startIndex = parseInt(req.query.startIndex as string) || 1;
    const count = Math.min(parseInt(req.query.count as string) || 100, 1000);
    const filter = req.query.filter as string;

    const result = await scimService.listUsers(workspaceId, { startIndex, count, filter });

    res.setHeader('Content-Type', 'application/scim+json');
    res.json(result);
  } catch (error) {
    const message = (error as Error).message;
    let status = 500;

    if (message === 'SCIM_NOT_ENABLED') status = 404;
    if (message === 'USER_NOT_FOUND') status = 404;

    res.status(status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
      detail: message,
    });
  }
});

// GET /scim/v2/Users/:id
router.get('/Users/:id', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const workspaceId = req.headers['x-workspace-id'] as string;

    if (!workspaceId || !(await scimService.validateToken(workspaceId, token))) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Invalid token',
      });
      return;
    }

    const user = await scimService.getUser(workspaceId, req.params.id);

    res.setHeader('Content-Type', 'application/scim+json');
    res.json(user);
  } catch (error) {
    const message = (error as Error).message;
    let status = 500;

    if (message === 'SCIM_NOT_ENABLED') status = 404;
    if (message === 'USER_NOT_FOUND') status = 404;

    res.status(status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
      detail: message,
    });
  }
});

// POST /scim/v2/Users
router.post('/Users', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const workspaceId = req.headers['x-workspace-id'] as string;

    if (!workspaceId || !(await scimService.validateToken(workspaceId, token))) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Invalid token',
      });
      return;
    }

    const data = scimUserSchema.parse(req.body);
    const user = await scimService.createUser(workspaceId, data, 'scim');

    res.setHeader('Content-Type', 'application/scim+json');
    res.status(201).json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 400,
        detail: 'Invalid request data',
      });
      return;
    }

    const message = (error as Error).message;
    let status = 500;

    if (message === 'SCIM_NOT_ENABLED') status = 404;
    if (message === 'USER_ALREADY_EXISTS') status = 409;

    res.status(status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
      detail: message,
    });
  }
});

// PUT /scim/v2/Users/:id
router.put('/Users/:id', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const workspaceId = req.headers['x-workspace-id'] as string;

    if (!workspaceId || !(await scimService.validateToken(workspaceId, token))) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Invalid token',
      });
      return;
    }

    const data = scimUserSchema.parse(req.body);
    const user = await scimService.updateUser(workspaceId, req.params.id, data, 'scim');

    res.setHeader('Content-Type', 'application/scim+json');
    res.json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 400,
        detail: 'Invalid request data',
      });
      return;
    }

    const message = (error as Error).message;
    let status = 500;

    if (message === 'SCIM_NOT_ENABLED') status = 404;
    if (message === 'USER_NOT_FOUND') status = 404;

    res.status(status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
      detail: message,
    });
  }
});

// PATCH /scim/v2/Users/:id
router.patch('/Users/:id', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const workspaceId = req.headers['x-workspace-id'] as string;

    if (!workspaceId || !(await scimService.validateToken(workspaceId, token))) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Invalid token',
      });
      return;
    }

    const data = scimPatchSchema.parse(req.body);
    const user = await scimService.patchUser(workspaceId, req.params.id, data.Operations, 'scim');

    res.setHeader('Content-Type', 'application/scim+json');
    res.json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 400,
        detail: 'Invalid request data',
      });
      return;
    }

    const message = (error as Error).message;
    let status = 500;

    if (message === 'SCIM_NOT_ENABLED') status = 404;
    if (message === 'USER_NOT_FOUND') status = 404;

    res.status(status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
      detail: message,
    });
  }
});

// DELETE /scim/v2/Users/:id
router.delete('/Users/:id', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const workspaceId = req.headers['x-workspace-id'] as string;

    if (!workspaceId || !(await scimService.validateToken(workspaceId, token))) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Invalid token',
      });
      return;
    }

    await scimService.deleteUser(workspaceId, req.params.id, 'scim');

    res.status(204).send();
  } catch (error) {
    const message = (error as Error).message;
    let status = 500;

    if (message === 'SCIM_NOT_ENABLED') status = 404;
    if (message === 'USER_NOT_FOUND') status = 404;

    res.status(status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
      detail: message,
    });
  }
});

// Groups endpoints
router.get('/Groups', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const workspaceId = req.headers['x-workspace-id'] as string;

    if (!workspaceId || !(await scimService.validateToken(workspaceId, token))) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Invalid token',
      });
      return;
    }

    const startIndex = parseInt(req.query.startIndex as string) || 1;
    const count = Math.min(parseInt(req.query.count as string) || 100, 1000);
    const filter = req.query.filter as string;

    const result = await scimService.listGroups(workspaceId, { startIndex, count, filter });

    res.setHeader('Content-Type', 'application/scim+json');
    res.json(result);
  } catch (error) {
    const message = (error as Error).message;
    let status = 500;

    if (message === 'SCIM_NOT_ENABLED') status = 404;

    res.status(status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
      detail: message,
    });
  }
});

router.get('/Groups/:id', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const workspaceId = req.headers['x-workspace-id'] as string;

    if (!workspaceId || !(await scimService.validateToken(workspaceId, token))) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Invalid token',
      });
      return;
    }

    const group = await scimService.getGroup(workspaceId, req.params.id);

    res.setHeader('Content-Type', 'application/scim+json');
    res.json(group);
  } catch (error) {
    const message = (error as Error).message;
    let status = 500;

    if (message === 'SCIM_NOT_ENABLED') status = 404;
    if (message === 'GROUP_NOT_FOUND') status = 404;

    res.status(status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
      detail: message,
    });
  }
});

router.post('/Groups', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const workspaceId = req.headers['x-workspace-id'] as string;

    if (!workspaceId || !(await scimService.validateToken(workspaceId, token))) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Invalid token',
      });
      return;
    }

    const data = scimGroupSchema.parse(req.body);
    const group = await scimService.createGroup(workspaceId, data, 'scim');

    res.setHeader('Content-Type', 'application/scim+json');
    res.status(201).json(group);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 400,
        detail: 'Invalid request data',
      });
      return;
    }

    const message = (error as Error).message;
    let status = 500;

    if (message === 'SCIM_NOT_ENABLED') status = 404;
    if (message === 'GROUP_ALREADY_EXISTS') status = 409;

    res.status(status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
      detail: message,
    });
  }
});

router.put('/Groups/:id', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const workspaceId = req.headers['x-workspace-id'] as string;

    if (!workspaceId || !(await scimService.validateToken(workspaceId, token))) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Invalid token',
      });
      return;
    }

    const data = scimGroupSchema.parse(req.body);
    const group = await scimService.updateGroup(workspaceId, req.params.id, data, 'scim');

    res.setHeader('Content-Type', 'application/scim+json');
    res.json(group);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 400,
        detail: 'Invalid request data',
      });
      return;
    }

    const message = (error as Error).message;
    let status = 500;

    if (message === 'SCIM_NOT_ENABLED') status = 404;
    if (message === 'GROUP_NOT_FOUND') status = 404;

    res.status(status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
      detail: message,
    });
  }
});

router.delete('/Groups/:id', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Bearer token required',
      });
      return;
    }

    const token = authHeader.substring(7);
    const workspaceId = req.headers['x-workspace-id'] as string;

    if (!workspaceId || !(await scimService.validateToken(workspaceId, token))) {
      res.status(401).json({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: 401,
        detail: 'Invalid token',
      });
      return;
    }

    await scimService.deleteGroup(workspaceId, req.params.id, 'scim');

    res.status(204).send();
  } catch (error) {
    const message = (error as Error).message;
    let status = 500;

    if (message === 'SCIM_NOT_ENABLED') status = 404;
    if (message === 'GROUP_NOT_FOUND') status = 404;

    res.status(status).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
      detail: message,
    });
  }
});

// Service Provider Configuration
router.get('/ServiceProviderConfig', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json');
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 1000 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        name: 'Bearer Token',
        description: 'Authentication using Bearer Token',
        specUrl: 'https://www.rfc-editor.org/rfc/rfc6750',
        documentationUrl: 'https://www.rfc-editor.org/rfc/rfc6750',
        type: 'oauthbearertoken',
        primary: true,
      },
    ],
  });
});

// Resource Types
router.get('/ResourceTypes', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json');
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 2,
    Resources: [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        description: 'User Account',
        schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
        schemaExtensions: [],
      },
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'Group',
        name: 'Group',
        endpoint: '/Groups',
        description: 'Group',
        schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
        schemaExtensions: [],
      },
    ],
  });
});

// Schemas
router.get('/Schemas', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/scim+json');
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 2,
    Resources: [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
        id: 'urn:ietf:params:scim:schemas:core:2.0:User',
        name: 'User',
        description: 'User Account',
        attributes: [
          { name: 'userName', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'server' },
          { name: 'displayName', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
          { name: 'emails', type: 'complex', multiValued: true, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', subAttributes: [
            { name: 'value', type: 'string', caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            { name: 'primary', type: 'boolean', caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            { name: 'type', type: 'string', caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
          ]},
          { name: 'groups', type: 'complex', multiValued: true, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', subAttributes: [
            { name: 'value', type: 'string', caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            { name: 'display', type: 'string', caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
          ]},
          { name: 'active', type: 'boolean', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
        ],
      },
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
        id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
        name: 'Group',
        description: 'Group',
        attributes: [
          { name: 'displayName', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'server' },
          { name: 'members', type: 'complex', multiValued: true, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', subAttributes: [
            { name: 'value', type: 'string', caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
            { name: 'display', type: 'string', caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
          ]},
        ],
      },
    ],
  });
});

export default router;