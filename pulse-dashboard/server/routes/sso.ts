import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ssoService } from '../services/ssoService';
import { authenticate, AuthenticatedRequest, requireWorkspace, requireWorkspaceAdmin } from '../middleware/auth';
import { workspaceAccess, WorkspaceAccessRequest } from '../middleware/workspaceAccess';
import { validateRequestBody } from '../middleware/security';
import { config } from '../config';
import { auditService, AuditEventType, AuthProvider } from '../services/auditService';
import { generateSecureRandom } from '../utils/crypto';

const router = Router();

// Validation schemas
const ssoConfigSchema = z.object({
  provider: z.enum(['SAML', 'OIDC', 'GOOGLE', 'MICROSOFT', 'OKTA', 'AUTH0', 'KEYCLOAK']),
  // SAML
  samlEntryPoint: z.string().url().optional(),
  samlIssuer: z.string().optional(),
  samlCert: z.string().optional(),
  samlPrivateKey: z.string().optional(),
  samlCallbackUrl: z.string().url().optional(),
  samlAttributeMapping: z.record(z.string()).optional(),
  samlNameIdFormat: z.string().optional(),
  samlForceAuthn: z.boolean().optional(),
  samlAllowIdpInitiated: z.boolean().optional(),
  // OIDC
  oidcClientId: z.string().optional(),
  oidcClientSecret: z.string().optional(),
  oidcIssuer: z.string().url().optional(),
  oidcDiscoveryUrl: z.string().url().optional(),
  oidcScopes: z.array(z.string()).optional(),
  oidcPkceEnabled: z.boolean().optional(),
  oidcAttributeMapping: z.record(z.string()).optional(),
  // General
  autoProvision: z.boolean().optional(),
  defaultRole: z.string().optional(),
  domainWhitelist: z.array(z.string()).optional(),
  attributeMapping: z.record(z.string()).optional(),
});

/**
 * GET /api/v1/sso/config
 * Get SSO configuration for workspace
 */
router.get('/config', authenticate, requireWorkspace, requireWorkspaceAdmin, async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const config = await ssoService.getSsoConfig(authReq.workspaceId!);

    // Don't return sensitive fields
    const safeConfig = config ? {
      ...config,
      samlPrivateKey: config.samlPrivateKey ? '[REDACTED]' : undefined,
      oidcClientSecret: config.oidcClientSecret ? '[REDACTED]' : undefined,
    } : null;

    res.json({
      success: true,
      data: safeConfig,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'FETCH_FAILED',
      message: 'Failed to fetch SSO configuration',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/sso/config
 * Configure SSO for workspace
 */
router.post('/config', authenticate, requireWorkspace, requireWorkspaceAdmin, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const data = ssoConfigSchema.parse(req.body);

    await ssoService.configureSso({
      workspaceId: authReq.workspaceId!,
      ...data,
    }, authReq.user!.sub);

    res.json({
      success: true,
      message: 'SSO configuration saved',
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
      error: 'CONFIG_FAILED',
      message: 'Failed to configure SSO',
      correlationId,
    });
  }
});

/**
 * PUT /api/v1/sso/enable
 * Enable or disable SSO
 */
router.put('/enable', authenticate, requireWorkspace, requireWorkspaceAdmin, validateRequestBody(), async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const schema = z.object({ enabled: z.boolean() });
    const { enabled } = schema.parse(req.body);

    await ssoService.setSsoEnabled(authReq.workspaceId!, enabled, authReq.user!.sub);

    res.json({
      success: true,
      message: `SSO ${enabled ? 'enabled' : 'disabled'}`,
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
      error: 'UPDATE_FAILED',
      message: 'Failed to update SSO status',
      correlationId,
    });
  }
});

/**
 * POST /api/v1/sso/test
 * Test SSO configuration
 */
