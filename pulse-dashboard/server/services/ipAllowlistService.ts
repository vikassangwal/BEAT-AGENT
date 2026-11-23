import { prisma } from '../db/prisma';
import { cacheRedis } from '../db/redis';
import { auditService, AuditEventType } from './auditService';
import { IPAllowlistType } from '@prisma/client';
import { generateSecureRandom } from '../utils/crypto';

export interface CreateIpAllowlistInput {
  workspaceId: string;
  type: IPAllowlistType;
  value: string; // IP/CIDR or country code
  description?: string;
  expiresAt?: Date;
  createdBy: string;
}

export interface IpAllowlistEntry {
  id: string;
  workspaceId: string;
  type: IPAllowlistType;
  value: string;
  description: string | null;
  enabled: boolean;
  expiresAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

class IpAllowlistService {
  private readonly CACHE_TTL = 300; // 5 minutes

  /**
   * Create IP allowlist entry
   */
  async createEntry(input: CreateIpAllowlistInput): Promise<IpAllowlistEntry> {
    const { workspaceId, type, value, description, expiresAt, createdBy } = input;

    // Validate IP/CIDR or country code
    if (!this.validateEntry(type, value)) {
      throw new Error('INVALID_ENTRY_VALUE');
    }

    const entry = await prisma.ipAllowlist.create({
      data: {
        workspaceId,
        type,
        value: value.toUpperCase(), // Normalize
        description,
        expiresAt,
        createdBy,
      },
    });

    await this.invalidateCache(workspaceId);

    await auditService.logImmediate({
      workspaceId,
      userId: createdBy,
      performedBy: createdBy,
      eventType: type === IPAllowlistType.ALLOW || type === IPAllowlistType.GEO_ALLOW
        ? AuditEventType.IP_ALLOWLISTED
        : AuditEventType.IP_BLOCKED,
      severity: 'INFO',
      resourceType: 'IP_ALLOWLIST',
      resourceId: entry.id,
      action: 'CREATE',
      description: `IP ${type.toLowerCase()} entry added: ${value}`,
      metadata: { type, value, description },
    });

    return entry;
  }

  /**
   * Update IP allowlist entry
   */
  async updateEntry(
    entryId: string,
    workspaceId: string,
    updates: Partial<CreateIpAllowlistInput>,
    updatedBy: string
  ): Promise<IpAllowlistEntry> {
    const entry = await prisma.ipAllowlist.findFirst({ where: { id: entryId, workspaceId } });
    if (!entry) throw new Error('ENTRY_NOT_FOUND');

    if (updates.value && !this.validateEntry(updates.type || entry.type, updates.value)) {
      throw new Error('INVALID_ENTRY_VALUE');
    }

    const updated = await prisma.ipAllowlist.update({
      where: { id: entryId },
      data: {
        type: updates.type,
        value: updates.value?.toUpperCase(),
        description: updates.description,
        enabled: updates.enabled,
        expiresAt: updates.expiresAt,
      },
    });

    await this.invalidateCache(workspaceId);

    await auditService.logImmediate({
      workspaceId,
      userId: updatedBy,
      performedBy: updatedBy,
      eventType: AuditEventType.WORKSPACE_IP_ALLOWLIST_UPDATED,
      severity: 'INFO',
      resourceType: 'IP_ALLOWLIST',
      resourceId: entryId,
      action: 'UPDATE',
      description: `IP allowlist entry updated: ${entry.value} -> ${updated.value}`,
      metadata: { changes: updates },
    });

    return updated;
  }

  /**
   * Delete IP allowlist entry
   */
  async deleteEntry(entryId: string, workspaceId: string, deletedBy: string): Promise<void> {
    const entry = await prisma.ipAllowlist.findFirst({ where: { id: entryId, workspaceId } });
    if (!entry) throw new Error('ENTRY_NOT_FOUND');

    await prisma.ipAllowlist.delete({ where: { id: entryId } });
    await this.invalidateCache(workspaceId);

    await auditService.logImmediate({
      workspaceId,
      userId: deletedBy,
      performedBy: deletedBy,
      eventType: AuditEventType.WORKSPACE_IP_ALLOWLIST_UPDATED,
      severity: 'INFO',
      resourceType: 'IP_ALLOWLIST',
      resourceId: entryId,
      action: 'DELETE',
      description: `IP allowlist entry deleted: ${entry.value}`,
    });
  }

  /**
   * List IP allowlist entries
   */
  async listEntries(workspaceId: string): Promise<IpAllowlistEntry[]> {
    const cacheKey = `ip_allowlist:${workspaceId}:full`;
    let cached = await cacheRedis.get<IpAllowlistEntry[]>(cacheKey);

    if (!cached) {
      cached = await prisma.ipAllowlist.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
      });
      await cacheRedis.set(cacheKey, cached, this.CACHE_TTL);
    }

