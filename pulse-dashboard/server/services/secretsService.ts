import { prisma } from '../db/prisma';
import { cacheRedis } from '../db/redis';
import { auditService, AuditEventType } from './auditService';
import { config } from '../config';
import { encrypt, decrypt, generateSecureRandom, hashToken } from '../utils/crypto';
import { SecretType, SecretRotationStatus } from '@prisma/client';

export interface CreateSecretInput {
  workspaceId: string;
  name: string;
  type: SecretType;
  value: string;
  description?: string;
  tags?: string[];
  rotationEnabled?: boolean;
  rotationIntervalDays?: number;
  expiresAt?: Date;
  createdBy: string;
}

export interface UpdateSecretInput {
  value?: string;
  description?: string;
  tags?: string[];
  rotationEnabled?: boolean;
  rotationIntervalDays?: number;
  expiresAt?: Date | null;
}

export interface SecretData {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  value: string; // Decrypted
  version: number;
  description: string | null;
  tags: string[];
  rotationEnabled: boolean;
  rotationIntervalDays: number | null;
  lastRotatedAt: Date | null;
  nextRotationAt: Date | null;
  rotationStatus: SecretRotationStatus;
  accessCount: number;
  lastAccessedAt: Date | null;
  lastAccessedBy: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SecretVersionData {
  id: string;
  secretId: string;
  version: number;
  value: string; // Decrypted
  createdBy: string;
  createdAt: Date;
  description: string | null;
}

class SecretsService {
  private readonly CACHE_TTL = 60; // 1 minute for secret values
  private readonly MAX_VERSIONS = 10;

  /**
   * Create a new secret
   */
  async createSecret(input: CreateSecretInput): Promise<SecretData> {
    const { workspaceId, name, type, value, description, tags, rotationEnabled, rotationIntervalDays, expiresAt, createdBy } = input;

    // Check if secret exists
    const existing = await prisma.secret.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
    });
    if (existing) throw new Error('SECRET_EXISTS');

    // Encrypt value
    const encryptedValue = encrypt(value);

    // Calculate next rotation
    const nextRotationAt = rotationEnabled && rotationIntervalDays
      ? new Date(Date.now() + rotationIntervalDays * 24 * 60 * 60 * 1000)
      : null;

    const secret = await prisma.secret.create({
      data: {
        workspaceId,
        name,
        type,
        value: encryptedValue,
        version: 1,
        description,
        tags: tags || [],
        rotationEnabled: rotationEnabled || false,
        rotationInterval: rotationIntervalDays,
        nextRotationAt,
        rotationStatus: SecretRotationStatus.PENDING,
        createdBy,
      },
    });

    // Create initial version
    await prisma.secretVersion.create({
      data: {
        secretId: secret.id,
        version: 1,
        value: encryptedValue,
        createdBy,
        description: 'Initial version',
      },
    });

    await auditService.logImmediate({
      workspaceId,
      userId: createdBy,
      performedBy: createdBy,
      eventType: AuditEventType.SECRET_CREATED,
      severity: 'INFO',
      resourceType: 'SECRET',
      resourceId: secret.id,
      action: 'CREATE',
      description: `Secret created: ${name}`,
      metadata: { type, rotationEnabled },
    });

