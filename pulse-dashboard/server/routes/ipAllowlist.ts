import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ipAllowlistService, CreateIpAllowlistInput } from '../services/ipAllowlistService';
import { authenticate, AuthenticatedRequest, requireWorkspace, requireWorkspaceAdmin, requirePermissions } from '../middleware/auth';
import { workspaceAccess, WorkspaceAccessRequest } from '../middleware/workspaceAccess';
import { validateRequestBody } from '../middleware/security';
import { IPAllowlistType } from '@prisma/client';
import { auditService, AuditEventType } from '../services/auditService';

const router = Router();

// Validation schemas
const createEntrySchema = z.object({
  type: z.nativeEnum(IPAllowlistType),
  value: z.string().min(1),
  description: z.string().max(500).optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateEntrySchema = z.object({
  type: z.nativeEnum(IPAllowlistType).optional(),
  value: z.string().optional(),
  description: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const bulkImportSchema = z.object({
  entries: z.array(createEntrySchema).min(1).max(1000),
});

/**
 * GET /api/v1/ip-allowlist
 * List IP allowlist entries
 */
router.get('/', authenticate, requireWorkspace, requirePermissions('IP_ALLOWLIST:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const entries = await ipAllowlistService.listEntries(authReq.workspaceId!);

    res.json({
      success: true,
      data: entries,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch IP allowlist entries',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/ip-allowlist
 * Create IP allowlist entry
 */
router.post('/', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('IP_ALLOWLIST:CREATE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = createEntrySchema.parse(req.body);

    const entry = await ipAllowlistService.createEntry({
      workspaceId: authReq.workspaceId!,
      ...data,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      createdBy: authReq.user!.sub,
    });

    res.status(201).json({
      success: true,
      data: entry,
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

    if (message === 'INVALID_ENTRY_VALUE') status = 400;

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * PUT /api/v1/ip-allowlist/:id
 * Update IP allowlist entry
 */
router.put('/:id', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('IP_ALLOWLIST:UPDATE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = updateEntrySchema.parse(req.body);

    const entry = await ipAllowlistService.updateEntry(
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
      data: entry,
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

    if (message === 'ENTRY_NOT_FOUND') status = 404;
    if (message === 'INVALID_ENTRY_VALUE') status = 400;

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * DELETE /api/v1/ip-allowlist/:id
 * Delete IP allowlist entry
 */
router.delete('/:id', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('IP_ALLOWLIST:DELETE'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    await ipAllowlistService.deleteEntry(req.params.id, authReq.workspaceId!, authReq.user!.sub);

    res.json({
      success: true,
      message: 'IP allowlist entry deleted',
      correlationId,
    });
  } catch (error) {
    const message = (error as Error).message;
    let status = 400;

    if (message === 'ENTRY_NOT_FOUND') status = 404;

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * POST /api/v1/ip-allowlist/bulk
 * Bulk import IP allowlist entries
 */
router.post('/bulk', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('IP_ALLOWLIST:CREATE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = bulkImportSchema.parse(req.body);

    const result = await ipAllowlistService.bulkImport(
      authReq.workspaceId!,
      data.entries.map(e => ({
        ...e,
        expiresAt: e.expiresAt ? new Date(e.expiresAt) : undefined,
        createdBy: authReq.user!.sub,
      })),
      authReq.user!.sub
    );

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
      error: 'BULK_IMPORT_FAILED',
      message: 'Failed to bulk import entries',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/ip-allowlist/export
 * Export IP allowlist entries
 */
router.get('/export', authenticate, requireWorkspace, requirePermissions('IP_ALLOWLIST:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const exportData = await ipAllowlistService.exportEntries(authReq.workspaceId!);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="ip-allowlist-${authReq.workspaceId}.json"`);
    res.send(exportData);
  } catch (error) {
    res.status(500).json({
      error: 'EXPORT_FAILED',
      message: 'Failed to export entries',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/ip-allowlist/check
 * Check if IP is allowed (for testing)
 */
router.post('/check', authenticate, requireWorkspace, requireWorkspaceAdmin, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({ ip: z.string().min(1) });
    const { ip } = schema.parse(req.body);

    const result = await ipAllowlistService.checkIpAllowed(authReq.workspaceId!, ip);

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
      error: 'CHECK_FAILED',
      message: 'Failed to check IP',
      correlationId,
    });
  }
});

export default router;