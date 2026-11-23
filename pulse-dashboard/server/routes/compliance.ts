import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { complianceService } from '../services/complianceService';
import { authenticate, AuthenticatedRequest, requireWorkspace, requireWorkspaceAdmin, requirePermissions } from '../middleware/auth';
import { workspaceAccess, WorkspaceAccessRequest } from '../middleware/workspaceAccess';
import { validateRequestBody } from '../middleware/security';
import { ComplianceFramework, DataResidencyRegion, ResourceType } from '@prisma/client';
import { auditService, AuditEventType } from '../services/auditService';

const router = Router();

// Validation schemas
const reportSchema = z.object({
  framework: z.nativeEnum(ComplianceFramework),
  reportType: z.enum(['FULL', 'GAP_ANALYSIS', 'EVIDENCE_PACKAGE']),
  dateFrom: z.string().datetime(),
  dateTo: z.string().datetime(),
});

const retentionPolicySchema = z.object({
  name: z.string().min(1).max(100),
  resourceType: z.nativeEnum(ResourceType),
  conditions: z.record(z.unknown()).optional(),
  retentionDays: z.number().int().min(1).max(3650),
  action: z.enum(['DELETE', 'ARCHIVE', 'ANONYMIZE']),
});

const dataResidencySchema = z.object({
  primaryRegion: z.nativeEnum(DataResidencyRegion),
  allowedRegions: z.array(z.nativeEnum(DataResidencyRegion)).min(1),
  replicationEnabled: z.boolean().optional(),
  encryptionAtRest: z.boolean().optional(),
  encryptionInTransit: z.boolean().optional(),
  keyManagement: z.enum(['MANAGED', 'CUSTOMER', 'HSM']).optional(),
});

const gdprExportSchema = z.object({
  userId: z.string().min(1),
});

const gdprDeletionSchema = z.object({
  userId: z.string().min(1),
});

/**
 * POST /api/v1/compliance/reports
 * Generate compliance report
 */
