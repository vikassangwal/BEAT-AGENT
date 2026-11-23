import { prisma } from '../db/prisma';
import { cacheRedis } from '../db/redis';
import { auditService, AuditEventType } from './auditService';
import { MembershipRole, PermissionAction, ResourceType, Prisma } from '@prisma/client';
import { RoleData, PermissionData } from '@shared/types';

export interface CreateRoleInput {
  workspaceId: string;
  name: string;
  description?: string;
  permissions: string[]; // e.g., ['PROJECT:CREATE', 'PAGE:READ']
  conditions?: Record<string, unknown>; // ABAC conditions
  createdBy: string;
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
  conditions?: Record<string, unknown>;
}

export interface AssignRoleInput {
  userId: string;
  workspaceId: string;
  roleId: string;
  assignedBy: string;
}

export interface PermissionCheck {
  resource: ResourceType;
  action: PermissionAction;
  resourceId?: string;
  context?: Record<string, unknown>;
}

class RbacService {
  private readonly CACHE_TTL = 300; // 5 minutes

  /**
   * Create a custom role
   */
  async createRole(input: CreateRoleInput): Promise<RoleData> {
    const { workspaceId, name, description, permissions, conditions, createdBy } = input;

    // Validate permissions exist
    const validPermissions = await this.validatePermissions(permissions);
    if (validPermissions.length !== permissions.length) {
      throw new Error('INVALID_PERMISSIONS');
    }

    // Check if role name already exists
    const existing = await prisma.role.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
    });
    if (existing) {
      throw new Error('ROLE_NAME_EXISTS');
    }

    // Create role
    const role = await prisma.role.create({
      data: {
        workspaceId,
        name,
        description,
        isSystem: false,
        conditions: conditions as Prisma.InputJsonValue | undefined,
        permissions: {
          create: validPermissions.map(p => ({
            permissionId: p.id,
            condition: null,
            grantedBy: createdBy,
          })),
        },
      },
      include: {
        permissions: { include: { permission: true } },
      },
    });

    // Invalidate cache
    await this.invalidateRoleCache(workspaceId);

    // Audit log
    await auditService.logImmediate({
      workspaceId,
      userId: createdBy,
      performedBy: createdBy,
      eventType: AuditEventType.CUSTOM_ROLE_CREATED,
      severity: 'INFO',
      resourceType: ResourceType.ROLE,
      resourceId: role.id,
      action: 'CREATE',
      description: `Custom role created: ${name}`,
      metadata: { permissions: permissions.map(p => p) },
    });

    return this.formatRole(role);
  }

  /**
   * Update a role
   */
  async updateRole(roleId: string, workspaceId: string, input: UpdateRoleInput, updatedBy: string): Promise<RoleData> {
    const role = await prisma.role.findFirst({
      where: { id: roleId, workspaceId },
      include: { permissions: { include: { permission: true } } },
    });

    if (!role) {
      throw new Error('ROLE_NOT_FOUND');
    }

    if (role.isSystem) {
      throw new Error('CANNOT_MODIFY_SYSTEM_ROLE');
    }

    const updateData: Prisma.RoleUpdateInput = {};
    if (input.name) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.conditions !== undefined) updateData.conditions = input.conditions as Prisma.InputJsonValue;

    // Update permissions if provided
    if (input.permissions) {
      const validPermissions = await this.validatePermissions(input.permissions);

      // Remove old permissions
      await prisma.rolePermission.deleteMany({ where: { roleId } });

      // Add new permissions
      updateData.permissions = {
        create: validPermissions.map(p => ({
          permissionId: p.id,
          condition: null,
          grantedBy: updatedBy,
        })),
      };
    }

    const updated = await prisma.role.update({
      where: { id: roleId },
      data: updateData,
      include: { permissions: { include: { permission: true } } },
    });

    // Invalidate cache
    await this.invalidateRoleCache(workspaceId);

    // Audit log
    await auditService.logImmediate({
      workspaceId,
      userId: updatedBy,
      performedBy: updatedBy,
      eventType: AuditEventType.ROLE_UPDATED,
      severity: 'INFO',
      resourceType: ResourceType.ROLE,
      resourceId: roleId,
      action: 'UPDATE',
      description: `Role updated: ${role.name}`,
      metadata: { changes: input },
    });

    return this.formatRole(updated);
  }

  /**
   * Delete a role
   */
  async deleteRole(roleId: string, workspaceId: string, deletedBy: string): Promise<void> {
    const role = await prisma.role.findFirst({ where: { id: roleId, workspaceId } });
    if (!role) throw new Error('ROLE_NOT_FOUND');
    if (role.isSystem) throw new Error('CANNOT_DELETE_SYSTEM_ROLE');

    // Check if role is assigned to any members
    const assignedCount = await prisma.membership.count({ where: { roleId } });
    if (assignedCount > 0) {
      throw new Error('ROLE_IN_USE');
    }

    await prisma.role.delete({ where: { id: roleId } });
    await this.invalidateRoleCache(workspaceId);

    await auditService.logImmediate({
      workspaceId,
      userId: deletedBy,
      performedBy: deletedBy,
      eventType: AuditEventType.ROLE_DELETED,
      severity: 'INFO',
      resourceType: ResourceType.ROLE,
      resourceId: roleId,
      action: 'DELETE',
      description: `Role deleted: ${role.name}`,
    });
  }

  /**
   * Get role by ID
   */
  async getRole(roleId: string, workspaceId: string): Promise<RoleData | null> {
    const cacheKey = `role:${workspaceId}:${roleId}`;
    let role = await cacheRedis.get<RoleData>(cacheKey);

    if (!role) {
      const dbRole = await prisma.role.findFirst({
        where: { id: roleId, workspaceId },
        include: { permissions: { include: { permission: true } } },
      });

      if (dbRole) {
        role = this.formatRole(dbRole);
        await cacheRedis.set(cacheKey, role, this.CACHE_TTL);
      }
    }

    return role || null;
  }

  /**
   * List roles for workspace
   */
  async listRoles(workspaceId: string): Promise<RoleData[]> {
    const cacheKey = `roles:${workspaceId}`;
    let roles = await cacheRedis.get<RoleData[]>(cacheKey);

    if (!roles) {
      const dbRoles = await prisma.role.findMany({
        where: { workspaceId },
        include: { permissions: { include: { permission: true } } },
        orderBy: { priority: 'desc' },
      });

      roles = dbRoles.map(r => this.formatRole(r));
      await cacheRedis.set(cacheKey, roles, this.CACHE_TTL);
    }

    return roles;
  }

  /**
   * Assign role to user
   */
  async assignRole(input: AssignRoleInput): Promise<void> {
    const { userId, workspaceId, roleId, assignedBy } = input;

    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });

    if (!membership) {
      throw new Error('MEMBERSHIP_NOT_FOUND');
    }

    const role = await prisma.role.findFirst({ where: { id: roleId, workspaceId } });
    if (!role) {
      throw new Error('ROLE_NOT_FOUND');
    }

    await prisma.membership.update({
      where: { id: membership.id },
      data: { roleId, role: MembershipRole.CUSTOM },
    });

    await this.invalidateUserPermissionCache(userId, workspaceId);

    await auditService.logImmediate({
      workspaceId,
      userId,
      performedBy: assignedBy,
      eventType: AuditEventType.ROLE_ASSIGNED,
      severity: 'INFO',
      resourceType: ResourceType.ROLE,
      resourceId: roleId,
      action: 'ASSIGN',
      description: `Role assigned: ${role.name} to user ${userId}`,
    });
  }

  /**
   * Revoke role from user (revert to default)
   */
  async revokeRole(userId: string, workspaceId: string, revokedBy: string): Promise<void> {
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });

    if (!membership || !membership.roleId) return;

    const role = await prisma.role.findUnique({ where: { id: membership.roleId } });

    await prisma.membership.update({
      where: { id: membership.id },
      data: { roleId: null, role: MembershipRole.MEMBER },
    });

    await this.invalidateUserPermissionCache(userId, workspaceId);

    await auditService.logImmediate({
      workspaceId,
      userId,
      performedBy: revokedBy,
      eventType: AuditEventType.ROLE_REVOKED,
      severity: 'INFO',
      resourceType: ResourceType.ROLE,
      resourceId: membership.roleId,
      action: 'REVOKE',
      description: `Role revoked: ${role?.name} from user ${userId}`,
    });
  }

  /**
   * Check if user has permission (with ABAC conditions)
   */
  async checkPermission(
    userId: string,
    workspaceId: string,
    check: PermissionCheck
  ): Promise<boolean> {
    const cacheKey = `perm:${userId}:${workspaceId}:${check.resource}:${check.action}:${check.resourceId || ''}`;
    let cached = await cacheRedis.get<boolean>(cacheKey);

    if (cached !== null && cached !== undefined) {
      return cached;
    }

    // Get user's effective permissions
    const permissions = await this.getUserPermissions(userId, workspaceId);

    const hasPermission = permissions.some(p => {
      // Check exact match
      if (p.resource === check.resource && p.action === check.action) return true;
      // Check MANAGE permission (implies all actions)
      if (p.resource === check.resource && p.action === PermissionAction.MANAGE) return true;
      // Check wildcard
      if (p.resource === '*' && p.action === '*') return true;

      // Check conditions if resourceId provided
      if (check.resourceId && p.condition) {
        return this.evaluateCondition(p.condition, check.resourceId, check.context || {});
      }

      return false;
    });

    await cacheRedis.set(cacheKey, hasPermission, 60); // Cache for 1 minute
    return hasPermission;
  }

  /**
   * Get all effective permissions for a user in a workspace
   */
  async getUserPermissions(userId: string, workspaceId: string): Promise<Array<{
    resource: string;
    action: string;
    condition?: Record<string, unknown>;
  }>> {
    const cacheKey = `user_perms:${userId}:${workspaceId}`;
    let cached = await cacheRedis.get<Array<{ resource: string; action: string; condition?: Record<string, unknown> }>>(cacheKey);

    if (cached) return cached;

    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      include: {
        roleRel: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
      },
    });

    if (!membership) return [];

    const permissions: Array<{ resource: string; action: string; condition?: Record<string, unknown> }> = [];

    // Add base permissions for role
    const basePermissions = this.getBasePermissions(membership.role);
    for (const perm of basePermissions) {
      const [resource, action] = perm.split(':');
      permissions.push({ resource, action });
    }

    // Add custom role permissions
    if (membership.roleRel) {
      for (const rp of membership.roleRel.permissions) {
        permissions.push({
          resource: rp.permission.resource,
          action: rp.permission.action,
          condition: rp.condition as Record<string, unknown> | undefined,
        });
      }
    }

    // Deduplicate
    const unique = permissions.filter((p, i, arr) =>
      arr.findIndex(x => x.resource === p.resource && x.action === p.action) === i
    );

    await cacheRedis.set(cacheKey, unique, this.CACHE_TTL);
    return unique;
  }

  /**
   * Validate permission strings
   */
  private async validatePermissions(permissionStrings: string[]): Promise<PermissionData[]> {
    const permissions: PermissionData[] = [];

    for (const permStr of permissionStrings) {
      const [resource, action] = permStr.split(':');
      if (!resource || !action) continue;

      const perm = await prisma.permission.findUnique({
        where: { resource_action: { resource: resource as ResourceType, action: action as PermissionAction } },
      });

      if (perm) {
        permissions.push({
          id: perm.id,
          resource: perm.resource,
          action: perm.action,
          description: perm.description,
        });
      }
    }

    return permissions;
  }

  /**
   * Evaluate ABAC condition
   */
  private evaluateCondition(
    condition: Record<string, unknown>,
    resourceId: string,
    context: Record<string, unknown>
  ): boolean {
    // Simple condition evaluation - extend as needed
    // Example condition: { ownerId: 'userId', workspaceId: 'workspaceId' }

    for (const [key, value] of Object.entries(condition)) {
      if (key === 'ownerId' && context.userId !== value) return false;
      if (key === 'workspaceId' && context.workspaceId !== value) return false;
      if (key === 'resourceId' && resourceId !== value) return false;
      // Add more condition types as needed
    }

    return true;
  }

  /**
   * Get base permissions for a system role
   */
  private getBasePermissions(role: MembershipRole): string[] {
    const permissions: Record<MembershipRole, string[]> = {
      [MembershipRole.OWNER]: ['*:*'],
      [MembershipRole.ADMIN]: [
        'WORKSPACE:READ', 'WORKSPACE:UPDATE', 'WORKSPACE:DELETE', 'WORKSPACE:MANAGE',
        'PROJECT:CREATE', 'PROJECT:READ', 'PROJECT:UPDATE', 'PROJECT:DELETE', 'PROJECT:MANAGE',
        'PAGE:CREATE', 'PAGE:READ', 'PAGE:UPDATE', 'PAGE:DELETE', 'PAGE:MANAGE', 'PAGE:SHARE',
        'BLOCK:CREATE', 'BLOCK:READ', 'BLOCK:UPDATE', 'BLOCK:DELETE', 'BLOCK:MANAGE',
        'DATABASE:CREATE', 'DATABASE:READ', 'DATABASE:UPDATE', 'DATABASE:DELETE', 'DATABASE:MANAGE',
        'AUTOMATION:CREATE', 'AUTOMATION:READ', 'AUTOMATION:UPDATE', 'AUTOMATION:DELETE', 'AUTOMATION:MANAGE', 'AUTOMATION:EXECUTE',
        'TEMPLATE:CREATE', 'TEMPLATE:READ', 'TEMPLATE:UPDATE', 'TEMPLATE:DELETE', 'TEMPLATE:MANAGE',
        'INTEGRATION:CREATE', 'INTEGRATION:READ', 'INTEGRATION:UPDATE', 'INTEGRATION:DELETE', 'INTEGRATION:MANAGE',
        'WEBHOOK:CREATE', 'WEBHOOK:READ', 'WEBHOOK:UPDATE', 'WEBHOOK:DELETE', 'WEBHOOK:MANAGE',
        'API_KEY:CREATE', 'API_KEY:READ', 'API_KEY:UPDATE', 'API_KEY:DELETE', 'API_KEY:MANAGE',
        'SECRET:CREATE', 'SECRET:READ', 'SECRET:UPDATE', 'SECRET:DELETE', 'SECRET:MANAGE',
        'USER:READ', 'USER:UPDATE', 'USER:MANAGE',
        'ROLE:CREATE', 'ROLE:READ', 'ROLE:UPDATE', 'ROLE:DELETE', 'ROLE:MANAGE',
        'AUDIT_LOG:READ', 'AUDIT_LOG:EXPORT',
        'SESSION:READ', 'SESSION:MANAGE',
        'DEVICE:READ', 'DEVICE:MANAGE',
        'IP_ALLOWLIST:CREATE', 'IP_ALLOWLIST:READ', 'IP_ALLOWLIST:UPDATE', 'IP_ALLOWLIST:DELETE', 'IP_ALLOWLIST:MANAGE',
        'SSO_CONFIG:CREATE', 'SSO_CONFIG:READ', 'SSO_CONFIG:UPDATE', 'SSO_CONFIG:DELETE', 'SSO_CONFIG:MANAGE',
        'SCIM_CONFIG:CREATE', 'SCIM_CONFIG:READ', 'SCIM_CONFIG:UPDATE', 'SCIM_CONFIG:DELETE', 'SCIM_CONFIG:MANAGE',
        'COMPLIANCE_REPORT:CREATE', 'COMPLIANCE_REPORT:READ', 'COMPLIANCE_REPORT:MANAGE',
        'RETENTION_POLICY:CREATE', 'RETENTION_POLICY:READ', 'RETENTION_POLICY:UPDATE', 'RETENTION_POLICY:DELETE', 'RETENTION_POLICY:MANAGE',
      ],
      [MembershipRole.MEMBER]: [
        'WORKSPACE:READ', 'PROJECT:CREATE', 'PROJECT:READ', 'PROJECT:UPDATE',
        'PAGE:CREATE', 'PAGE:READ', 'PAGE:UPDATE', 'PAGE:SHARE',
        'BLOCK:CREATE', 'BLOCK:READ', 'BLOCK:UPDATE',
        'DATABASE:CREATE', 'DATABASE:READ', 'DATABASE:UPDATE',
        'AUTOMATION:CREATE', 'AUTOMATION:READ', 'AUTOMATION:UPDATE', 'AUTOMATION:EXECUTE',
        'TEMPLATE:READ', 'TEMPLATE:CREATE', 'INTEGRATION:READ', 'WEBHOOK:READ',
        'API_KEY:CREATE', 'API_KEY:READ', 'SECRET:READ', 'USER:READ', 'ROLE:READ',
        'SESSION:READ', 'DEVICE:READ',
      ],
      [MembershipRole.VIEWER]: [
        'WORKSPACE:READ', 'PROJECT:READ', 'PAGE:READ', 'BLOCK:READ',
        'DATABASE:READ', 'AUTOMATION:READ', 'TEMPLATE:READ', 'INTEGRATION:READ',
        'WEBHOOK:READ', 'USER:READ', 'ROLE:READ',
      ],
      [MembershipRole.GUEST]: ['PAGE:READ', 'BLOCK:READ'],
      [MembershipRole.CUSTOM]: [],
    };
    return permissions[role] || [];
  }

  /**
   * Format role for API response
   */
  private formatRole(role: any): RoleData {
    return {
      id: role.id,
      workspaceId: role.workspaceId,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      isDefault: role.isDefault,
      priority: role.priority,
      conditions: role.conditions as Record<string, unknown> || {},
      permissions: role.permissions?.map((rp: any) => ({
        id: rp.permission.id,
        resource: rp.permission.resource,
        action: rp.permission.action,
        description: rp.permission.description,
        condition: rp.condition as Record<string, unknown> | undefined,
      })) || [],
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  /**
   * Invalidate role cache
   */
  private async invalidateRoleCache(workspaceId: string): Promise<void> {
    await cacheRedis.delete(`roles:${workspaceId}`);
    // Also invalidate individual role caches
    const roles = await prisma.role.findMany({ where: { workspaceId }, select: { id: true } });
    for (const role of roles) {
      await cacheRedis.delete(`role:${workspaceId}:${role.id}`);
    }
  }

  /**
   * Invalidate user permission cache
   */
  private async invalidateUserPermissionCache(userId: string, workspaceId: string): Promise<void> {
    await cacheRedis.delete(`user_perms:${userId}:${workspaceId}`);
    // Invalidate specific permission checks
    await cacheRedis.deletePattern(`perm:${userId}:${workspaceId}:*`);
  }

  /**
   * Initialize system roles and permissions
   */
  async initializeSystemRoles(workspaceId: string): Promise<void> {
    // Ensure all permissions exist
    const allPermissions: Array<{ resource: ResourceType; action: PermissionAction; description: string }> = [];

    for (const resource of Object.values(ResourceType)) {
      for (const action of Object.values(PermissionAction)) {
        allPermissions.push({ resource, action, description: `${action} ${resource}` });
      }
    }

    for (const perm of allPermissions) {
      await prisma.permission.upsert({
        where: { resource_action: { resource: perm.resource, action: perm.action } },
        update: { description: perm.description },
        create: perm,
      });
    }

    // Create system roles
    const systemRoles = [
      { name: 'Owner', role: MembershipRole.OWNER, priority: 100, isDefault: false },
      { name: 'Admin', role: MembershipRole.ADMIN, priority: 80, isDefault: false },
      { name: 'Member', role: MembershipRole.MEMBER, priority: 50, isDefault: true },
      { name: 'Viewer', role: MembershipRole.VIEWER, priority: 20, isDefault: false },
      { name: 'Guest', role: MembershipRole.GUEST, priority: 10, isDefault: false },
    ];

    for (const sysRole of systemRoles) {
      const existing = await prisma.role.findFirst({
        where: { workspaceId, name: sysRole.name },
      });

      if (!existing) {
        const role = await prisma.role.create({
          data: {
            workspaceId,
            name: sysRole.name,
            isSystem: true,
            isDefault: sysRole.isDefault,
            priority: sysRole.priority,
          },
        });

        // Assign base permissions
        const basePermissions = this.getBasePermissions(sysRole.role);
        const validPermissions = await this.validatePermissions(basePermissions);

        await prisma.rolePermission.createMany({
          data: validPermissions.map(p => ({
            roleId: role.id,
            permissionId: p.id,
            grantedBy: 'system',
          })),
          skipDuplicates: true,
        });
      }
    }
  }
}

export const rbacService = new RbacService();