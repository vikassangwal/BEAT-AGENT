import { prisma } from '../db/prisma';
import { auditService, AuditEventType } from './auditService';
import { config } from '../config';
import { ComplianceFramework, DataResidencyRegion, ResourceType, Prisma } from '@prisma/client';
import { generateSecureRandom } from '../utils/crypto';

export interface ComplianceReportInput {
  workspaceId: string;
  framework: ComplianceFramework;
  reportType: 'FULL' | 'GAP_ANALYSIS' | 'EVIDENCE_PACKAGE';
  dateFrom: Date;
  dateTo: Date;
  generatedBy: string;
}

export interface RetentionPolicyInput {
  workspaceId: string;
  name: string;
  resourceType: ResourceType;
  conditions: Record<string, unknown>;
  retentionDays: number;
  action: 'DELETE' | 'ARCHIVE' | 'ANONYMIZE';
  createdBy: string;
}

export interface DataResidencyInput {
  workspaceId: string;
  primaryRegion: DataResidencyRegion;
  allowedRegions: DataResidencyRegion[];
  replicationEnabled?: boolean;
  encryptionAtRest?: boolean;
  encryptionInTransit?: boolean;
  keyManagement?: 'MANAGED' | 'CUSTOMER' | 'HSM';
}

export interface GdprExportRequest {
  workspaceId: string;
  userId: string;
  requestedBy: string;
}

export interface GdprDeletionRequest {
  workspaceId: string;
  userId: string;
  requestedBy: string;
}

class ComplianceService {
  /**
   * Generate compliance report
   */
  async generateReport(input: ComplianceReportInput): Promise<string> {
    const { workspaceId, framework, reportType, dateFrom, dateTo, generatedBy } = input;

    const report = await prisma.complianceReport.create({
      data: {
        workspaceId,
        framework,
        reportType,
        status: 'GENERATING',
        generatedBy,
        dateFrom,
        dateTo,
      },
    });

    // Generate report asynchronously
    this.processReport(report.id, input).catch(err => {
      console.error('Report generation failed:', err);
      prisma.complianceReport.update({
        where: { id: report.id },
        data: { status: 'FAILED', error: err.message },
      });
    });

    return report.id;
  }

  /**
   * Process compliance report
   */
  private async processReport(reportId: string, input: ComplianceReportInput): Promise<void> {
    const { workspaceId, framework, reportType, dateFrom, dateTo } = input;

    const findings = await this.runComplianceChecks(workspaceId, framework, dateFrom, dateTo);

    const content = this.formatReport(framework, reportType, findings, dateFrom, dateTo);
    const fileUrl = `data:application/json;base64,${Buffer.from(content).toString('base64')}`;

    await prisma.complianceReport.update({
      where: { id: reportId },
      data: {
        status: 'COMPLETED',
        fileUrl,
        fileSize: Buffer.byteLength(content),
        findings: findings as any,
        completedAt: new Date(),
      },
    });

    await auditService.logImmediate({
      workspaceId,
      userId: input.generatedBy,
      performedBy: input.generatedBy,
      eventType: AuditEventType.COMPLIANCE_REPORT_GENERATED,
      severity: 'INFO',
      resourceType: 'COMPLIANCE_REPORT',
      resourceId: reportId,
      action: 'CREATE',
      description: `Compliance report generated: ${framework} ${reportType}`,
      metadata: { framework, reportType, findingsCount: findings.length },
    });
  }

  /**
   * Run compliance checks for a framework
   */
  private async runComplianceChecks(
    workspaceId: string,
    framework: ComplianceFramework,
    dateFrom: Date,
    dateTo: Date
  ): Promise<any[]> {
    const findings: any[] = [];

    // Get workspace settings
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) return findings;

    // Framework-specific checks
    switch (framework) {
      case ComplianceFramework.SOC2:
        findings.push(...await this.checkSoc2(workspaceId, workspace, dateFrom, dateTo));
        break;
      case ComplianceFramework.GDPR:
        findings.push(...await this.checkGdpr(workspaceId, workspace, dateFrom, dateTo));
        break;
      case ComplianceFramework.HIPAA:
        findings.push(...await this.checkHipaa(workspaceId, workspace, dateFrom, dateTo));
        break;
      case ComplianceFramework.ISO27001:
        findings.push(...await this.checkIso27001(workspaceId, workspace, dateFrom, dateTo));
        break;
    }

