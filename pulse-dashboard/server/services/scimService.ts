import { prisma } from '../db/prisma';
import { cacheRedis } from '../db/redis';
import { auditService, AuditEventType } from './auditService';
import { authService } from './authService';
import { config } from '../config';
import { encrypt, decrypt, generateSecureRandom } from '../utils/crypto';
import { ScimConfigInput } from './ssoService'; // Reuse or define separately

export interface ScimConfigInput {
  workspaceId: string;
  enabled: boolean;
  baseUrl: string;
  bearerToken: string;
  userSchema?: Record<string, unknown>;
  groupSchema?: Record<string, unknown>;
  attributeMapping?: Record<string, string>;
  filterConfig?: Record<string, unknown>;
  provisioningRules?: Record<string, unknown>;
}

export interface ScimUser {
  id: string;
  externalId: string;
  userName: string;
  displayName?: string;
  emails: Array<{ value: string; primary?: boolean; type?: string }>;
  groups: Array<{ value: string; display?: string }>;
  active: boolean;
  schemas: string[];
  meta?: {
    resourceType: 'User';
    created?: string;
    lastModified?: string;
    location?: string;
    version?: string;
  };
}

export interface ScimGroup {
  id: string;
  externalId: string;
  displayName: string;
  members: Array<{ value: string; display?: string }>;
  schemas: string[];
  meta?: {
    resourceType: 'Group';
    created?: string;
    lastModified?: string;
    location?: string;
    version?: string;
  };
}

export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  itemsPerPage: number;
  startIndex: number;
  Resources: T[];
}

class ScimService {
  private readonly SCIM_SCHEMAS = {
    User: 'urn:ietf:params:scim:schemas:core:2.0:User',
    Group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
    ListResponse: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  };

  /**
   * Configure SCIM for a workspace
   */
  async configureScim(input: ScimConfigInput, configuredBy: string): Promise<void> {
    const { workspaceId, bearerToken, ...config } = input;

    // Encrypt bearer token
    const encryptedToken = encrypt(bearerToken);

    await prisma.scimConfig.upsert({
      where: { workspaceId },
      update: {
        enabled: config.enabled,
        baseUrl: config.baseUrl,
        bearerToken: encryptedToken,
        userSchema: config.userSchema as any,
        groupSchema: config.groupSchema as any,
        attributeMapping: config.attributeMapping as any,
        filterConfig: config.filterConfig as any,
        provisioningRules: config.provisioningRules as any,
        updatedAt: new Date(),
      },
      create: {
        workspaceId,
        enabled: config.enabled,
        baseUrl: config.baseUrl,
        bearerToken: encryptedToken,
        userSchema: config.userSchema as any,
        groupSchema: config.groupSchema as any,
        attributeMapping: config.attributeMapping as any,
        filterConfig: config.filterConfig as any,
        provisioningRules: config.provisioningRules as any,
      },
    });

    await cacheRedis.delete(`scim_config:${workspaceId}`);

    await auditService.logImmediate({
      workspaceId,
      userId: configuredBy,
      performedBy: configuredBy,
      eventType: AuditEventType.WORKSPACE_SCIM_CONFIGURED,
      severity: 'INFO',
      description: `SCIM ${config.enabled ? 'enabled' : 'disabled'}`,
      metadata: { enabled: config.enabled },
    });
  }

  /**
   * Get SCIM config
   */
  async getScimConfig(workspaceId: string): Promise<any> {
    const cacheKey = `scim_config:${workspaceId}`;
    let cached = await cacheRedis.get(cacheKey);

    if (!cached) {
      const config = await prisma.scimConfig.findUnique({ where: { workspaceId } });
      if (config) {
        cached = {
          ...config,
          bearerToken: config.bearerToken ? decrypt(config.bearerToken) : undefined,
        };
        await cacheRedis.set(cacheKey, cached, 300);
      }
    }

    return cached;
  }

  /**
   * Validate SCIM bearer token
   */
  async validateToken(workspaceId: string, token: string): Promise<boolean> {
    const config = await this.getScimConfig(workspaceId);
    if (!config || !config.enabled) return false;

    return token === config.bearerToken;
  }

