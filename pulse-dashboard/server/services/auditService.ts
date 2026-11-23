import { prisma } from '../db/prisma';
import { AuditEventType, AuditSeverity, ResourceType, Prisma } from '@prisma/client';
import { GeoLocation } from '@shared/types';
import { config } from '../config';
import { generateCorrelationId } from '../utils/crypto';

export interface AuditLogInput {
  workspaceId: string;
  userId?: string;
  performedBy?: string;
  eventType: AuditEventType;
  severity?: AuditSeverity;
  resourceType?: ResourceType;
  resourceId?: string;
  action?: string;
  description: string;
  ipAddress?: string;
  userAgent?: string;
  location?: GeoLocation;
  metadata?: Record<string, unknown>;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  correlationId?: string;
  sessionId?: string;
  requestId?: string;
}

export interface AuditLogFilters {
  workspaceId: string;
  userId?: string;
  eventType?: AuditEventType | AuditEventType[];
  severity?: AuditSeverity | AuditSeverity[];
  resourceType?: ResourceType;
  resourceId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  ipAddress?: string;
  correlationId?: string;
  sessionId?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'severity';
  sortOrder?: 'asc' | 'desc';
}

export interface AuditLogExportOptions {
  workspaceId: string;
  requestedBy: string;
  format: 'JSON' | 'CSV' | 'CEF' | 'LEEF';
  filters: AuditLogFilters;
  dateFrom: Date;
  dateTo: Date;
}