    return this.formatSecret(secret, value);
  }

  /**
   * Get secret by name (with decryption)
   */
  async getSecret(workspaceId: string, name: string, accessedBy: string, ipAddress?: string): Promise<SecretData | null> {
    const cacheKey = `secret:${workspaceId}:${name}`;
    let cached = await cacheRedis.get<SecretData>(cacheKey);

    if (!cached) {
      const secret = await prisma.secret.findUnique({
        where: { workspaceId_name: { workspaceId, name } },
      });

      if (!secret || secret.deletedAt) return null;

      const decryptedValue = decrypt(secret.value);
      cached = this.formatSecret(secret, decryptedValue);
      await cacheRedis.set(cacheKey, cached, this.CACHE_TTL);
    }

    // Log access
    await this.logAccess(cached.id, workspaceId, accessedBy, 'READ', ipAddress);

    // Update access count
    await prisma.secret.update({
      where: { id: cached.id },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
        lastAccessedBy: accessedBy,
      },
    });

    return cached;
  }

  /**
   * Get secret by ID (with decryption)
   */
  async getSecretById(secretId: string, accessedBy: string, ipAddress?: string): Promise<SecretData | null> {
    const secret = await prisma.secret.findUnique({ where: { id: secretId } });
    if (!secret || secret.deletedAt) return null;

    const decryptedValue = decrypt(secret.value);
    const formatted = this.formatSecret(secret, decryptedValue);

    await this.logAccess(secretId, secret.workspaceId, accessedBy, 'READ', ipAddress);

    await prisma.secret.update({
      where: { id: secretId },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
        lastAccessedBy: accessedBy,
      },
    });

    return formatted;
  }

  /**
   * List secrets (without values)
   */
  async listSecrets(workspaceId: string, filters?: { type?: SecretType; tag?: string }): Promise<Omit<SecretData, 'value'>[]> {
    const where: any = { workspaceId, deletedAt: null };
    if (filters?.type) where.type = filters.type;
    if (filters?.tag) where.tags = { has: filters.tag };

    const secrets = await prisma.secret.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        type: true,
        version: true,
        description: true,
        tags: true,
        rotationEnabled: true,
        rotationInterval: true,
        lastRotatedAt: true,
        nextRotationAt: true,
        rotationStatus: true,
        accessCount: true,
        lastAccessedAt: true,
        lastAccessedBy: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return secrets.map(s => ({
      ...s,
      rotationIntervalDays: s.rotationInterval,
    })) as Omit<SecretData, 'value'>[];
  }

  /**
   * Update secret
   */
  async updateSecret(secretId: string, workspaceId: string, input: UpdateSecretInput, updatedBy: string): Promise<SecretData> {
    const secret = await prisma.secret.findUnique({ where: { id: secretId, workspaceId } });
    if (!secret || secret.deletedAt) throw new Error('SECRET_NOT_FOUND');

    const updateData: any = { updatedAt: new Date() };
    let newValue = secret.value;
    let rotationTriggered = false;

    if (input.value !== undefined && input.value !== secret.value) {
      newValue = encrypt(input.value);
      updateData.value = newValue;
      updateData.version = { increment: 1 };
      updateData.lastRotatedAt = new Date();
      updateData.rotationStatus = SecretRotationStatus.COMPLETED;

      if (secret.rotationEnabled && secret.rotationInterval) {
        updateData.nextRotationAt = new Date(Date.now() + secret.rotationInterval * 24 * 60 * 60 * 1000);
        updateData.rotationStatus = SecretRotationStatus.PENDING;
      }

      rotationTriggered = true;
    }

    if (input.description !== undefined) updateData.description = input.description;
    if (input.tags !== undefined) updateData.tags = input.tags;
    if (input.rotationEnabled !== undefined) updateData.rotationEnabled = input.rotationEnabled;
    if (input.rotationIntervalDays !== undefined) {
      updateData.rotationInterval = input.rotationIntervalDays;
      if (input.rotationEnabled && input.rotationIntervalDays) {
        updateData.nextRotationAt = new Date(Date.now() + input.rotationIntervalDays * 24 * 60 * 60 * 1000);
      }
    }
    if (input.expiresAt !== undefined) updateData.expiresAt = input.expiresAt;

    const updated = await prisma.secret.update({
      where: { id: secretId },
      data: updateData,
    });

    // Create new version if value changed
    if (rotationTriggered) {
      await prisma.secretVersion.create({
        data: {
          secretId,
          version: updated.version,
          value: newValue,
          createdBy: updatedBy,
          description: 'Rotation',
        },
      });

      // Cleanup old versions
      await this.cleanupOldVersions(secretId);
    }

    // Invalidate cache
    await cacheRedis.delete(`secret:${workspaceId}:${secret.name}`);

    await auditService.logImmediate({
      workspaceId,
      userId: updatedBy,
      performedBy: updatedBy,
      eventType: rotationTriggered ? AuditEventType.SECRET_ROTATED : AuditEventType.SECRET_ACCESSED,
      severity: 'INFO',
      resourceType: 'SECRET',
      resourceId: secretId,
      action: rotationTriggered ? 'ROTATE' : 'UPDATE',
      description: `Secret ${rotationTriggered ? 'rotated' : 'updated'}: ${secret.name}`,
    });

    const decryptedValue = decrypt(updated.value);
    return this.formatSecret(updated, decryptedValue);
  }

  /**
   * Delete secret
   */
  async deleteSecret(secretId: string, workspaceId: string, deletedBy: string): Promise<void> {
    const secret = await prisma.secret.findUnique({ where: { id: secretId, workspaceId } });
    if (!secret) throw new Error('SECRET_NOT_FOUND');

    await prisma.secret.update({
      where: { id: secretId },
      data: { deletedAt: new Date() },
    });

    await cacheRedis.delete(`secret:${workspaceId}:${secret.name}`);

    await auditService.logImmediate({
      workspaceId,
      userId: deletedBy,
      performedBy: deletedBy,
      eventType: AuditEventType.SECRET_DELETED,
      severity: 'INFO',
      resourceType: 'SECRET',
      resourceId: secretId,
      action: 'DELETE',
      description: `Secret deleted: ${secret.name}`,
    });
  }

  /**
   * Get secret versions
   */
  async getVersions(secretId: string, workspaceId: string): Promise<SecretVersionData[]> {
    const secret = await prisma.secret.findUnique({ where: { id: secretId, workspaceId } });
    if (!secret) throw new Error('SECRET_NOT_FOUND');

    const versions = await prisma.secretVersion.findMany({
      where: { secretId },
      orderBy: { version: 'desc' },
      take: this.MAX_VERSIONS,
    });

    return versions.map(v => ({
      ...v,
      value: decrypt(v.value),
    }));
  }

  /**
   * Rotate secret (generate new value)
   */
  async rotateSecret(secretId: string, workspaceId: string, rotatedBy: string, newValue?: string): Promise<SecretData> {
    const secret = await prisma.secret.findUnique({ where: { id: secretId, workspaceId } });
    if (!secret || secret.deletedAt) throw new Error('SECRET_NOT_FOUND');

    // Update rotation status
    await prisma.secret.update({
      where: { id: secretId },
      data: { rotationStatus: SecretRotationStatus.IN_PROGRESS },
    });

    try {
      const generatedValue = newValue || this.generateSecretValue(secret.type);
      const result = await this.updateSecret(secretId, workspaceId, { value: generatedValue }, rotatedBy);

      await auditService.logImmediate({
        workspaceId,
        userId: rotatedBy,
        performedBy: rotatedBy,
        eventType: AuditEventType.SECRET_ROTATED,
        severity: 'INFO',
        resourceType: 'SECRET',
        resourceId: secretId,
        action: 'ROTATE',
        description: `Secret manually rotated: ${secret.name}`,
      });

      return result;
    } catch (error) {
      await prisma.secret.update({
        where: { id: secretId },
        data: { rotationStatus: SecretRotationStatus.FAILED, rotationError: (error as Error).message },
      });
      throw error;
    }
  }

  /**
   * Check and run scheduled rotations
   */
  async runScheduledRotations(): Promise<number> {
    const now = new Date();
    const secrets = await prisma.secret.findMany({
      where: {
        rotationEnabled: true,
        rotationStatus: SecretRotationStatus.PENDING,
        nextRotationAt: { lte: now },
        deletedAt: null,
      },
    });

    let rotated = 0;
    for (const secret of secrets) {
      try {
        await this.rotateSecret(secret.id, secret.workspaceId, 'system');
        rotated++;
      } catch (error) {
        console.error(`Failed to rotate secret ${secret.id}:`, error);
      }
    }

    return rotated;
  }

  /**
   * Get secret access logs
   */
  async getAccessLogs(secretId: string, workspaceId: string, limit = 100): Promise<any[]> {
    return prisma.secretAccessLog.findMany({
      where: { secretId, workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { id: true, email: true, name: true } } },
    });
  }

  /**
   * Log secret access
   */
  private async logAccess(secretId: string, workspaceId: string, userId: string, action: string, ipAddress?: string): Promise<void> {
    await prisma.secretAccessLog.create({
      data: {
        secretId,
        userId,
        workspaceId,
        action,
        ipAddress,
        success: true,
      },
    });
  }

  /**
   * Cleanup old versions
   */
  private async cleanupOldVersions(secretId: string): Promise<void> {
    const versions = await prisma.secretVersion.findMany({
      where: { secretId },
      orderBy: { version: 'desc' },
      skip: this.MAX_VERSIONS,
      select: { id: true },
    });

    if (versions.length > 0) {
      await prisma.secretVersion.deleteMany({
        where: { id: { in: versions.map(v => v.id) } },
      });
    }
  }

  /**
   * Generate secret value based on type
   */
  private generateSecretValue(type: SecretType): string {
    switch (type) {
      case SecretType.API_KEY:
        return `sk_${generateSecureRandom(32)}`;
      case SecretType.DATABASE_URL:
        return `postgresql://user:${generateSecureRandom(16)}@host:5432/db`;
      case SecretType.ENCRYPTION_KEY:
        return generateSecureRandom(32);
      case SecretType.JWT_SECRET:
        return generateSecureRandom(64);
      case SecretType.WEBHOOK_SECRET:
        return `whsec_${generateSecureRandom(32)}`;
      case SecretType.OAUTH_SECRET:
        return generateSecureRandom(32);
      case SecretType.SAML_CERTIFICATE:
        // Would generate actual cert in production
        return `-----BEGIN CERTIFICATE-----\n${generateSecureRandom(100)}\n-----END CERTIFICATE-----`;
      default:
        return generateSecureRandom(32);
    }
  }

  /**
   * Format secret for API response
   */
  private formatSecret(secret: any, decryptedValue: string): SecretData {
    return {
      id: secret.id,
      workspaceId: secret.workspaceId,
      name: secret.name,
      type: secret.type,
      value: decryptedValue,
      version: secret.version,
      description: secret.description,
      tags: secret.tags,
      rotationEnabled: secret.rotationEnabled,
      rotationIntervalDays: secret.rotationInterval,
      lastRotatedAt: secret.lastRotatedAt,
      nextRotationAt: secret.nextRotationAt,
      rotationStatus: secret.rotationStatus,
      accessCount: secret.accessCount,
      lastAccessedAt: secret.lastAccessedAt,
      lastAccessedBy: secret.lastAccessedBy,
      expiresAt: secret.expiresAt,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
    };
  }

  /**
   * Sync with external vault (HashiCorp Vault, AWS Secrets Manager)
   */
  async syncWithVault(workspaceId: string, vaultType: 'VAULT' | 'AWS_SECRETS_MANAGER'): Promise<{ synced: number; errors: string[] }> {
    const errors: string[] = [];
    let synced = 0;

    if (vaultType === 'VAULT' && config.vaultUrl && config.vaultToken) {
      // Implement Vault sync
      // This would use @hashicorp/vault-sdk
    } else if (vaultType === 'AWS_SECRETS_MANAGER' && config.awsRegion) {
      // Implement AWS Secrets Manager sync
      // This would use @aws-sdk/client-secrets-manager
    }

    return { synced, errors };
  }
}

export const secretsService = new SecretsService();