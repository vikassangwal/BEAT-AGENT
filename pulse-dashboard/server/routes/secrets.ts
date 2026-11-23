import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { secretsService } from '../services/secretsService';
import { authenticate, AuthenticatedRequest, requireWorkspace, requireWorkspaceAdmin, requirePermissions } from '../middleware/auth';
import { workspaceAccess, WorkspaceAccessRequest } from '../middleware/workspaceAccess';
import { validateRequestBody } from '../middleware/security';
import { SecretType, SecretRotationStatus } from '@prisma/client';
import { auditService, AuditEventType } from '../services/auditService';

const router = Router();

// Validation schemas
const createSecretSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.nativeEnum(SecretType),
  value: z.string().min(1),
  description: z.string().max(500).optional(),
  tags: z.array(z.string()).optional(),
  rotationEnabled: z.boolean().optional(),
  rotationIntervalDays: z.number().int().min(1).max(365).optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateSecretSchema = z.object({
  value: z.string().optional(),
  description: z.string().max(500).optional(),
  tags: z.array(z.string()).optional(),
  rotationEnabled: z.boolean().optional(),
  rotationIntervalDays: z.number().int().min(1).max(365).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const rotateSecretSchema = z.object({
  newValue: z.string().optional(),
});

/**
 * GET /api/v1/secrets
 * List secrets (without values)
 */
router.get('/', authenticate, requireWorkspace, requirePermissions('SECRET:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({
      type: z.nativeEnum(SecretType).optional(),
      tag: z.string().optional(),
    });
    const query = schema.parse(req.query);

    const secrets = await secretsService.listSecrets(authReq.workspaceId!, {
      type: query.type,
      tag: query.tag,
    });

    res.json({
      success: true,
      data: secrets,
      correlationId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid query parameters',
        details: error.errors,
        correlationId,
      });
      return;
    }

    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch secrets',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/secrets/:id
 * Get secret by ID (with decrypted value)
 */
router.get('/:id', authenticate, requireWorkspace, requirePermissions('SECRET:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const secret = await secretsService.getSecretById(req.params.id, authReq.user!.sub, req.ip);

    if (!secret || secret.workspaceId !== authReq.workspaceId) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Secret not found',
        correlationId,
      });
      return;
    }

    res.json({
      success: true,
      data: secret,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch secret',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/secrets/name/:name
 * Get secret by name (with decrypted value)
 */
router.get('/name/:name', authenticate, requireWorkspace, requirePermissions('SECRET:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const secret = await secretsService.getSecret(authReq.workspaceId!, req.params.name, authReq.user!.sub, req.ip);

    if (!secret) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Secret not found',
        correlationId,
      });
      return;
    }

    res.json({
      success: true,
      data: secret,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch secret',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/secrets
 * Create a new secret
 */
router.post('/', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('SECRET:CREATE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = createSecretSchema.parse(req.body);

    const secret = await secretsService.createSecret({
      workspaceId: authReq.workspaceId!,
      ...data,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      createdBy: authReq.user!.sub,
    });

    res.status(201).json({
      success: true,
      data: secret,
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

    if (message === 'SECRET_EXISTS') status = 409;

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * PUT /api/v1/secrets/:id
 * Update a secret
 */
router.put('/:id', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('SECRET:UPDATE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = updateSecretSchema.parse(req.body);

    const secret = await secretsService.updateSecret(
      req.params.id,
      authReq.workspaceId!,
      {
        ...data,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : data.expiresAt === null ? null : undefined,
      },
      authReq.user!.sub
    );

    res.json({
      success: true,
      data: secret,
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

    if (message === 'SECRET_NOT_FOUND') status = 404;

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * DELETE /api/v1/secrets/:id
 * Delete a secret
 */
router.delete('/:id', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('SECRET:DELETE'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    await secretsService.deleteSecret(req.params.id, authReq.workspaceId!, authReq.user!.sub);

    res.json({
      success: true,
      message: 'Secret deleted',
      correlationId,
    });
  } catch (error) {
    const message = (error as Error).message;
    let status = 400;

    if (message === 'SECRET_NOT_FOUND') status = 404;

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * GET /api/v1/secrets/:id/versions
 * Get secret versions
 */
router.get('/:id/versions', authenticate, requireWorkspace, requirePermissions('SECRET:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const versions = await secretsService.getVersions(req.params.id, authReq.workspaceId!);

    res.json({
      success: true,
      data: versions,
      correlationId,
    });
  } catch (error) {
    const message = (error as Error).message;
    let status = 500;

    if (message === 'SECRET_NOT_FOUND') status = 404;

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * POST /api/v1/secrets/:id/rotate
 * Rotate a secret
 */
router.post('/:id/rotate', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('SECRET:UPDATE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = rotateSecretSchema.parse(req.body);

    const secret = await secretsService.rotateSecret(
      req.params.id,
      authReq.workspaceId!,
      authReq.user!.sub,
      data.newValue
    );

    res.json({
      success: true,
      data: secret,
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

    if (message === 'SECRET_NOT_FOUND') status = 404;

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * GET /api/v1/secrets/:id/access-logs
 * Get secret access logs
 */
router.get('/:id/access-logs', authenticate, requireWorkspace, requirePermissions('SECRET:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({
      limit: z.coerce.number().min(1).max(1000).optional(),
    });
    const query = schema.parse(req.query);

    const logs = await secretsService.getAccessLogs(req.params.id, authReq.workspaceId!, query.limit || 100);

    res.json({
      success: true,
      data: logs,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch access logs',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/secrets/sync-vault
 * Sync with external vault
 */
router.post('/sync-vault', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('SECRET:MANAGE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({
      vaultType: z.enum(['VAULT', 'AWS_SECRETS_MANAGER']),
    });
    const { vaultType } = schema.parse(req.body);

    const result = await secretsService.syncWithVault(authReq.workspaceId!, vaultType);

    res.json({
      success: true,
      data: result,
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
      error: 'SYNC_FAILED',
      message: 'Failed to sync with vault',
      correlationId,
    });
  }
});

export default router;