  /**
   * List users (SCIM GET /Users)
   */
  async listUsers(workspaceId: string, params: {
    startIndex?: number;
    count?: number;
    filter?: string;
    attributes?: string;
    excludedAttributes?: string;
  }): Promise<ScimListResponse<ScimUser>> {
    const config = await this.getScimConfig(workspaceId);
    if (!config || !config.enabled) throw new Error('SCIM_NOT_ENABLED');

    const startIndex = params.startIndex || 1;
    const count = Math.min(params.count || 100, 1000);

    const where: any = { workspaceId, deletedAt: null };
    if (params.filter) {
      where.OR = this.parseFilter(params.filter);
    }

    const [users, total] = await Promise.all([
      prisma.scimUser.findMany({
        where,
        orderBy: { userName: 'asc' },
        skip: startIndex - 1,
        take: count,
      }),
      prisma.scimUser.count({ where }),
    ]);

    return {
      schemas: [this.SCIM_SCHEMAS.ListResponse],
      totalResults: total,
      itemsPerPage: users.length,
      startIndex,
      Resources: users.map(u => this.formatUser(u)),
    };
  }

  /**
   * Get user by ID (SCIM GET /Users/{id})
   */
  async getUser(workspaceId: string, id: string): Promise<ScimUser> {
    const config = await this.getScimConfig(workspaceId);
    if (!config || !config.enabled) throw new Error('SCIM_NOT_ENABLED');

    const user = await prisma.scimUser.findFirst({
      where: { id, workspaceId, deletedAt: null },
    });

    if (!user) throw new Error('USER_NOT_FOUND');

    return this.formatUser(user);
  }

  /**
   * Get user by external ID
   */
  async getUserByExternalId(workspaceId: string, externalId: string): Promise<ScimUser | null> {
    const user = await prisma.scimUser.findFirst({
      where: { externalId, workspaceId, deletedAt: null },
    });

    return user ? this.formatUser(user) : null;
  }

  /**
   * Create user (SCIM POST /Users)
   */
  async createUser(workspaceId: string, userData: Partial<ScimUser>, createdBy: string): Promise<ScimUser> {
    const config = await this.getScimConfig(workspaceId);
    if (!config || !config.enabled) throw new Error('SCIM_NOT_ENABLED');

    // Check if user exists by externalId or userName
    const existing = await prisma.scimUser.findFirst({
      where: {
        workspaceId,
        OR: [
          { externalId: userData.externalId },
          { userName: userData.userName },
        ],
        deletedAt: null,
      },
    });

    if (existing) throw new Error('USER_ALREADY_EXISTS');

    const user = await prisma.scimUser.create({
      data: {
        workspaceId,
        externalId: userData.externalId || generateSecureRandom(16),
        userName: userData.userName!,
        displayName: userData.displayName,
        emails: userData.emails as any,
        groups: userData.groups as any,
        active: userData.active ?? true,
        schemas: userData.schemas || [this.SCIM_SCHEMAS.User],
        meta: userData.meta as any,
      },
    });

    // Auto-provision local user if enabled
    if (config.autoProvision) {
      await this.provisionLocalUser(workspaceId, user);
    }

    await auditService.logImmediate({
      workspaceId,
      userId: createdBy,
      performedBy: createdBy,
      eventType: AuditEventType.SCIM_USER_CREATED,
      severity: 'INFO',
      resourceType: 'USER',
      resourceId: user.id,
      action: 'CREATE',
      description: `SCIM user created: ${user.userName}`,
    });

    return this.formatUser(user);
  }

  /**
   * Update user (SCIM PUT /Users/{id})
   */
  async updateUser(workspaceId: string, id: string, userData: Partial<ScimUser>, updatedBy: string): Promise<ScimUser> {
    const config = await this.getScimConfig(workspaceId);
    if (!config || !config.enabled) throw new Error('SCIM_NOT_ENABLED');

    const user = await prisma.scimUser.findFirst({ where: { id, workspaceId, deletedAt: null } });
    if (!user) throw new Error('USER_NOT_FOUND');

    const updated = await prisma.scimUser.update({
      where: { id },
      data: {
        userName: userData.userName,
        displayName: userData.displayName,
        emails: userData.emails as any,
        groups: userData.groups as any,
        active: userData.active,
        schemas: userData.schemas as any,
        meta: userData.meta as any,
        updatedAt: new Date(),
      },
    });

    // Update local user if linked
    if (updated.userId) {
      await this.syncLocalUser(workspaceId, updated);
    }

    await auditService.logImmediate({
      workspaceId,
      userId: updatedBy,
      performedBy: updatedBy,
      eventType: AuditEventType.SCIM_USER_UPDATED,
      severity: 'INFO',
      resourceType: 'USER',
      resourceId: id,
      action: 'UPDATE',
      description: `SCIM user updated: ${updated.userName}`,
    });

    return this.formatUser(updated);
  }

