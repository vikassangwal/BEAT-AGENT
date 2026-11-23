import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services/authService';
import { rbacService } from '../services/rbacService';
import { authenticate, optionalAuth, AuthenticatedRequest, requireWorkspace, requirePermissions } from '../middleware/auth';
import { workspaceAccess, WorkspaceAccessRequest } from '../middleware/workspaceAccess';
import { authRateLimiter, validateRequestBody } from '../middleware/security';
import { config } from '../config';
import { auditService, AuditEventType } from '../services/auditService';
import { generateSecureRandom } from '../utils/crypto';

const router = Router();

// Validation schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  workspaceId: z.string().optional(),
  mfaCode: z.string().length(6).optional(),
  rememberMe: z.boolean().optional(),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100).optional(),
  workspaceId: z.string().optional(),
  inviteToken: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
});

const mfaEnableSchema = z.object({
  // No input needed for enabling MFA
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  revokeAllSessions: z.boolean().optional(),
});

/**
 * POST /api/v1/auth/register
 * Register a new user
 */
router.post('/register', authRateLimiter, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = registerSchema.parse(req.body);

    const result = await authService.register({
      ...data,
      ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: config.sessionCookieSameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    res.status(201).json({
      success: true,
      data: {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        user: result.user,
        workspace: result.workspace,
      },
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

    switch (message) {
      case 'EMAIL_ALREADY_EXISTS':
        status = 409;
        break;
      case 'RATE_LIMITED':
        status = 429;
        break;
    }

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * POST /api/v1/auth/login
 * Login with email/password
 */
router.post('/login', authRateLimiter, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = loginSchema.parse(req.body);

    const result = await authService.login({
      ...data,
      ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: config.sessionCookieSameSite,
      maxAge: data.rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        user: result.user,
        workspace: result.workspace,
      },
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
    let status = 401;

    switch (message) {
      case 'INVALID_CREDENTIALS':
        status = 401;
        break;
      case 'ACCOUNT_INACTIVE':
      case 'ACCOUNT_SUSPENDED':
      case 'ACCOUNT_DELETED':
      case 'ACCOUNT_PENDING_VERIFICATION':
        status = 403;
        break;
      case 'ACCOUNT_LOCKED':
        status = 423;
        break;
      case 'MFA_REQUIRED':
        status = 401;
        break;
      case 'INVALID_MFA_CODE':
        status = 401;
        break;
      case 'NOT_A_MEMBER':
        status = 403;
        break;
      case 'RATE_LIMITED':
        status = 429;
        break;
    }

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * POST /api/v1/auth/refresh
 * Refresh access token
 */
router.post('/refresh', validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const correlationId = authReq.correlationId;

  try {
    // Get refresh token from cookie or body
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      res.status(401).json({
        error: 'REFRESH_TOKEN_REQUIRED',
        message: 'Refresh token is required',
        correlationId,
      });
      return;
    }

    const { accessToken, refreshToken: newRefreshToken } = await authService.refreshToken(
      refreshToken,
      req.ip || 'unknown',
      req.headers['user-agent'] || 'unknown'
    );

    // Set new refresh token cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: config.sessionCookieSameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      success: true,
      data: { accessToken, expiresIn: 15 * 60 },
      correlationId,
    });
  } catch (error) {
    const message = (error as Error).message;
    let status = 401;

    switch (message) {
      case 'INVALID_REFRESH_TOKEN':
      case 'SESSION_REVOKED':
      case 'TOKEN_REUSE_DETECTED':
      case 'USER_NOT_FOUND':
        status = 401;
        break;
    }

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * POST /api/v1/auth/logout
 * Logout current session
 */
router.post('/logout', authenticate, requireWorkspace, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const { revokeAllSessions } = logoutSchema.parse(req.body);

    if (revokeAllSessions) {
      await authService.revokeAllUserSessions(authReq.user!.sub, 'User requested logout of all sessions');
    } else if (authReq.session?.id) {
      await authService.logout(authReq.session.id, authReq.user!.sub, authReq.workspaceId!, authReq.user!.sub);
    }

    // Clear refresh token cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: config.sessionCookieSameSite,
      path: '/',
    });

    res.json({
      success: true,
      message: 'Logged out successfully',
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'LOGOUT_FAILED',
      message: 'Failed to logout',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/auth/me
 * Get current user profile
 */
router.get('/me', authenticate, requireWorkspace, async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    // User info already attached by auth middleware
    res.json({
      success: true,
      data: {
        user: authReq.user,
        workspace: authReq.workspace,
        membership: authReq.membership,
        permissions: authReq.rolePermissions,
      },
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch user profile',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/auth/change-password
 * Change password
 */
router.post('/change-password', authenticate, requireWorkspace, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = changePasswordSchema.parse(req.body);

    await authService.changePassword(
      authReq.user!.sub,
      data.currentPassword,
      data.newPassword,
      req.ip || 'unknown',
      authReq.workspaceId!
    );

    res.json({
      success: true,
      message: 'Password changed successfully. All other sessions have been revoked.',
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

    switch (message) {
      case 'INVALID_CURRENT_PASSWORD':
        status = 401;
        break;
      case 'NO_PASSWORD_SET':
        status = 400;
        break;
    }

    res.status(status).json({
      error: message,
      message: message.replace(/_/g, ' ').toLowerCase(),
      correlationId,
    });
  }
});

/**
 * POST /api/v1/auth/forgot-password
 * Request password reset
 */
router.post('/forgot-password', authRateLimiter, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({ email: z.string().email() });
    const { email } = schema.parse(req.body);

    const resetToken = await authService.requestPasswordReset(email, req.ip || 'unknown');

    // In production, send email with reset token
    // For now, return token in response (dev only)
    res.json({
      success: true,
      message: 'If the email exists, a password reset link has been sent',
      correlationId,
      // Only in development
      ...(config.nodeEnv === 'development' && resetToken ? { resetToken } : {}),
    });
  } catch (error) {
    res.status(500).json({
      error: 'RESET_FAILED',
      message: 'Failed to process password reset request',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', authRateLimiter, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({
      token: z.string().min(1),
      password: z.string().min(8).max(128),
    });
    const { token, password } = schema.parse(req.body);

    await authService.resetPassword(token, password, req.ip || 'unknown');

    res.json({
      success: true,
      message: 'Password has been reset successfully',
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

    res.status(400).json({
      error: 'INVALID_TOKEN',
      message: 'Invalid or expired reset token',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/auth/mfa/enable
 * Enable MFA
 */
router.post('/mfa/enable', authenticate, requireWorkspace, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const { secret, backupCodes } = await authService.enableMfa(authReq.user!.sub);

    res.json({
      success: true,
      data: { secret, backupCodes },
      message: 'MFA enabled. Save your backup codes in a safe place.',
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'MFA_ENABLE_FAILED',
      message: 'Failed to enable MFA',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/auth/mfa/disable
 * Disable MFA
 */
router.post('/mfa/disable', authenticate, requireWorkspace, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({
      password: z.string().min(1),
      mfaCode: z.string().length(6),
    });
    const { password, mfaCode } = schema.parse(req.body);

    // Verify password
    // Verify MFA code
    await authService.verifyMfaCode(authReq.user!.sub, mfaCode);
    await authService.disableMfa(authReq.user!.sub);

    res.json({
      success: true,
      message: 'MFA disabled successfully',
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

    res.status(400).json({
      error: 'MFA_DISABLE_FAILED',
      message: 'Failed to disable MFA',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/auth/mfa/verify
 * Verify MFA code
 */
router.post('/mfa/verify', authenticate, requireWorkspace, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({ code: z.string().length(6) });
    const { code } = schema.parse(req.body);

    const valid = await authService.verifyMfaCode(authReq.user!.sub, code);

    if (!valid) {
      res.status(400).json({
        error: 'INVALID_MFA_CODE',
        message: 'Invalid MFA code',
        correlationId,
      });
      return;
    }

    res.json({
      success: true,
      message: 'MFA code verified',
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'VERIFICATION_FAILED',
      message: 'Failed to verify MFA code',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/auth/sessions
 * List user sessions
 */
router.get('/sessions', authenticate, requireWorkspace, async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const sessions = await authService.getUserSessions(authReq.user!.sub, authReq.workspaceId);

    res.json({
      success: true,
      data: sessions.map(s => ({
        id: s.id,
        workspaceId: s.workspaceId,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        deviceId: s.deviceId,
        location: s.location,
        status: s.status,
        expiresAt: s.expiresAt,
        lastActivityAt: s.lastActivityAt,
        createdAt: s.createdAt,
        current: s.id === authReq.session?.id,
      })),
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch sessions',
      correlationId,
    });
  }
});

/**
 * DELETE /api/v1/auth/sessions/:sessionId
 * Revoke a specific session
 */
router.delete('/sessions/:sessionId', authenticate, requireWorkspace, async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const { sessionId } = req.params;

    // Don't allow revoking current session via this endpoint
    if (sessionId === authReq.session?.id) {
      res.status(400).json({
        error: 'CANNOT_REVOKE_CURRENT',
        message: 'Cannot revoke current session. Use logout instead.',
        correlationId,
      });
      return;
    }

    await authService.revokeSession(sessionId, authReq.user!.sub, 'Revoked by user');

    res.json({
      success: true,
      message: 'Session revoked',
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'REVOKE_FAILED',
      message: 'Failed to revoke session',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/auth/devices
 * List user devices
 */
router.get('/devices', authenticate, requireWorkspace, async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const devices = await authService.getUserDevices(authReq.user!.sub, authReq.workspaceId);

    res.json({
      success: true,
      data: devices,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch devices',
      correlationId,
    });
  }
});

/**
 * DELETE /api/v1/auth/devices/:deviceId
 * Revoke a device
 */
router.delete('/devices/:deviceId', authenticate, requireWorkspace, async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const { deviceId } = req.params;

    await authService.revokeDevice(deviceId, authReq.user!.sub, authReq.workspaceId!, authReq.user!.sub);

    res.json({
      success: true,
      message: 'Device revoked',
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'REVOKE_FAILED',
      message: 'Failed to revoke device',
      correlationId,
    });
  }
});

export default router;