    return findings;
  }

  /**
   * SOC 2 Checks
   */
  private async checkSoc2(workspaceId: string, workspace: any, dateFrom: Date, dateTo: Date): Promise<any[]> {
    const findings: any[] = [];

    // CC6.1 - Access Control
    const mfaEnabled = await prisma.user.count({
      where: { memberships: { some: { workspaceId } }, mfaEnabled: true },
    });
    const totalUsers = await prisma.membership.count({ where: { workspaceId, isActive: true } });
    findings.push({
      controlId: 'CC6.1',
      controlTitle: 'Logical Access Security',
      status: mfaEnabled === totalUsers && totalUsers > 0 ? 'PASS' : 'FAIL',
      severity: mfaEnabled === totalUsers ? 'INFO' : 'HIGH',
      description: `${mfaEnabled}/${totalUsers} users have MFA enabled`,
      evidence: [`MFA enabled: ${mfaEnabled}`, `Total users: ${totalUsers}`],
      remediation: mfaEnabled === totalUsers ? null : 'Enable MFA for all users',
    });

    // CC6.7 - Data Transmission
    findings.push({
      controlId: 'CC6.7',
      controlTitle: 'Data Transmission Protection',
      status: workspace.settings?.enforceHttps ? 'PASS' : 'FAIL',
      severity: workspace.settings?.enforceHttps ? 'INFO' : 'HIGH',
      description: 'HTTPS enforcement for data in transit',
      evidence: [`HTTPS enforced: ${workspace.settings?.enforceHttps}`],
      remediation: workspace.settings?.enforceHttps ? null : 'Enable HTTPS enforcement',
    });

    // CC7.2 - System Monitoring
    const auditLogs = await prisma.auditLog.count({
      where: { workspaceId, createdAt: { gte: dateFrom, lte: dateTo } },
    });
    findings.push({
      controlId: 'CC7.2',
      controlTitle: 'System Monitoring',
      status: auditLogs > 0 ? 'PASS' : 'FAIL',
      severity: auditLogs > 0 ? 'INFO' : 'MEDIUM',
      description: `Audit logging active: ${auditLogs} events in period`,
      evidence: [`Audit events: ${auditLogs}`],
      remediation: auditLogs > 0 ? null : 'Enable audit logging',
    });

    // CC8.1 - Change Management
    const ssoConfigured = await prisma.ssoConfig.findUnique({ where: { workspaceId } });
    findings.push({
      controlId: 'CC8.1',
      controlTitle: 'Change Management',
      status: ssoConfigured?.enabled ? 'PASS' : 'NOT_TESTED',
      severity: 'INFO',
      description: 'SSO integration for centralized identity management',
      evidence: [`SSO enabled: ${ssoConfigured?.enabled || false}`],
      remediation: null,
    });

    return findings;
  }

  /**
   * GDPR Checks
   */
  private async checkGdpr(workspaceId: string, workspace: any, dateFrom: Date, dateTo: Date): Promise<any[]> {
    const findings: any[] = [];

    // Article 5 - Data Minimization
    const retentionPolicies = await prisma.retentionPolicy.count({ where: { workspaceId, isActive: true } });
    findings.push({
      controlId: 'ART-5',
      controlTitle: 'Data Minimization & Retention',
      status: retentionPolicies > 0 ? 'PASS' : 'FAIL',
      severity: retentionPolicies > 0 ? 'INFO' : 'HIGH',
      description: `${retentionPolicies} active retention policies configured`,
      evidence: [`Active retention policies: ${retentionPolicies}`],
      remediation: retentionPolicies > 0 ? null : 'Configure data retention policies',
    });

    // Article 17 - Right to Erasure
    const deletionRequests = await prisma.auditLog.count({
      where: { workspaceId, eventType: AuditEventType.GDPR_DELETION_REQUESTED, createdAt: { gte: dateFrom, lte: dateTo } },
    });
    const completedDeletions = await prisma.auditLog.count({
      where: { workspaceId, eventType: AuditEventType.GDPR_DELETION_COMPLETED, createdAt: { gte: dateFrom, lte: dateTo } },
    });
    findings.push({
      controlId: 'ART-17',
      controlTitle: 'Right to Erasure',
      status: deletionRequests === 0 || completedDeletions === deletionRequests ? 'PASS' : 'FAIL',
      severity: deletionRequests === 0 || completedDeletions === deletionRequests ? 'INFO' : 'HIGH',
      description: `${completedDeletions}/${deletionRequests} deletion requests completed`,
      evidence: [`Requested: ${deletionRequests}`, `Completed: ${completedDeletions}`],
      remediation: completedDeletions === deletionRequests ? null : 'Process pending deletion requests',
    });

    // Article 20 - Data Portability
    const exportRequests = await prisma.auditLog.count({
      where: { workspaceId, eventType: AuditEventType.GDPR_EXPORT_REQUESTED, createdAt: { gte: dateFrom, lte: dateTo } },
    });
    const completedExports = await prisma.auditLog.count({
      where: { workspaceId, eventType: AuditEventType.GDPR_EXPORT_COMPLETED, createdAt: { gte: dateFrom, lte: dateTo } },
    });
    findings.push({
      controlId: 'ART-20',
      controlTitle: 'Data Portability',
      status: exportRequests === 0 || completedExports === exportRequests ? 'PASS' : 'FAIL',
      severity: exportRequests === 0 || completedExports === exportRequests ? 'INFO' : 'MEDIUM',
      description: `${completedExports}/${exportRequests} export requests completed`,
      evidence: [`Requested: ${exportRequests}`, `Completed: ${completedExports}`],
      remediation: completedExports === exportRequests ? null : 'Process pending export requests',
    });

    // Article 32 - Security of Processing
    const encryptionAtRest = workspace.settings?.encryptionAtRest;
    findings.push({
      controlId: 'ART-32',
      controlTitle: 'Security of Processing',
      status: encryptionAtRest ? 'PASS' : 'FAIL',
      severity: encryptionAtRest ? 'INFO' : 'HIGH',
      description: 'Encryption at rest for personal data',
      evidence: [`Encryption at rest: ${encryptionAtRest}`],
      remediation: encryptionAtRest ? null : 'Enable encryption at rest',
    });

    return findings;
  }

  /**
   * HIPAA Checks
   */
  private async checkHipaa(workspaceId: string, workspace: any, dateFrom: Date, dateTo: Date): Promise<any[]> {
    const findings: any[] = [];

    // 164.308 - Administrative Safeguards
    const adminUsers = await prisma.membership.count({
      where: { workspaceId, role: { in: ['OWNER', 'ADMIN'] }, isActive: true },
    });
    findings.push({
      controlId: '164.308',
      controlTitle: 'Administrative Safeguards',
      status: adminUsers > 0 && adminUsers <= 5 ? 'PASS' : adminUsers > 5 ? 'FAIL' : 'FAIL',
      severity: adminUsers > 0 && adminUsers <= 5 ? 'INFO' : 'HIGH',
      description: `${adminUsers} admin users (recommended: 1-5)`,
      evidence: [`Admin users: ${adminUsers}`],
      remediation: adminUsers > 0 && adminUsers <= 5 ? null : 'Review admin user assignments',
    });

    // 164.312 - Technical Safeguards
    const auditLogs = await prisma.auditLog.count({
      where: { workspaceId, createdAt: { gte: dateFrom, lte: dateTo } },
    });
    findings.push({
      controlId: '164.312',
      controlTitle: 'Technical Safeguards - Audit Controls',
      status: auditLogs > 0 ? 'PASS' : 'FAIL',
      severity: auditLogs > 0 ? 'INFO' : 'HIGH',
      description: `Audit logging: ${auditLogs} events`,
      evidence: [`Audit events: ${auditLogs}`],
      remediation: auditLogs > 0 ? null : 'Enable comprehensive audit logging',
    });

    // 164.314 - Organizational Requirements
    const ssoConfigured = await prisma.ssoConfig.findUnique({ where: { workspaceId } });
    findings.push({
      controlId: '164.314',
      controlTitle: 'Organizational Requirements',
      status: ssoConfigured?.enabled ? 'PASS' : 'NOT_APPLICABLE',
      severity: 'INFO',
      description: 'Business associate agreements via SSO integration',
      evidence: [`SSO enabled: ${ssoConfigured?.enabled || false}`],
      remediation: null,
    });

    return findings;
  }

  /**
   * ISO 27001 Checks
   */
  private async checkIso27001(workspaceId: string, workspace: any, dateFrom: Date, dateTo: Date): Promise<any[]> {
    const findings: any[] = [];

    // A.9 - Access Control
    const ipAllowlist = await prisma.ipAllowlist.count({ where: { workspaceId, enabled: true } });
    findings.push({
      controlId: 'A.9.4',
      controlTitle: 'Use of Privileged Utility Programs',
      status: ipAllowlist > 0 ? 'PASS' : 'NOT_APPLICABLE',
      severity: 'INFO',
      description: `${ipAllowlist} IP allowlist entries configured`,
      evidence: [`IP allowlist entries: ${ipAllowlist}`],
      remediation: null,
    });

    // A.12 - Operations Security
    const automations = await prisma.automation.count({ where: { workspaceId, isActive: true } });
    findings.push({
      controlId: 'A.12.1',
      controlTitle: 'Operational Procedures',
      status: automations > 0 ? 'PASS' : 'NOT_TESTED',
      severity: 'INFO',
      description: `${automations} active automations for operational procedures`,
      evidence: [`Active automations: ${automations}`],
      remediation: null,
    });

    // A.18 - Compliance
    const complianceReports = await prisma.complianceReport.count({ where: { workspaceId } });
    findings.push({
      controlId: 'A.18.1',
      controlTitle: 'Compliance with Legal Requirements',
      status: complianceReports > 0 ? 'PASS' : 'NOT_TESTED',
      severity: 'INFO',
      description: `${complianceReports} compliance reports generated`,
      evidence: [`Compliance reports: ${complianceReports}`],
      remediation: null,
    });

    return findings;
  }

  /**
   * Format report content
   */
  private formatReport(
    framework: ComplianceFramework,
    reportType: string,
    findings: any[],
    dateFrom: Date,
    dateTo: Date
  ): string {
    const passed = findings.filter(f => f.status === 'PASS').length;
    const failed = findings.filter(f => f.status === 'FAIL').length;
    const notTested = findings.filter(f => f.status === 'NOT_TESTED').length;
    const notApplicable = findings.filter(f => f.status === 'NOT_APPLICABLE').length;

    return JSON.stringify({
      framework,
      reportType,
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      generatedAt: new Date().toISOString(),
      summary: { total: findings.length, passed, failed, notTested, notApplicable },
      findings,
    }, null, 2);
  }

  /**
   * Create retention policy
   */
  async createRetentionPolicy(input: RetentionPolicyInput): Promise<any> {
    const { workspaceId, name, resourceType, conditions, retentionDays, action, createdBy } = input;

    const policy = await prisma.retentionPolicy.create({
      data: {
        workspaceId,
        name,
        resourceType,
        conditions: conditions as Prisma.InputJsonValue,
        retentionDays,
        action,
        createdBy,
        nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Run tomorrow
      },
    });

    await auditService.logImmediate({
      workspaceId,
      userId: createdBy,
      performedBy: createdBy,
      eventType: AuditEventType.RETENTION_POLICY_APPLIED,
      severity: 'INFO',
      resourceType: 'RETENTION_POLICY',
      resourceId: policy.id,
      action: 'CREATE',
      description: `Retention policy created: ${name}`,
      metadata: { resourceType, retentionDays, action },
    });

    return policy;
  }

  /**
   * Run retention policies
   */
  async runRetentionPolicies(): Promise<number> {
    const now = new Date();
    const policies = await prisma.retentionPolicy.findMany({
      where: { isActive: true, nextRunAt: { lte: now } },
    });

    let processed = 0;
    for (const policy of policies) {
      try {
        await this.applyRetentionPolicy(policy);
        await prisma.retentionPolicy.update({
          where: { id: policy.id },
          data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
        });
        processed++;
      } catch (error) {
        console.error(`Failed to apply retention policy ${policy.id}:`, error);
      }
    }

    return processed;
  }

  /**
   * Apply a single retention policy
   */
  private async applyRetentionPolicy(policy: any): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

    // Build query based on resource type
    let model: any;
    switch (policy.resourceType) {
      case ResourceType.AUDIT_LOG:
        model = prisma.auditLog;
        break;
      case ResourceType.SESSION:
        model = prisma.session;
        break;
      case ResourceType.WEBHOOK_DELIVERY:
        model = prisma.webhookDelivery;
        break;
      case ResourceType.AUTOMATION_RUN:
        model = prisma.automationRun;
        break;
      default:
        return; // Skip unsupported types
    }

    const where: any = {
      workspaceId: policy.workspaceId,
      createdAt: { lt: cutoffDate },
      ...policy.conditions,
    };

    if (policy.action === 'DELETE') {
      await model.deleteMany({ where });
    } else if (policy.action === 'ARCHIVE') {
      // Soft delete or move to archive
      await model.updateMany({ where, data: { deletedAt: new Date() } });
    } else if (policy.action === 'ANONYMIZE') {
      // Anonymize sensitive fields
      await model.updateMany({
        where,
        data: {
          // Anonymization logic depends on model
        },
      });
    }
  }

  /**
   * Configure data residency
   */
  async configureDataResidency(input: DataResidencyInput): Promise<any> {
    const { workspaceId, primaryRegion, allowedRegions, replicationEnabled, encryptionAtRest, encryptionInTransit, keyManagement } = input;

    // Validate primary region is in allowed regions
    if (!allowedRegions.includes(primaryRegion)) {
      throw new Error('PRIMARY_REGION_NOT_ALLOWED');
    }

    const config = await prisma.dataResidencyConfig.upsert({
      where: { workspaceId },
      update: {
        primaryRegion,
        allowedRegions,
        replicationEnabled: replicationEnabled || false,
        encryptionAtRest: encryptionAtRest !== false,
        encryptionInTransit: encryptionInTransit !== false,
        keyManagement: keyManagement || 'MANAGED',
      },
      create: {
        workspaceId,
        primaryRegion,
        allowedRegions,
        replicationEnabled: replicationEnabled || false,
        encryptionAtRest: encryptionAtRest !== false,
        encryptionInTransit: encryptionInTransit !== false,
        keyManagement: keyManagement || 'MANAGED',
      },
    });

    return config;
  }

  /**
   * Get data residency config
   */
  async getDataResidencyConfig(workspaceId: string): Promise<any> {
    return prisma.dataResidencyConfig.findUnique({ where: { workspaceId } });
  }

  /**
   * Handle GDPR export request
   */
  async handleGdprExport(request: GdprExportRequest): Promise<string> {
    const { workspaceId, userId, requestedBy } = request;

    // Collect all user data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { include: { workspace: true } },
        sessions: true,
        devices: true,
        auditLogs: true,
        apiKeys: true,
      },
    });

    if (!user) throw new Error('USER_NOT_FOUND');

    // Create export
    const exportId = await auditService.export({
      workspaceId,
      requestedBy,
      format: 'JSON',
      filters: { userId },
      dateFrom: new Date(0),
      dateTo: new Date(),
    });

    await auditService.logImmediate({
      workspaceId,
      userId,
      performedBy: requestedBy,
      eventType: AuditEventType.GDPR_EXPORT_REQUESTED,
      severity: 'INFO',
      resourceType: 'USER',
      resourceId: userId,
      action: 'EXPORT',
      description: 'GDPR data export requested',
    });

    return exportId;
  }

  /**
   * Handle GDPR deletion request
   */
  async handleGdprDeletion(request: GdprDeletionRequest): Promise<void> {
    const { workspaceId, userId, requestedBy } = request;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('USER_NOT_FOUND');

    // Soft delete user and related data
    await prisma.user.update({
      where: { id: userId },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
        email: `deleted_${userId}@deleted.local`,
        name: 'Deleted User',
      },
    });

    // Delete sessions
    await prisma.session.updateMany({
      where: { userId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedBy: requestedBy, revokedReason: 'GDPR deletion' },
    });

    // Delete devices
    await prisma.device.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    });

    // Delete API keys
    await prisma.apiKey.updateMany({
      where: { userId },
      data: { isActive: false, revokedAt: new Date(), revokedBy: requestedBy },
    });

    await auditService.logImmediate({
      workspaceId,
      userId,
      performedBy: requestedBy,
      eventType: AuditEventType.GDPR_DELETION_COMPLETED,
      severity: 'INFO',
      resourceType: 'USER',
      resourceId: userId,
      action: 'DELETE',
      description: 'GDPR deletion completed',
    });
  }
}

export const complianceService = new ComplianceService();