class AuditService {
  private batchBuffer: AuditLogInput[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 100;
  private readonly BATCH_INTERVAL_MS = 5000;

  /**
   * Log an audit event (batched for performance)
   */
  async log(input: AuditLogInput): Promise<void> {
    const correlationId = input.correlationId || generateCorrelationId();

    const logEntry: AuditLogInput = {
      ...input,
      correlationId,
      severity: input.severity || this.getDefaultSeverity(input.eventType),
      metadata: input.metadata || {},
    };

    // Add to batch buffer
    this.batchBuffer.push(logEntry);

    // Flush if batch size reached
    if (this.batchBuffer.length >= this.BATCH_SIZE) {
      await this.flushBatch();
    } else if (!this.batchTimer) {
      // Schedule flush
      this.batchTimer = setTimeout(() => this.flushBatch(), this.BATCH_INTERVAL_MS);
    }
  }

  /**
   * Immediately log an audit event (bypass batching)
   */
  async logImmediate(input: AuditLogInput): Promise<void> {
    const correlationId = input.correlationId || generateCorrelationId();

    await prisma.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        performedBy: input.performedBy,
        eventType: input.eventType,
        severity: input.severity || this.getDefaultSeverity(input.eventType),
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        action: input.action,
        description: input.description,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        location: input.location as Prisma.InputJsonValue | undefined,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        beforeState: input.beforeState as Prisma.InputJsonValue | undefined,
        afterState: input.afterState as Prisma.InputJsonValue | undefined,
        correlationId,
        sessionId: input.sessionId,
        requestId: input.requestId,
      },
    });
  }

  /**
   * Flush batched audit logs
   */
  private async flushBatch(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.batchBuffer.length === 0) return;

    const batch = this.batchBuffer.splice(0, this.BATCH_SIZE);

    try {
      await prisma.auditLog.createMany({
        data: batch.map(entry => ({
          workspaceId: entry.workspaceId,
          userId: entry.userId,
          performedBy: entry.performedBy,
          eventType: entry.eventType,
          severity: entry.severity,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          action: entry.action,
          description: entry.description,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          location: entry.location as Prisma.InputJsonValue | undefined,
          metadata: entry.metadata as Prisma.InputJsonValue | undefined,
          beforeState: entry.beforeState as Prisma.InputJsonValue | undefined,
          afterState: entry.afterState as Prisma.InputJsonValue | undefined,
          correlationId: entry.correlationId,
          sessionId: entry.sessionId,
          requestId: entry.requestId,
        })),
        skipDuplicates: false,
      });
    } catch (error) {
      console.error('Failed to flush audit logs:', error);
      // Re-add to buffer for retry
      this.batchBuffer.unshift(...batch);
    }
  }

  /**
   * Query audit logs with filters
   */
  async query(filters: AuditLogFilters): Promise<{
    logs: any[];
    total: number;
    hasMore: boolean;
  }> {
    const {
      workspaceId,
      userId,
      eventType,
      severity,
      resourceType,
      resourceId,
      dateFrom,
      dateTo,
      ipAddress,
      correlationId,
      sessionId,
      limit = 100,
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = filters;

    const where: Prisma.AuditLogWhereInput = {
      workspaceId,
      deletedAt: null,
    };

    if (userId) where.userId = userId;
    if (eventType) where.eventType = Array.isArray(eventType) ? { in: eventType } : eventType;
    if (severity) where.severity = Array.isArray(severity) ? { in: severity } : severity;
    if (resourceType) where.resourceType = resourceType;
    if (resourceId) where.resourceId = resourceId;
    if (ipAddress) where.ipAddress = ipAddress;
    if (correlationId) where.correlationId = correlationId;
    if (sessionId) where.sessionId = sessionId;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        take: limit + 1,
        skip: offset,
        include: {
          user: { select: { id: true, email: true, name: true } },
          performer: { select: { id: true, email: true, name: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs: logs.slice(0, limit),
      total,
      hasMore: logs.length > limit,
    };
  }

  /**
   * Get audit log by ID
   */
  async getById(id: string, workspaceId: string): Promise<any> {
    return prisma.auditLog.findFirst({
      where: { id, workspaceId },
      include: {
        user: { select: { id: true, email: true, name: true } },
        performer: { select: { id: true, email: true, name: true } },
      },
    });
  }

  /**
   * Export audit logs
   */
  async export(options: AuditLogExportOptions): Promise<string> {
    const exportRecord = await prisma.auditLogExport.create({
      data: {
        workspaceId: options.workspaceId,
        requestedBy: options.requestedBy,
        format: options.format,
        filters: options.filters as Prisma.InputJsonValue,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        status: 'PROCESSING',
      },
    });

    // Process export asynchronously
    this.processExport(exportRecord.id, options).catch(err => {
      console.error('Export failed:', err);
      prisma.auditLogExport.update({
        where: { id: exportRecord.id },
        data: { status: 'FAILED', error: err.message },
      });
    });

    return exportRecord.id;
  }

  /**
   * Process export job
   */
  private async processExport(exportId: string, options: AuditLogExportOptions): Promise<void> {
    const { logs, total } = await this.query({
      ...options.filters,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      limit: 10000, // Large limit for export
    });

    let content: string;
    let mimeType: string;

    switch (options.format) {
      case 'CSV':
        content = this.toCsv(logs);
        mimeType = 'text/csv';
        break;
      case 'CEF':
        content = this.toCef(logs);
        mimeType = 'text/plain';
        break;
      case 'LEEF':
        content = this.toLeef(logs);
        mimeType = 'text/plain';
        break;
      case 'JSON':
      default:
        content = JSON.stringify(logs, null, 2);
        mimeType = 'application/json';
        break;
    }

    // In production, upload to S3/storage and save URL
    // For now, store as base64 in DB (not recommended for large exports)
    const fileUrl = `data:${mimeType};base64,${Buffer.from(content).toString('base64')}`;

    await prisma.auditLogExport.update({
      where: { id: exportId },
      data: {
        status: 'COMPLETED',
        fileUrl,
        fileSize: Buffer.byteLength(content),
        recordCount: total,
        completedAt: new Date(),
      },
    });
  }

  /**
   * Convert logs to CSV
   */
  private toCsv(logs: any[]): string {
    const headers = [
      'id', 'createdAt', 'eventType', 'severity', 'resourceType', 'resourceId',
      'action', 'description', 'userId', 'userEmail', 'performedBy', 'performedByEmail',
      'ipAddress', 'userAgent', 'country', 'city', 'correlationId', 'sessionId', 'requestId',
    ];

    const rows = logs.map(log => [
      log.id,
      log.createdAt.toISOString(),
      log.eventType,
      log.severity,
      log.resourceType || '',
      log.resourceId || '',
      log.action || '',
      log.description.replace(/"/g, '""'),
      log.userId || '',
      log.user?.email || '',
      log.performedBy || '',
      log.performer?.email || '',
      log.ipAddress || '',
      (log.userAgent || '').replace(/"/g, '""'),
      log.location?.country || '',
      log.location?.city || '',
      log.correlationId || '',
      log.sessionId || '',
      log.requestId || '',
    ]);

    return [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
  }

  /**
   * Convert logs to CEF (Common Event Format)
   */
  private toCef(logs: any[]): string {
    return logs.map(log => {
      const extensions = [
        `msg=${log.description}`,
        `eventType=${log.eventType}`,
        `severity=${log.severity}`,
        `resourceType=${log.resourceType || ''}`,
        `resourceId=${log.resourceId || ''}`,
        `userId=${log.userId || ''}`,
        `userEmail=${log.user?.email || ''}`,
        `src=${log.ipAddress || ''}`,
        `cs1=${log.userAgent || ''}`,
        `cs2=${log.correlationId || ''}`,
        `cs3=${log.sessionId || ''}`,
        `cs4=${log.requestId || ''}`,
      ].join(' ');

      return `CEF:0|Pulse|Audit|1.0|${log.eventType}|${log.description}|${this.severityToCef(log.severity)}|${extensions}`;
    }).join('\n');
  }

  /**
   * Convert logs to LEEF (Log Event Extended Format)
   */
  private toLeef(logs: any[]): string {
    return logs.map(log => {
      const extensions = [
        `id=${log.id}`,
        `eventType=${log.eventType}`,
        `severity=${log.severity}`,
        `resourceType=${log.resourceType || ''}`,
        `resourceId=${log.resourceId || ''}`,
        `userId=${log.userId || ''}`,
        `userEmail=${log.user?.email || ''}`,
        `src=${log.ipAddress || ''}`,
        `userAgent=${log.userAgent || ''}`,
        `correlationId=${log.correlationId || ''}`,
        `sessionId=${log.sessionId || ''}`,
        `requestId=${log.requestId || ''}`,
        `devTime=${log.createdAt.toISOString()}`,
      ].join('\t');

      return `LEEF:2.0|Pulse|Audit|1.0|${log.eventType}\t${extensions}`;
    }).join('\n');
  }

  /**
   * Map severity to CEF severity
   */
  private severityToCef(severity: AuditSeverity): number {
    const map: Record<AuditSeverity, number> = {
      INFO: 1,
      LOW: 3,
      MEDIUM: 5,
      HIGH: 7,
      CRITICAL: 10,
    };
    return map[severity] || 1;
  }

  /**
   * Get default severity for event type
   */
  private getDefaultSeverity(eventType: AuditEventType): AuditSeverity {
    const criticalEvents = [
      AuditEventType.BRUTE_FORCE_DETECTED,
      AuditEventType.SUSPICIOUS_ACTIVITY_DETECTED,
      AuditEventType.CSP_VIOLATION,
      AuditEventType.CSRF_VIOLATION,
      AuditEventType.XSS_ATTEMPT,
      AuditEventType.SECRET_ACCESSED,
      AuditEventType.VAULT_OPERATION,
    ];

    const highEvents = [
      AuditEventType.LOGIN_FAILED,
      AuditEventType.MFA_CHALLENGE_FAILED,
      AuditEventType.SSO_LOGIN_FAILED,
      AuditEventType.ACCOUNT_LOCKED,
      AuditEventType.IP_BLOCKED,
      AuditEventType.GEO_BLOCK_TRIGGERED,
      AuditEventType.SECRET_ROTATED,
      AuditEventType.DATA_EXPORTED,
    ];

    const mediumEvents = [
      AuditEventType.PASSWORD_CHANGED,
      AuditEventType.MFA_ENABLED,
      AuditEventType.MFA_DISABLED,
      AuditEventType.ROLE_ASSIGNED,
      AuditEventType.ROLE_REVOKED,
      AuditEventType.PERMISSION_GRANTED,
      AuditEventType.PERMISSION_REVOKED,
      AuditEventType.WORKSPACE_MEMBER_ADDED,
      AuditEventType.WORKSPACE_MEMBER_REMOVED,
      AuditEventType.WORKSPACE_SETTINGS_CHANGED,
      AuditEventType.WORKSPACE_IP_ALLOWLIST_UPDATED,
      AuditEventType.WORKSPACE_SSO_CONFIGURED,
      AuditEventType.WORKSPACE_SCIM_CONFIGURED,
      AuditEventType.SESSION_REVOKED,
      AuditEventType.DEVICE_REVOKED,
    ];

    if (criticalEvents.includes(eventType)) return AuditSeverity.CRITICAL;
    if (highEvents.includes(eventType)) return AuditSeverity.HIGH;
    if (mediumEvents.includes(eventType)) return AuditSeverity.MEDIUM;
    return AuditSeverity.INFO;
  }

  /**
   * Get audit statistics
   */
  async getStats(workspaceId: string, dateFrom?: Date, dateTo?: Date): Promise<{
    totalEvents: number;
    bySeverity: Record<AuditSeverity, number>;
    byEventType: Record<string, number>;
    topUsers: Array<{ userId: string; email: string; count: number }>;
    topIps: Array<{ ip: string; count: number }>;
  }> {
    const where: Prisma.AuditLogWhereInput = { workspaceId };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }

    const [totalEvents, bySeverity, byEventType, topUsers, topIps] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.groupBy({ by: ['severity'], where, _count: true }),
      prisma.auditLog.groupBy({ by: ['eventType'], where, _count: true, orderBy: { _count: { eventType: 'desc' } }, take: 20 }),
      prisma.auditLog.groupBy({
        by: ['userId'],
        where: { ...where, userId: { not: null } },
        _count: true,
        orderBy: { _count: { userId: 'desc' } },
        take: 10,
      }),
      prisma.auditLog.groupBy({
        by: ['ipAddress'],
        where: { ...where, ipAddress: { not: null } },
        _count: true,
        orderBy: { _count: { ipAddress: 'desc' } },
        take: 10,
      }),
    ]);

    // Get user emails for top users
    const userIds = topUsers.map(u => u.userId!).filter(Boolean);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });

    return {
      totalEvents,
      bySeverity: bySeverity.reduce((acc, s) => ({ ...acc, [s.severity]: s._count }), {} as Record<AuditSeverity, number>),
      byEventType: byEventType.reduce((acc, e) => ({ ...acc, [e.eventType]: e._count }), {}),
      topUsers: topUsers.map(u => ({
        userId: u.userId!,
        email: users.find(usr => usr.id === u.userId)?.email || 'unknown',
        count: u._count,
      })),
      topIps: topIps.map(i => ({ ip: i.ipAddress!, count: i._count })),
    };
  }

  /**
   * Cleanup old audit logs based on retention policy
   */
  async cleanup(workspaceId: string, retentionDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await prisma.auditLog.deleteMany({
      where: {
        workspaceId,
        createdAt: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  /**
   * Flush any pending logs on shutdown
   */
  async shutdown(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    await this.flushBatch();
  }
}

export const auditService = new AuditService();

// Graceful shutdown
process.on('SIGTERM', () => auditService.shutdown());
process.on('SIGINT', () => auditService.shutdown());