router.post('/test', authenticate, requireWorkspace, requireWorkspaceAdmin, async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const result = await ssoService.testSsoConfig(authReq.workspaceId!);

    res.json({
      success: true,
      data: result,
      correlationId,
    });
  } catch (error) {
    res.status(500).json({
      error: 'TEST_FAILED',
      message: 'Failed to test SSO configuration',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/sso/metadata
 * Get SAML metadata XML
 */
router.get('/metadata', authenticate, requireWorkspace, async (req: Request, res: Response) => {
  const authReq = req as WorkspaceAccessRequest;
  const correlationId = authReq.correlationId;

  try {
    const metadata = await ssoService.getSamlMetadata(authReq.workspaceId!);

    res.set('Content-Type', 'application/xml');
    res.send(metadata);
  } catch (error) {
    res.status(404).json({
      error: 'METADATA_NOT_FOUND',
      message: 'SAML metadata not available',
      correlationId,
    });
  }
});

/**
 * GET /api/v1/sso/login
 * Initiate SSO login
 */
router.get('/login', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    const { workspaceId, returnUrl } = req.query;

    if (!workspaceId) {
      res.status(400).json({
        error: 'WORKSPACE_REQUIRED',
        message: 'Workspace ID is required',
        correlationId,
      });
      return;
    }

    const result = await ssoService.initiateLogin(workspaceId as string, returnUrl as string);

    // Redirect to SSO provider
    res.redirect(result.url);
  } catch (error) {
    const message = (error as Error).message;
    let status = 500;

    switch (message) {
      case 'SSO_NOT_CONFIGURED':
        status = 404;
        break;
      case 'UNSUPPORTED_PROVIDER':
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
 * GET /api/v1/sso/callback
 * Handle SSO callback (SAML POST, OIDC GET)
 */
router.all('/callback', async (req: Request, res: Response) => {
  const correlationId = req.headers['x-correlation-id'] as string || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('x-correlation-id', correlationId);

  try {
    // Determine provider from state or config
    const state = req.query.state as string || req.body.state as string;
    if (!state) {
      res.status(400).json({
        error: 'MISSING_STATE',
        message: 'Missing state parameter',
        correlationId,
      });
      return;
    }

    // For SAML, the provider is in the RelayState or we can determine from the assertion consumer service URL
    // For OIDC, we need to know the provider - we can store it in the state
    // For simplicity, we'll try to determine from the request

    let provider: AuthProvider = AuthProvider.SAML; // Default

    // Check if it's a SAML response (POST with SAMLResponse)
    if (req.method === 'POST' && req.body.SAMLResponse) {
      provider = AuthProvider.SAML;
    } else if (req.method === 'GET' && req.query.code) {
      // OIDC callback - need to determine provider from stored state
      // For now, assume OIDC
      provider = AuthProvider.OIDC;
    }

    const result = await ssoService.handleCallback(provider, req.query as Record<string, string>, req.body as Record<string, string>);

    // Complete SSO login via auth service
    const loginResult = await ssoService.authService.ssoLogin({
      provider: result.user.providerId.includes('@') ? AuthProvider.OIDC : AuthProvider.SAML, // Simplified
      providerId: result.user.providerId,
      email: result.user.email,
      name: result.user.name,
      avatarUrl: result.user.avatarUrl,
      workspaceId: result.workspaceId,
      ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      attributes: result.user.attributes,
    });

    // Set refresh token cookie
    res.cookie('refreshToken', loginResult.refreshToken, {
      httpOnly: true,
      secure: config.sessionCookieSecure,
      sameSite: config.sessionCookieSameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    // Redirect to frontend with access token
    const frontendUrl = `${config.clientUrl}/sso/callback?token=${encodeURIComponent(loginResult.accessToken)}`;
    res.redirect(frontendUrl);
  } catch (error) {
    console.error('SSO callback error:', error);
    const frontendUrl = `${config.clientUrl}/login?error=sso_failed`;
    res.redirect(frontendUrl);
  }
});

export default router;