    return cached;
  }

  /**
   * Check if IP is allowed for workspace
   */
  async checkIpAllowed(workspaceId: string, ip: string): Promise<{ allowed: boolean; reason?: string }> {
    const entries = await this.getActiveEntries(workspaceId);

    // Normalize IP
    const normalizedIp = this.normalizeIp(ip);

    // Check deny rules first
    for (const entry of entries) {
      if (!entry.enabled) continue;
      if (entry.expiresAt && entry.expiresAt < new Date()) continue;

      if (entry.type === IPAllowlistType.DENY && this.matchIp(normalizedIp, entry.value)) {
        return { allowed: false, reason: `IP denied by rule: ${entry.value}` };
      }
      if (entry.type === IPAllowlistType.GEO_DENY) {
        const country = await this.getCountryFromIp(normalizedIp);
        if (country && country === entry.value) {
          return { allowed: false, reason: `Country denied: ${entry.value}` };
        }
      }
    }

    // Check allow rules
    const hasAllowRules = entries.some(e =>
      e.enabled && (!e.expiresAt || e.expiresAt > new Date()) &&
      (e.type === IPAllowlistType.ALLOW || e.type === IPAllowlistType.GEO_ALLOW)
    );

    if (hasAllowRules) {
      for (const entry of entries) {
        if (!entry.enabled) continue;
        if (entry.expiresAt && entry.expiresAt < new Date()) continue;

        if (entry.type === IPAllowlistType.ALLOW && this.matchIp(normalizedIp, entry.value)) {
          return { allowed: true };
        }
        if (entry.type === IPAllowlistType.GEO_ALLOW) {
          const country = await this.getCountryFromIp(normalizedIp);
          if (country && country === entry.value) {
            return { allowed: true };
          }
        }
      }
      return { allowed: false, reason: 'IP not in allowlist' };
    }

    // No explicit allow rules - default allow
    return { allowed: true };
  }

  /**
   * Bulk import IP allowlist entries
   */
  async bulkImport(workspaceId: string, entries: CreateIpAllowlistInput[], createdBy: string): Promise<{ created: number; errors: string[] }> {
    const results = { created: 0, errors: [] as string[] };

    for (const entry of entries) {
      try {
        await this.createEntry(entry);
        results.created++;
      } catch (error) {
        results.errors.push(`${entry.value}: ${(error as Error).message}`);
      }
    }

    return results;
  }

  /**
   * Export IP allowlist entries
   */
  async exportEntries(workspaceId: string): Promise<string> {
    const entries = await this.listEntries(workspaceId);
    return JSON.stringify(entries, null, 2);
  }

  /**
   * Get active entries (cached)
   */
  private async getActiveEntries(workspaceId: string): Promise<IpAllowlistEntry[]> {
    const cacheKey = `ip_allowlist:${workspaceId}:active`;
    let cached = await cacheRedis.get<IpAllowlistEntry[]>(cacheKey);

    if (!cached) {
      const now = new Date();
      cached = await prisma.ipAllowlist.findMany({
        where: {
          workspaceId,
          enabled: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      await cacheRedis.set(cacheKey, cached, this.CACHE_TTL);
    }

    return cached;
  }

  /**
   * Invalidate cache
   */
  private async invalidateCache(workspaceId: string): Promise<void> {
    await cacheRedis.delete(`ip_allowlist:${workspaceId}:full`);
    await cacheRedis.delete(`ip_allowlist:${workspaceId}:active`);
    await cacheRedis.delete(`ip_allowlist:${workspaceId}`);
  }

  /**
   * Validate entry value based on type
   */
  private validateEntry(type: IPAllowlistType, value: string): boolean {
    const upperValue = value.toUpperCase();

    if (type === IPAllowlistType.ALLOW || type === IPAllowlistType.DENY) {
      // Validate IP or CIDR
      return this.isValidIpOrCidr(upperValue);
    }

    if (type === IPAllowlistType.GEO_ALLOW || type === IPAllowlistType.GEO_DENY) {
      // Validate country code (ISO 3166-1 alpha-2)
      return /^[A-Z]{2}$/.test(upperValue);
    }

    return false;
  }

  /**
   * Check if string is valid IP or CIDR
   */
  private isValidIpOrCidr(value: string): boolean {
    // IPv4
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    // IPv6
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(\/\d{1,3})?$/;

    if (ipv4Regex.test(value)) {
      const parts = value.split('/');
      const ipParts = parts[0].split('.').map(Number);
      return ipParts.every(p => p >= 0 && p <= 255) &&
        (!parts[1] || (parseInt(parts[1], 10) >= 0 && parseInt(parts[1], 10) <= 32));
    }

    if (ipv6Regex.test(value)) {
      const parts = value.split('/');
      return !parts[1] || (parseInt(parts[1], 10) >= 0 && parseInt(parts[1], 10) <= 128);
    }

    return false;
  }

  /**
   * Normalize IP address
   */
  private normalizeIp(ip: string): string {
    // Handle IPv6 mapped IPv4
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7);
    }
    return ip;
  }

  /**
   * Match IP against CIDR or exact IP
   */
  private matchIp(ip: string, pattern: string): boolean {
    if (pattern.includes('/')) {
      return this.cidrMatch(ip, pattern);
    }
    return ip === pattern;
  }

  /**
   * CIDR matching for IPv4
   */
  private cidrMatch(ip: string, cidr: string): boolean {
    const [rangeIp, bitsStr] = cidr.split('/');
    const bits = parseInt(bitsStr, 10);

    const ipParts = ip.split('.').map(Number);
    const rangeParts = rangeIp.split('.').map(Number);

    if (ipParts.length !== 4 || rangeParts.length !== 4) {
      // IPv6 not fully implemented
      return false;
    }

    const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const rangeNum = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3];
    const mask = bits === 0 ? 0 : ~((1 << (32 - bits)) - 1);

    return (ipNum & mask) === (rangeNum & mask);
  }

  /**
   * Get country from IP (would use GeoIP service in production)
   */
  private async getCountryFromIp(ip: string): Promise<string | null> {
    // In production, integrate with MaxMind GeoIP2 or similar
    // For now, return null (unknown)
    return null;
  }
}

export const ipAllowlistService = new IpAllowlistService();