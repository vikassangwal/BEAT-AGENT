import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { auditService, AuditLogFilters } from '../services/auditService';
import { authenticate, AuthenticatedRequest, requireWorkspace, requireWorkspaceAdmin, requirePermissions } from '../middleware/auth';
import { workspaceAccess, WorkspaceAccessRequest } from '../middleware/workspaceAccess';
import { validateRequestBody } from '../middleware/security';
import { AuditEventType, AuditSeverity, ResourceType } from '@prisma/client';

const router = Router();

// Validation schemas
const auditQuerySchema = z.object({
  userId: z.string().optional(),
  eventType: z.array(z.nativeEnum(AuditEventType)).optional(),
  severity: z.array(z.nativeEnum(AuditSeverity)).optional(),
  resourceType: z.nativeEnum(ResourceType).optional(),
  resourceId: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  ipAddress: z.string().optional(),
  correlationId: z.string().optional(),
  sessionId: z.string().optional(),
  limit: z.coerce.number().min(1).max(1000).optional(),
  offset: z.coerce.number().min(0).optional(),
  sortBy: z.enum(['createdAt', 'severity']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const exportSchema = z.object({
  format: z.enum(['JSON', 'CSV', 'CEF', 'LEEF']).optional(),
  filters: auditQuerySchema.optional(),
  dateFrom: z.string().datetime(),
  dateTo: z.string().datetime(),
});

/**
 * GET /api/v1/audit
 * Query audit logs
 */
router.get('/', authenticate, requireWorkspace, requirePermissions('AUDIT_LOG:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const query = auditQuerySchema.parse(req.query);

    const filters: AuditLogFilters = {
      workspaceId: authReq.workspaceId!,
      userId: query.userId,
      eventType: query.eventType,
      severity: query.severity,
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      ipAddress: query.ipAddress,
      correlationId: query.correlationId,
      sessionId: query.sessionId,
      limit: query.limit || 100,
      offset: query.offset || 0,
      sortBy: query.sortBy || 'createdAt',
      sortOrder: query.sortOrder || 'desc',
    };

    const result = await auditService.query(filters);

    res.json({
      success: true,
      data: result.logs,
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total: result.total,
        hasMore: result.hasMore,
      },
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
      error: 'QUERY_FAILED',
      message: 'Failed to query audit logs',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/audit/stats
 * Get audit log statistics
 */
router.get('/stats', authenticate, requireWorkspace, requirePermissions('AUDIT_LOG:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({
      dateFrom: z.string().datetime().optional(),
      dateTo: z.string().datetime().optional(),
    });
    const query = schema.parse(req.query);

    const stats = await auditService.getStats(
      authReq.workspaceId!,
      query.dateFrom ? new Date(query.dateFrom) : undefined,
      query.dateTo ? new Date(query.dateTo) : undefined
    );

    res.json({
      success: true,
      data: stats,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'STATS_FAILED',
      message: 'Failed to fetch audit statistics',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/audit/:id
 * Get single audit log entry
 */
router.get('/:id', authenticate, requireWorkspace, requirePermissions('AUDIT_LOG:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const log = await auditService.getById(req.params.id, authReq.workspaceId!);

    if (!log) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Audit log entry not found',
        correlationId,
      });
      return;
    }

    res.json({
      success: true,
      data: log,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch audit log entry',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/audit/export
 * Export audit logs
 */
router.post('/export', authenticate, requireWorkspace, requirePermissions('AUDIT_LOG:EXPORT'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = exportSchema.parse(req.body);

    const exportId = await auditService.export({
      workspaceId: authReq.workspaceId!,
      requestedBy: authReq.user!.sub,
      format: data.format || 'JSON',
      filters: data.filters || {},
      dateFrom: new Date(data.dateFrom),
      dateTo: new Date(data.dateTo),
    });

    res.json({
      success: true,
      data: { exportId },
      message: 'Export started. Check status with GET /api/v1/audit/exports/:id',
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
      error: 'EXPORT_FAILED',
      message: 'Failed to start export',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/audit/exports
 * List audit log exports
 */
router.get('/exports', authenticate, requireWorkspace, requirePermissions('AUDIT_LOG:EXPORT'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({
      limit: z.coerce.number().min(1).max(100).optional(),
      offset: z.coerce.number().min(0).optional(),
      status: z.string().optional(),
    });
    const query = schema.parse(req.query);

    const exports = await auditService['prisma'].auditLogExport.findMany({
      where: {
        workspaceId: authReq.workspaceId!,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit || 20,
      skip: query.offset || 0,
    });

    const total = await auditService['prisma'].auditLogExport.count({
      where: { workspaceId: authReq.workspaceId!, ...(query.status ? { status: query.status } : {}) },
    });

    res.json({
      success: true,
      data: exports,
      pagination: { limit: query.limit || 20, offset: query.offset || 0, total },
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch exports',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/audit/exports/:id
 * Get export status
 */
router.get('/exports/:id', authenticate, requireWorkspace, requirePermissions('AUDIT_LOG:EXPORT'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const exportRecord = await auditService['prisma'].auditLogExport.findFirst({
      where: { id: req.params.id, workspaceId: authReq.workspaceId! },
    });

    if (!exportRecord) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Export not found',
        correlationId,
      });
      return;
    }

    res.json({
      success: true,
      data: exportRecord,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch export',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/audit/exports/:id/download
 * Download export file
 */
router.get('/exports/:id/download', authenticate, requireWorkspace, requirePermissions('AUDIT_LOG:EXPORT'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const exportRecord = await auditService['prisma'].auditLogExport.findFirst({
      where: { id: req.params.id, workspaceId: authReq.workspaceId! },
    });

    if (!exportRecord) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Export not found',
        correlationId,
      });
      return;
    }

    if (exportRecord.status !== 'COMPLETED') {
      res.status(400).json({
        error: 'NOT_READY',
        message: 'Export is not ready',
        correlationId,
      });
      return;
    }

    if (!exportRecord.fileUrl) {
      res.status(404).json({
        error: 'FILE_NOT_FOUND',
        message: 'Export file not found',
        correlationId,
      });
      return;
    }

    // In production, stream from S3/storage
    // For now, decode base64 data URL
    if (exportRecord.fileUrl.startsWith('data:')) {
      const base64Data = exportRecord.fileUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="audit-export-${exportRecord.id}.${exportRecord.format.toLowerCase()}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } else {
      res.redirect(exportRecord.fileUrl);
    }
  } catch (error) {
    res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      message: 'Failed to download export',
      correlationId,
    });
  }
});

export default router;