  /**
   * Patch user (SCIM PATCH /Users/{id})
   */
  async patchUser(workspaceId: string, id: string, operations: Array<{ op: string; path: string; value?: any }>, updatedBy: string): Promise<ScimUser> {
    const user = await prisma.scimUser.findFirst({ where: { id, workspaceId, deletedAt: null } });
    if (!user) throw new Error('USER_NOT_FOUND');

    let updatedData = {
      userName: user.userName,
      displayName: user.displayName,
      emails: user.emails,
      groups: user.groups,
      active: user.active,
      schemas: user.schemas,
      meta: user.meta,
    };

    for (const op of operations) {
      this.applyPatchOperation(updatedData, op);
    }

    const updated = await prisma.scimUser.update({
      where: { id },
      data: {
        ...updatedData,
        updatedAt: new Date(),
      },
    });

    if (updated.userId) {
      await this.syncLocalUser(workspaceId, updated);
    }

    await auditService.logImmediate({
      workspaceId,
      userId: updatedBy,
      performedBy: updatedBy,
      eventType: AuditEventType.SCIM_USER_UPDATED,
      severity: 'INFO',
      resourceType: 'USER',
      resourceId: id,
      action: 'PATCH',
      description: `SCIM user patched: ${updated.userName}`,
    });

    return this.formatUser(updated);
  }

