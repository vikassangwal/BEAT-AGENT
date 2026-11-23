import { prisma } from '../db/prisma';
import { sessionRedis, rateLimitRedis } from '../db/redis';
import { hashPassword, verifyPassword, generateSecureRandom, hashToken, generateDeviceFingerprint, generateMfaSecret, generateMfaBackupCodes, hashMfaBackupCode, verifyMfaBackupCode } from '../utils/crypto';
import { signAccessToken, signRefreshToken, createTokenPair, verifyRefreshToken, extractTokenFromHeader } from '../utils/jwt';
import { config } from '../config';
import { auditService, AuditEventType, AuditSeverity } from './auditService';
import { UserStatus, MembershipRole, SessionStatus, DeviceType, AuthProvider } from '@prisma/client';
import { GeoLocation } from '@shared/types';
import { Request } from 'express';

export interface LoginInput {
  email: string;
  password: string;
  workspaceId?: string;
  mfaCode?: string;
  rememberMe?: boolean;
  ipAddress: string;
  userAgent: string;
  location?: GeoLocation;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  workspaceId?: string;
  inviteToken?: string;
  ipAddress: string;
  userAgent: string;
  location?: GeoLocation;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
    mfaEnabled: boolean;
    status: string;
  };
  workspace?: {
    id: string;
    name: string;
    slug: string;
    role: string;
    permissions: string[];
  };
}

export interface SessionData {
  id: string;
  userId: string;
  workspaceId: string | null;
  tokenHash: string;
  refreshTokenHash: string;
  status: SessionStatus;
  ipAddress: string;
  userAgent: string;
  deviceId: string | null;
  location: GeoLocation | null;
  expiresAt: Date;
  lastActivityAt: Date;
}

class AuthService {
  private readonly SESSION_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
  private readonly REFRESH_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
  private readonly MAX_CONCURRENT_SESSIONS = 10;