router.post('/reports', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('COMPLIANCE_REPORT:CREATE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = reportSchema.parse(req.body);

    const reportId = await complianceService.generateReport({
      workspaceId: authReq.workspaceId!,
      ...data,
      generatedBy: authReq.user!.sub,
    });

    res.status(202).json({
      success: true,
      data: { reportId },
      message: 'Report generation started',
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
      error: 'REPORT_FAILED',
      message: 'Failed to generate report',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/compliance/reports
 * List compliance reports
 */
router.get('/reports', authenticate, requireWorkspace, requirePermissions('COMPLIANCE_REPORT:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({
      framework: z.nativeEnum(ComplianceFramework).optional(),
      status: z.string().optional(),
      limit: z.coerce.number().min(1).max(100).optional(),
      offset: z.coerce.number().min(0).optional(),
    });
    const query = schema.parse(req.query);

    const where: any = { workspaceId: authReq.workspaceId! };
    if (query.framework) where.framework = query.framework;
    if (query.status) where.status = query.status;

    const reports = await complianceService['prisma'].complianceReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.limit || 20,
      skip: query.offset || 0,
    });

    const total = await complianceService['prisma'].complianceReport.count({ where });

    res.json({
      success: true,
      data: reports,
      pagination: { limit: query.limit || 20, offset: query.offset || 0, total },
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch reports',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/compliance/reports/:id
 * Get compliance report
 */
router.get('/reports/:id', authenticate, requireWorkspace, requirePermissions('COMPLIANCE_REPORT:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const report = await complianceService['prisma'].complianceReport.findFirst({
      where: { id: req.params.id, workspaceId: authReq.workspaceId! },
    });

    if (!report) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Report not found',
        correlationId,
      });
      return;
    }

    res.json({
      success: true,
      data: report,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch report',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/compliance/reports/:id/download
 * Download compliance report
 */
router.get('/reports/:id/download', authenticate, requireWorkspace, requirePermissions('COMPLIANCE_REPORT:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const report = await complianceService['prisma'].complianceReport.findFirst({
      where: { id: req.params.id, workspaceId: authReq.workspaceId! },
    });

    if (!report) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Report not found',
        correlationId,
      });
      return;
    }

    if (report.status !== 'COMPLETED') {
      res.status(400).json({
        error: 'NOT_READY',
        message: 'Report is not ready',
        correlationId,
      });
      return;
    }

    if (!report.fileUrl) {
      res.status(404).json({
        error: 'FILE_NOT_FOUND',
        message: 'Report file not found',
        correlationId,
      });
      return;
    }

    // In production, stream from S3/storage
    if (report.fileUrl.startsWith('data:')) {
      const base64Data = report.fileUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="compliance-report-${report.id}.json"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } else {
      res.redirect(report.fileUrl);
    }
  } catch (error) {
    res.status(500).json({
      error: 'DOWNLOAD_FAILED',
      message: 'Failed to download report',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/compliance/retention-policies
 * Create retention policy
 */
router.post('/retention-policies', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('RETENTION_POLICY:CREATE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = retentionPolicySchema.parse(req.body);

    const policy = await complianceService.createRetentionPolicy({
      workspaceId: authReq.workspaceId!,
      ...data,
      createdBy: authReq.user!.sub,
    });

    res.status(201).json({
      success: true,
      data: policy,
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
      error: 'CREATE_FAILED',
      message: 'Failed to create retention policy',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/compliance/retention-policies
 * List retention policies
 */
router.get('/retention-policies', authenticate, requireWorkspace, requirePermissions('RETENTION_POLICY:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const policies = await complianceService['prisma'].retentionPolicy.findMany({
      where: { workspaceId: authReq.workspaceId! },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: policies,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch retention policies',
      correlationId,
    });
  }
});

/**
 * DELETE /api/v1/compliance/retention-policies/:id
 * Delete retention policy
 */
router.delete('/retention-policies/:id', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('RETENTION_POLICY:DELETE'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    await complianceService['prisma'].retentionPolicy.delete({
      where: { id: req.params.id, workspaceId: authReq.workspaceId! },
    });

    res.json({
      success: true,
      message: 'Retention policy deleted',
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'DELETE_FAILED',
      message: 'Failed to delete retention policy',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/compliance/data-residency
 * Get data residency configuration
 */
router.get('/data-residency', authenticate, requireWorkspace, requirePermissions('COMPLIANCE_REPORT:READ'), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const config = await complianceService.getDataResidencyConfig(authReq.workspaceId!);

    res.json({
      success: true,
      data: config,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch data residency config',
      correlationId,
    });
  }
});

/**
 * PUT /api/v1/compliance/data-residency
 * Configure data residency
 */
router.put('/data-residency', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('COMPLIANCE_REPORT:MANAGE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = dataResidencySchema.parse(req.body);

    const config = await complianceService.configureDataResidency({
      workspaceId: authReq.workspaceId!,
      ...data,
    });

    res.json({
      success: true,
      data: config,
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

    if (message === 'PRIMARY_REGION_NOT_ALLOWED') status = 400;

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * POST /api/v1/compliance/gdpr/export
 * Request GDPR data export
 */
router.post('/gdpr/export', authenticate, requireWorkspace, requirePermissions('COMPLIANCE_REPORT:CREATE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = gdprExportSchema.parse(req.body);

    const exportId = await complianceService.handleGdprExport({
      workspaceId: authReq.workspaceId!,
      userId: data.userId,
      requestedBy: authReq.user!.sub,
    });

    res.status(202).json({
      success: true,
      data: { exportId },
      message: 'GDPR export requested',
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

    if (message === 'USER_NOT_FOUND') status = 404;

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * POST /api/v1/compliance/gdpr/deletion
 * Request GDPR data deletion
 */
router.post('/gdpr/deletion', authenticate, requireWorkspace, requireWorkspaceAdmin, requirePermissions('COMPLIANCE_REPORT:MANAGE'), validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = gdprDeletionSchema.parse(req.body);

    await complianceService.handleGdprDeletion({
      workspaceId: authReq.workspaceId!,
      userId: data.userId,
      requestedBy: authReq.user!.sub,
    });

    res.json({
      success: true,
      message: 'GDPR deletion completed',
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

    if (message === 'USER_NOT_FOUND') status = 404;

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

export default router;