  /**
   * Delete user (SCIM DELETE /Users/{id})
   */
  async deleteUser(workspaceId: string, id: string, deletedBy: string): Promise<void> {
    const config = await this.getScimConfig(workspaceId);
    if (!config || !config.enabled) throw new Error('SCIM_NOT_ENABLED');

    const user = await prisma.scimUser.findFirst({ where: { id, workspaceId, deletedAt: null } });
    if (!user) throw new Error('USER_NOT_FOUND');

    await prisma.scimUser.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });

    // Delete local user if linked
    if (user.userId) {
      await prisma.user.update({
        where: { id: user.userId },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
    }

    await auditService.logImmediate({
      workspaceId,
      userId: deletedBy,
      performedBy: deletedBy,
      eventType: AuditEventType.SCIM_USER_DELETED,
      severity: 'INFO',
      resourceType: 'USER',
      resourceId: id,
      action: 'DELETE',
      description: `SCIM user deleted: ${user.userName}`,
    });
  }

  /**
   * List groups (SCIM GET /Groups)
   */
  async listGroups(workspaceId: string, params: {
    startIndex?: number;
    count?: number;
    filter?: string;
  }): Promise<ScimListResponse<ScimGroup>> {
    const config = await this.getScimConfig(workspaceId);
    if (!config || !config.enabled) throw new Error('SCIM_NOT_ENABLED');

    const startIndex = params.startIndex || 1;
    const count = Math.min(params.count || 100, 1000);

    const where: any = { workspaceId, deletedAt: null };
    if (params.filter) {
      where.OR = this.parseFilter(params.filter);
    }

    const [groups, total] = await Promise.all([
      prisma.scimGroup.findMany({
        where,
        orderBy: { displayName: 'asc' },
        skip: startIndex - 1,
        take: count,
      }),
      prisma.scimGroup.count({ where }),
    ]);

    return {
      schemas: [this.SCIM_SCHEMAS.ListResponse],
      totalResults: total,
      itemsPerPage: groups.length,
      startIndex,
      Resources: groups.map(g => this.formatGroup(g)),
    };
  }

  /**
   * Get group by ID (SCIM GET /Groups/{id})
   */
  async getGroup(workspaceId: string, id: string): Promise<ScimGroup> {
    const config = await this.getScimConfig(workspaceId);
    if (!config || !config.enabled) throw new Error('SCIM_NOT_ENABLED');

    const group = await prisma.scimGroup.findFirst({ where: { id, workspaceId, deletedAt: null } });
    if (!group) throw new Error('GROUP_NOT_FOUND');

    return this.formatGroup(group);
  }

  /**
   * Create group (SCIM POST /Groups)
   */
  async createGroup(workspaceId: string, groupData: Partial<ScimGroup>, createdBy: string): Promise<ScimGroup> {
    const config = await this.getScimConfig(workspaceId);
    if (!config || !config.enabled) throw new Error('SCIM_NOT_ENABLED');

    const existing = await prisma.scimGroup.findFirst({
      where: { workspaceId, OR: [{ externalId: groupData.externalId }, { displayName: groupData.displayName }], deletedAt: null },
    });

    if (existing) throw new Error('GROUP_ALREADY_EXISTS');

    const group = await prisma.scimGroup.create({
      data: {
        workspaceId,
        externalId: groupData.externalId || generateSecureRandom(16),
        displayName: groupData.displayName!,
        members: groupData.members as any,
        schemas: groupData.schemas || [this.SCIM_SCHEMAS.Group],
        meta: groupData.meta as any,
      },
    });

    await auditService.logImmediate({
      workspaceId,
      userId: createdBy,
      performedBy: createdBy,
      eventType: AuditEventType.SCIM_GROUP_CREATED,
      severity: 'INFO',
      resourceType: 'GROUP',
      resourceId: group.id,
      action: 'CREATE',
      description: `SCIM group created: ${group.displayName}`,
    });

    return this.formatGroup(group);
  }

  /**
   * Update group (SCIM PUT /Groups/{id})
   */
  async updateGroup(workspaceId: string, id: string, groupData: Partial<ScimGroup>, updatedBy: string): Promise<ScimGroup> {
    const group = await prisma.scimGroup.findFirst({ where: { id, workspaceId, deletedAt: null } });
    if (!group) throw new Error('GROUP_NOT_FOUND');

    const updated = await prisma.scimGroup.update({
      where: { id },
      data: {
        displayName: groupData.displayName,
        members: groupData.members as any,
        schemas: groupData.schemas as any,
        meta: groupData.meta as any,
        updatedAt: new Date(),
      },
    });

    await auditService.logImmediate({
      workspaceId,
      userId: updatedBy,
      performedBy: updatedBy,
      eventType: AuditEventType.SCIM_GROUP_UPDATED,
      severity: 'INFO',
      resourceType: 'GROUP',
      resourceId: id,
      action: 'UPDATE',
      description: `SCIM group updated: ${updated.displayName}`,
    });

    return this.formatGroup(updated);
  }

  /**
   * Delete group (SCIM DELETE /Groups/{id})
   */
  async deleteGroup(workspaceId: string, id: string, deletedBy: string): Promise<void> {
    const group = await prisma.scimGroup.findFirst({ where: { id, workspaceId, deletedAt: null } });
    if (!group) throw new Error('GROUP_NOT_FOUND');

    await prisma.scimGroup.update({ where: { id }, data: { deletedAt: new Date() } });

    await auditService.logImmediate({
      workspaceId,
      userId: deletedBy,
      performedBy: deletedBy,
      eventType: AuditEventType.SCIM_GROUP_DELETED,
      severity: 'INFO',
      resourceType: 'GROUP',
      resourceId: id,
      action: 'DELETE',
      description: `SCIM group deleted: ${group.displayName}`,
    });
  }

  /**
   * Sync from IdP (pull users/groups)
   */
  async syncFromIdP(workspaceId: string, syncToken?: string): Promise<{ users: number; groups: number; nextSyncToken?: string }> {
    const config = await this.getScimConfig(workspaceId);
    if (!config || !config.enabled) throw new Error('SCIM_NOT_ENABLED');

    // This would make HTTP requests to the IdP's SCIM endpoint
    // For now, return mock data
    return { users: 0, groups: 0, nextSyncToken: generateSecureRandom(32) };
  }

  /**
   * Provision local user from SCIM user
   */
  private async provisionLocalUser(workspaceId: string, scimUser: any): Promise<void> {
    const primaryEmail = scimUser.emails?.find((e: any) => e.primary)?.value || scimUser.emails?.[0]?.value;
    if (!primaryEmail) return;

    let user = await prisma.user.findUnique({ where: { email: primaryEmail } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: primaryEmail,
          name: scimUser.displayName,
          authProvider: 'SCIM',
          providerId: scimUser.externalId,
          status: scimUser.active ? 'ACTIVE' : 'INACTIVE',
          emailVerified: new Date(),
        },
      });
    }

    // Create membership
    await prisma.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
      update: { isActive: scimUser.active, role: 'MEMBER' },
      create: { userId: user.id, workspaceId, role: 'MEMBER', isActive: scimUser.active, acceptedAt: new Date() },
    });

    // Link SCIM user to local user
    await prisma.scimUser.update({
      where: { id: scimUser.id },
      data: { userId: user.id },
    });
  }

  /**
   * Sync local user from SCIM user
   */
  private async syncLocalUser(workspaceId: string, scimUser: any): Promise<void> {
    if (!scimUser.userId) return;

    const primaryEmail = scimUser.emails?.find((e: any) => e.primary)?.value || scimUser.emails?.[0]?.value;

    await prisma.user.update({
      where: { id: scimUser.userId },
      data: {
        name: scimUser.displayName,
        email: primaryEmail,
        status: scimUser.active ? 'ACTIVE' : 'INACTIVE',
      },
    });

    await prisma.membership.update({
      where: { userId_workspaceId: { userId: scimUser.userId, workspaceId } },
      data: { isActive: scimUser.active },
    });
  }

  /**
   * Format SCIM user for response
   */
  private formatUser(user: any): ScimUser {
    return {
      id: user.id,
      externalId: user.externalId,
      userName: user.userName,
      displayName: user.displayName,
      emails: user.emails || [],
      groups: user.groups || [],
      active: user.active,
      schemas: user.schemas || [this.SCIM_SCHEMAS.User],
      meta: user.meta || {
        resourceType: 'User',
        created: user.createdAt.toISOString(),
        lastModified: user.updatedAt.toISOString(),
        location: `${config.scimBasePath}/Users/${user.id}`,
        version: user.updatedAt.toISOString(),
      },
    };
  }

  /**
   * Format SCIM group for response
   */
  private formatGroup(group: any): ScimGroup {
    return {
      id: group.id,
      externalId: group.externalId,
      displayName: group.displayName,
      members: group.members || [],
      schemas: group.schemas || [this.SCIM_SCHEMAS.Group],
      meta: group.meta || {
        resourceType: 'Group',
        created: group.createdAt.toISOString(),
        lastModified: group.updatedAt.toISOString(),
        location: `${config.scimBasePath}/Groups/${group.id}`,
        version: group.updatedAt.toISOString(),
      },
    };
  }

  /**
   * Parse SCIM filter
   */
  private parseFilter(filter: string): any[] {
    // Simple filter parsing - supports eq, co, sw, ew, pr, gt, ge, lt, le
    // Example: userName eq "john" or emails.value co "example.com"
    const conditions: any[] = [];

    // Very basic implementation
    if (filter.includes('eq')) {
      const [attr, value] = filter.split('eq').map(s => s.trim().replace(/"/g, ''));
      conditions.push({ [attr]: value });
    }

    return conditions.length > 0 ? conditions : [{}];
  }

  /**
   * Apply PATCH operation
   */
  private applyPatchOperation(data: any, op: { op: string; path: string; value?: any }): void {
    const pathParts = op.path.split('.');
    let target = data;

    for (let i = 0; i < pathParts.length - 1; i++) {
      target = target[pathParts[i]];
      if (!target) return;
    }

    const lastPart = pathParts[pathParts.length - 1];

    switch (op.op) {
      case 'add':
        if (Array.isArray(target)) {
          target.push(op.value);
        } else {
          target[lastPart] = op.value;
        }
        break;
      case 'remove':
        if (Array.isArray(target)) {
          const index = target.findIndex((item: any) => item.value === op.value?.value);
          if (index >= 0) target.splice(index, 1);
        } else {
          delete target[lastPart];
        }
        break;
      case 'replace':
        target[lastPart] = op.value;
        break;
    }
  }
}

export const scimService = new ScimService();