  /**
   * Register a new user
   */
  async register(input: RegisterInput): Promise<TokenPair> {
    const { email, password, name, workspaceId, inviteToken, ipAddress, userAgent, location } = input;

    // Check rate limit
    await this.checkRateLimit(`register:${ipAddress}`, 5, 15 * 60 * 1000);

    // Check if user exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new Error('EMAIL_ALREADY_EXISTS');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        authProvider: AuthProvider.LOCAL,
        status: UserStatus.ACTIVE,
        emailVerified: new Date(),
      },
    });

    // Create workspace if not provided
    let workspace = workspaceId ? await prisma.workspace.findUnique({ where: { id: workspaceId } }) : null;
    let membershipRole = MembershipRole.MEMBER;

    if (!workspace) {
      workspace = await prisma.workspace.create({
        data: {
          name: `${name || email.split('@')[0]}'s Workspace`,
          slug: generateSecureRandom(8).toLowerCase(),
          ownerId: user.id,
        },
      });
      membershipRole = MembershipRole.OWNER;
    }

    // Create membership
    await prisma.membership.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: membershipRole,
        acceptedAt: new Date(),
      },
    });

    // Create session
    const { accessToken, refreshToken, session } = await this.createSession({
      userId: user.id,
      workspaceId: workspace.id,
      ipAddress,
      userAgent,
      location,
      rememberMe: true,
    });

    // Audit log
    await auditService.logImmediate({
      workspaceId: workspace.id,
      userId: user.id,
      performedBy: user.id,
      eventType: AuditEventType.LOGIN_SUCCESS,
      severity: AuditSeverity.INFO,
      description: 'User registered and logged in',
      ipAddress,
      userAgent,
      location,
      correlationId: session.id,
    });

    return this.buildTokenResponse(user, workspace, membershipRole, accessToken, refreshToken);
  }

  /**
   * Login with email/password
   */
  async login(input: LoginInput): Promise<TokenPair> {
    const { email, password, workspaceId, mfaCode, rememberMe, ipAddress, userAgent, location } = input;

    // Check rate limit
    await this.checkRateLimit(`login:${ipAddress}`, 10, 15 * 60 * 1000);
    await this.checkRateLimit(`login:${email}`, 5, 15 * 60 * 1000);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: workspaceId ? { workspaceId } : { isActive: true },
          include: { workspace: true, roleRel: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });

    if (!user) {
      await auditService.logImmediate({
        workspaceId: workspaceId || 'unknown',
        eventType: AuditEventType.LOGIN_FAILED,
        severity: AuditSeverity.LOW,
        description: `Login failed: user not found (${email})`,
        ipAddress,
        userAgent,
        location,
      });
      throw new Error('INVALID_CREDENTIALS');
    }

    // Check account status
    if (user.status !== UserStatus.ACTIVE) {
      throw new Error(`ACCOUNT_${user.status}`);
    }

    // Check password
    if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      // Increment failed attempts
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: { increment: 1 },
          lockedUntil: user.failedLoginAttempts >= 4 ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });

      await auditService.logImmediate({
        workspaceId: workspaceId || user.memberships[0]?.workspaceId || 'unknown',
        userId: user.id,
        eventType: AuditEventType.LOGIN_FAILED,
        severity: AuditSeverity.LOW,
        description: 'Login failed: invalid password',
        ipAddress,
        userAgent,
        location,
      });

      throw new Error('INVALID_CREDENTIALS');
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new Error('ACCOUNT_LOCKED');
    }

    // Reset failed attempts on successful login
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress,
      },
    });

    // Check MFA
    if (user.mfaEnabled) {
      if (!mfaCode) {
        throw new Error('MFA_REQUIRED');
      }
      // Verify MFA code (implement TOTP verification)
      const mfaValid = await this.verifyMfaCode(user.id, mfaCode);
      if (!mfaValid) {
        await auditService.logImmediate({
          workspaceId: workspaceId || user.memberships[0]?.workspaceId || 'unknown',
          userId: user.id,
          eventType: AuditEventType.MFA_CHALLENGE_FAILED,
          severity: AuditSeverity.HIGH,
          description: 'MFA challenge failed',
          ipAddress,
          userAgent,
          location,
        });
        throw new Error('INVALID_MFA_CODE');
      }

      await auditService.logImmediate({
        workspaceId: workspaceId || user.memberships[0]?.workspaceId || 'unknown',
        userId: user.id,
        eventType: AuditEventType.MFA_CHALLENGE_SUCCESS,
        severity: AuditSeverity.INFO,
        description: 'MFA challenge successful',
        ipAddress,
        userAgent,
        location,
      });
    }

    // Determine workspace
    let membership = user.memberships[0];
    if (workspaceId) {
      membership = user.memberships.find(m => m.workspaceId === workspaceId);
      if (!membership) {
        throw new Error('NOT_A_MEMBER');
      }
    }

    if (!membership || !membership.isActive) {
      throw new Error('NOT_A_MEMBER');
    }

    // Build permissions
    const permissions = this.buildPermissions(membership);

    // Check concurrent sessions limit
    await this.enforceConcurrentSessions(user.id, membership.workspace.maxConcurrentSessions);

    // Create session
    const { accessToken, refreshToken, session } = await this.createSession({
      userId: user.id,
      workspaceId: membership.workspaceId,
      ipAddress,
      userAgent,
      location,
      rememberMe,
    });

    // Audit log
    await auditService.logImmediate({
      workspaceId: membership.workspaceId,
      userId: user.id,
      performedBy: user.id,
      eventType: AuditEventType.LOGIN_SUCCESS,
      severity: AuditSeverity.INFO,
      description: 'User logged in',
      ipAddress,
      userAgent,
      location,
      correlationId: session.id,
    });

    return this.buildTokenResponse(user, membership.workspace, membership.role, accessToken, refreshToken, permissions);
  }

  /**
   * SSO login (SAML/OIDC)
   */
  async ssoLogin(params: {
    provider: AuthProvider;
    providerId: string;
    email: string;
    name?: string;
    avatarUrl?: string;
    workspaceId?: string;
    ipAddress: string;
    userAgent: string;
    location?: GeoLocation;
    attributes: Record<string, unknown>;
  }): Promise<TokenPair> {
    const { provider, providerId, email, name, avatarUrl, workspaceId, ipAddress, userAgent, location, attributes } = params;

    // Check rate limit
    await this.checkRateLimit(`sso:${provider}:${ipAddress}`, 20, 15 * 60 * 1000);

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { authProvider: provider, providerId },
          { email },
        ],
      },
    });

    const isNewUser = !user;

    if (isNewUser) {
      user = await prisma.user.create({
        data: {
          email,
          name,
          avatarUrl,
          authProvider: provider,
          providerId,
          status: UserStatus.ACTIVE,
          emailVerified: new Date(),
        },
      });
    } else if (user.authProvider === AuthProvider.LOCAL) {
      // Link SSO to existing local account
      await prisma.user.update({
        where: { id: user.id },
        data: { authProvider: provider, providerId, avatarUrl: avatarUrl || user.avatarUrl },
      });
    }

    // Find or create workspace membership
    let membership = user.memberships.find(m => m.workspaceId === workspaceId);
    let workspace = membership?.workspace;

    if (!membership) {
      // Check for SSO config to auto-provision
      const ssoConfig = await prisma.ssoConfig.findUnique({ where: { workspaceId: workspaceId! } });
      if (ssoConfig?.autoProvision) {
        if (!workspace) {
          workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
        }
        if (workspace) {
          membership = await prisma.membership.create({
            data: {
              userId: user.id,
              workspaceId: workspace.id,
              role: ssoConfig.defaultRole as MembershipRole,
              acceptedAt: new Date(),
            },
            include: { workspace: true },
          });
        }
      }
    }

    if (!membership || !workspace) {
      throw new Error('WORKSPACE_NOT_FOUND');
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ipAddress },
    });

    // Check concurrent sessions
    await this.enforceConcurrentSessions(user.id, workspace.maxConcurrentSessions);

    // Create session
    const { accessToken, refreshToken, session } = await this.createSession({
      userId: user.id,
      workspaceId: workspace.id,
      ipAddress,
      userAgent,
      location,
      rememberMe: true,
    });

    // Build permissions
    const permissions = this.buildPermissions(membership);

    // Audit log
    await auditService.logImmediate({
      workspaceId: workspace.id,
      userId: user.id,
      performedBy: user.id,
      eventType: isNewUser ? AuditEventType.SSO_LOGIN_SUCCESS : AuditEventType.LOGIN_SUCCESS,
      severity: AuditSeverity.INFO,
      description: isNewUser ? `SSO user created and logged in via ${provider}` : `SSO login via ${provider}`,
      ipAddress,
      userAgent,
      location,
      metadata: { provider, providerId, attributes },
      correlationId: session.id,
    });

    return this.buildTokenResponse(user, workspace, membership.role, accessToken, refreshToken, permissions);
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string, ipAddress: string, userAgent: string): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new Error('INVALID_REFRESH_TOKEN');
    }

    // Check session exists
    const sessionData = await sessionRedis.get<SessionData>(payload.sessionId);
    if (!sessionData || sessionData.status !== SessionStatus.ACTIVE) {
      throw new Error('SESSION_REVOKED');
    }

    // Verify refresh token hash matches
    const tokenHash = hashToken(refreshToken);
    if (sessionData.refreshTokenHash !== tokenHash) {
      // Token reuse detected - revoke all sessions
      await this.revokeAllUserSessions(payload.sub, 'Token reuse detected');
      throw new Error('TOKEN_REUSE_DETECTED');
    }

    // Rotate refresh token
    const newRefreshToken = generateSecureRandom(64);
    const newRefreshTokenHash = hashToken(newRefreshToken);

    // Update session
    await this.updateSession(payload.sessionId, {
      refreshTokenHash: newRefreshTokenHash,
      lastActivityAt: new Date(),
    });

    // Create new access token
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new Error('USER_NOT_FOUND');
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, workspaceId: sessionData.workspaceId, isActive: true },
      include: { roleRel: { include: { permissions: { include: { permission: true } } } } },
    });

    const permissions = membership ? this.buildPermissions(membership) : [];

    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      workspaceId: sessionData.workspaceId || undefined,
      role: membership?.role,
      permissions,
      sessionId: payload.sessionId,
      deviceId: sessionData.deviceId || undefined,
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  /**
   * Logout / revoke session
   */
  async logout(sessionId: string, userId: string, workspaceId: string, revokedBy: string, reason: string = 'User logout'): Promise<void> {
    await this.revokeSession(sessionId, revokedBy, reason);

    await auditService.logImmediate({
      workspaceId,
      userId,
      performedBy: revokedBy,
      eventType: AuditEventType.LOGOUT,
      severity: AuditSeverity.INFO,
      description: 'User logged out',
      correlationId: sessionId,
    });
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(sessionId: string, revokedBy: string, reason: string): Promise<void> {
    await prisma.session.updateMany({
      where: { id: sessionId },
      data: {
        status: SessionStatus.REVOKED,
        revokedAt: new Date(),
        revokedBy,
        revokedReason: reason,
      },
    });

    await sessionRedis.delete(sessionId);
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllUserSessions(userId: string, reason: string, excludeSessionId?: string): Promise<number> {
    const sessions = await prisma.session.findMany({
      where: { userId, status: SessionStatus.ACTIVE, ...(excludeSessionId ? { NOT: { id: excludeSessionId } } : {}) },
      select: { id: true },
    });

    for (const session of sessions) {
      await this.revokeSession(session.id, userId, reason);
    }

    return sessions.length;
  }

  /**
   * Get user sessions
   */
  async getUserSessions(userId: string, workspaceId?: string): Promise<SessionData[]> {
    return prisma.session.findMany({
      where: {
        userId,
        status: SessionStatus.ACTIVE,
        ...(workspaceId ? { workspaceId } : {}),
      },
      orderBy: { lastActivityAt: 'desc' },
    });
  }

  /**
   * Register device
   */
  async registerDevice(params: {
    userId: string;
    workspaceId: string | null;
    deviceId: string;
    name: string;
    type: DeviceType;
    os?: string;
    browser?: string;
    ipAddress: string;
    location?: GeoLocation;
    pushToken?: string;
  }): Promise<void> {
    await prisma.device.upsert({
      where: { deviceId: params.deviceId },
      update: {
        name: params.name,
        type: params.type,
        os: params.os,
        browser: params.browser,
        ipAddress: params.ipAddress,
        location: params.location as any,
        lastSeenAt: new Date(),
        isTrusted: true,
        pushToken: params.pushToken,
      },
      create: {
        userId: params.userId,
        workspaceId: params.workspaceId,
        deviceId: params.deviceId,
        name: params.name,
        type: params.type,
        os: params.os,
        browser: params.browser,
        ipAddress: params.ipAddress,
        location: params.location as any,
        isTrusted: true,
        pushToken: params.pushToken,
      },
    });

    await auditService.logImmediate({
      workspaceId: params.workspaceId || 'unknown',
      userId: params.userId,
      performedBy: params.userId,
      eventType: AuditEventType.DEVICE_REGISTERED,
      severity: AuditSeverity.INFO,
      description: `Device registered: ${params.name}`,
      ipAddress: params.ipAddress,
      metadata: { deviceId: params.deviceId, type: params.type },
    });
  }

  /**
   * Revoke device
   */
  async revokeDevice(deviceId: string, userId: string, workspaceId: string, revokedBy: string): Promise<void> {
    await prisma.device.update({
      where: { deviceId },
      data: { revokedAt: new Date(), isTrusted: false },
    });

    // Revoke all sessions for this device
    const sessions = await prisma.session.findMany({
      where: { deviceId, status: SessionStatus.ACTIVE },
      select: { id: true },
    });

    for (const session of sessions) {
      await this.revokeSession(session.id, revokedBy, 'Device revoked');
    }

    await auditService.logImmediate({
      workspaceId,
      userId,
      performedBy: revokedBy,
      eventType: AuditEventType.DEVICE_REVOKED,
      severity: AuditSeverity.INFO,
      description: 'Device revoked',
      metadata: { deviceId },
    });
  }

  /**
   * Enable MFA
   */
  async enableMfa(userId: string): Promise<{ secret: string; backupCodes: string[] }> {
    const secret = generateMfaSecret();
    const backupCodes = generateMfaBackupCodes();
    const hashedBackupCodes = backupCodes.map(code => hashMfaBackupCode(code));

    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: true,
        mfaSecret: secret,
        mfaBackupCodes: hashedBackupCodes,
      },
    });

    return { secret, backupCodes };
  }

  /**
   * Disable MFA
   */
  async disableMfa(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: [],
      },
    });
  }

  /**
   * Verify MFA code (TOTP)
   */
  async verifyMfaCode(userId: string, code: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { mfaSecret: true, mfaBackupCodes: true } });
    if (!user?.mfaSecret) return false;

    // Check backup codes first
    for (const hashedCode of user.mfaBackupCodes) {
      if (verifyMfaBackupCode(code, hashedCode)) {
        // Remove used backup code
        await prisma.user.update({
          where: { id: userId },
          data: { mfaBackupCodes: user.mfaBackupCodes.filter(c => c !== hashedCode) },
        });
        return true;
      }
    }

    // Verify TOTP (implement with otplib or similar)
    // For now, return true for demo
    return true;
  }

  /**
   * Change password
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string, ipAddress: string, workspaceId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw new Error('NO_PASSWORD_SET');

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new Error('INVALID_CURRENT_PASSWORD');
    }

    const newPasswordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });

    // Revoke all other sessions
    await this.revokeAllUserSessions(userId, 'Password changed', (await this.getUserSessions(userId))[0]?.id);

    await auditService.logImmediate({
      workspaceId,
      userId,
      performedBy: userId,
      eventType: AuditEventType.PASSWORD_CHANGED,
      severity: AuditSeverity.MEDIUM,
      description: 'Password changed',
      ipAddress,
    });
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string, ipAddress: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return null; // Don't reveal if email exists

    const resetToken = generateSecureRandom(32);
    const resetTokenHash = hashToken(resetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: {
        // Store reset token hash and expiry (add fields to schema if needed)
      },
    });

    await auditService.logImmediate({
      workspaceId: user.memberships[0]?.workspaceId || 'unknown',
      userId: user.id,
      eventType: AuditEventType.PASSWORD_RESET_REQUESTED,
      severity: AuditSeverity.INFO,
      description: 'Password reset requested',
      ipAddress,
    });

    return resetToken; // In production, send via email
  }

  /**
   * Reset password
   */
  async resetPassword(token: string, newPassword: string, ipAddress: string): Promise<void> {
    // Verify token (would need to store token hash in DB)
    // For now, implement basic version
    const newPasswordHash = await hashPassword(newPassword);
    // Update user password
    // Invalidate token
  }

  /**
   * Create session
   */
  private async createSession(params: {
    userId: string;
    workspaceId: string;
    ipAddress: string;
    userAgent: string;
    location?: GeoLocation;
    rememberMe?: boolean;
  }): Promise<{ accessToken: string; refreshToken: string; session: SessionData }> {
    const sessionId = generateSecureRandom(16);
    const deviceId = generateDeviceFingerprint(params.userAgent, params.ipAddress);
    const accessToken = generateSecureRandom(64);
    const refreshToken = generateSecureRandom(64);

    const tokenHash = hashToken(accessToken);
    const refreshTokenHash = hashToken(refreshToken);

    const expiresAt = new Date(Date.now() + (params.rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000);

    const session = await prisma.session.create({
      data: {
        id: sessionId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        tokenHash,
        refreshTokenHash,
        status: SessionStatus.ACTIVE,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        deviceId,
        location: params.location as any,
        expiresAt,
        lastActivityAt: new Date(),
      },
    });

    // Store in Redis
    await sessionRedis.set(sessionId, {
      id: session.id,
      workspaceId: session.workspaceId,
      deviceId: session.deviceId,
      status: session.status,
    }, this.SESSION_TTL);

    // Register device
    await this.registerDevice({
      userId: params.userId,
      workspaceId: params.workspaceId,
      deviceId,
      name: this.parseUserAgent(params.userAgent),
      type: this.getDeviceType(params.userAgent),
      ipAddress: params.ipAddress,
      location: params.location,
    });

    // Get user and membership for token
    const user = await prisma.user.findUnique({ where: { id: params.userId } });
    const membership = await prisma.membership.findFirst({
      where: { userId: params.userId, workspaceId: params.workspaceId, isActive: true },
      include: { roleRel: { include: { permissions: { include: { permission: true } } } } },
    });

    const permissions = membership ? this.buildPermissions(membership) : [];

    const jwtAccessToken = signAccessToken({
      sub: user!.id,
      email: user!.email,
      workspaceId: params.workspaceId,
      role: membership?.role,
      permissions,
      sessionId,
      deviceId,
    });

    const jwtRefreshToken = signRefreshToken({
      sub: user!.id,
      sessionId,
      tokenVersion: 1,
    });

    return { accessToken: jwtAccessToken, refreshToken: jwtRefreshToken, session };
  }

  /**
   * Update session
   */
  private async updateSession(sessionId: string, data: Partial<SessionData>): Promise<void> {
    await prisma.session.update({ where: { id: sessionId }, data });

    const sessionData = await sessionRedis.get<SessionData>(sessionId);
    if (sessionData) {
      await sessionRedis.set(sessionId, { ...sessionData, ...data }, this.SESSION_TTL);
    }
  }

  /**
   * Build permissions array from membership
   */
  private buildPermissions(membership: any): string[] {
    const basePermissions = this.getBasePermissions(membership.role);
    const rolePermissions = membership.roleRel?.permissions.map((rp: any) => `${rp.permission.resource}:${rp.permission.action}`) || [];
    return [...new Set([...basePermissions, ...rolePermissions])];
  }

  /**
   * Get base permissions for role
   */
  private getBasePermissions(role: MembershipRole): string[] {
    // Same as in workspaceAccess.ts
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
   * Enforce concurrent session limit
   */
  private async enforceConcurrentSessions(userId: string, maxSessions: number): Promise<void> {
    const activeSessions = await prisma.session.count({
      where: { userId, status: SessionStatus.ACTIVE },
    });

    if (activeSessions >= maxSessions) {
      // Revoke oldest session
      const oldestSession = await prisma.session.findFirst({
        where: { userId, status: SessionStatus.ACTIVE },
        orderBy: { lastActivityAt: 'asc' },
      });

      if (oldestSession) {
        await this.revokeSession(oldestSession.id, userId, 'Concurrent session limit exceeded');

        await auditService.logImmediate({
          workspaceId: oldestSession.workspaceId || 'unknown',
          userId,
          performedBy: userId,
          eventType: AuditEventType.CONCURRENT_SESSION_LIMIT_EXCEEDED,
          severity: AuditSeverity.MEDIUM,
          description: `Concurrent session limit (${maxSessions}) exceeded, oldest session revoked`,
          correlationId: oldestSession.id,
        });
      }
    }
  }

  /**
   * Check rate limit
   */
  private async checkRateLimit(key: string, maxRequests: number, windowMs: number): Promise<void> {
    const { count } = await rateLimitRedis.increment(key, windowMs);
    if (count > maxRequests) {
      throw new Error('RATE_LIMITED');
    }
  }

  /**
   * Build token response
   */
  private buildTokenResponse(
    user: any,
    workspace: any,
    role: MembershipRole,
    accessToken: string,
    refreshToken: string,
    permissions?: string[]
  ): TokenPair {
    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        mfaEnabled: user.mfaEnabled,
        status: user.status,
      },
      workspace: workspace ? {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        role,
        permissions: permissions || this.getBasePermissions(role),
      } : undefined,
    };
  }

  /**
   * Parse user agent for device name
   */
  private parseUserAgent(ua: string): string {
    if (ua.includes('Mobile')) return 'Mobile Device';
    if (ua.includes('Tablet')) return 'Tablet';
    return 'Desktop';
  }

  /**
   * Get device type from user agent
   */
  private getDeviceType(ua: string): DeviceType {
    if (ua.includes('Mobile')) return DeviceType.MOBILE;
    if (ua.includes('Tablet')) return DeviceType.TABLET;
    return DeviceType.DESKTOP;
  }

  /**
   * Get user devices
   */
  async getUserDevices(userId: string, workspaceId?: string): Promise<any[]> {
    const where: any = { userId };
    if (workspaceId) where.workspaceId = workspaceId;

    return prisma.device.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}

export const authService = new AuthService();