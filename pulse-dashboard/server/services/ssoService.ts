import { prisma } from '../db/prisma';
import { cacheRedis } from '../db/redis';
import { auditService, AuditEventType } from './auditService';
import { authService } from './authService';
import { config } from '../config';
import { AuthProvider, Prisma } from '@prisma/client';
import { generateSecureRandom, encrypt, decrypt } from '../utils/crypto';
import { verifyExternalJwt } from '../utils/jwt';
import passport from 'passport';
import { Strategy as SamlStrategy } from 'passport-saml';
import { Strategy as OIDCStrategy } from 'passport-openidconnect';
import { Issuer, Client, TokenSet } from 'openid-client';

export interface SsoConfigInput {
  workspaceId: string;
  provider: AuthProvider;
  // SAML
  samlEntryPoint?: string;
  samlIssuer?: string;
  samlCert?: string;
  samlPrivateKey?: string;
  samlCallbackUrl?: string;
  samlAttributeMapping?: Record<string, string>;
  samlNameIdFormat?: string;
  samlForceAuthn?: boolean;
  samlAllowIdpInitiated?: boolean;
  // OIDC
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcIssuer?: string;
  oidcDiscoveryUrl?: string;
  oidcScopes?: string[];
  oidcPkceEnabled?: boolean;
  oidcAttributeMapping?: Record<string, string>;
  // General
  autoProvision?: boolean;
  defaultRole?: string;
  domainWhitelist?: string[];
  attributeMapping?: Record<string, string>;
}

export interface SsoInitiateResult {
  url: string;
  state: string;
  provider: AuthProvider;
}

export interface SsoCallbackResult {
  user: {
    providerId: string;
    email: string;
    name?: string;
    avatarUrl?: string;
    attributes: Record<string, unknown>;
  };
  workspaceId: string;
}

class SsoService {
  private samlStrategies = new Map<string, SamlStrategy>();
  private oidcClients = new Map<string, Client>();

  /**
   * Configure SSO for a workspace
   */
  async configureSso(input: SsoConfigInput, configuredBy: string): Promise<void> {
    const { workspaceId, provider, ...config } = input;

    // Encrypt sensitive fields
    const encryptedConfig: any = { ...config };
    if (config.samlPrivateKey) encryptedConfig.samlPrivateKey = encrypt(config.samlPrivateKey);
    if (config.oidcClientSecret) encryptedConfig.oidcClientSecret = encrypt(config.oidcClientSecret);

    await prisma.ssoConfig.upsert({
      where: { workspaceId },
      update: {
        provider,
        enabled: true,
        ...encryptedConfig,
        updatedAt: new Date(),
      },
      create: {
        workspaceId,
        provider,
        enabled: true,
        ...encryptedConfig,
      },
    });

    // Initialize strategy
    await this.initializeStrategy(workspaceId);

    // Invalidate cache
    await cacheRedis.delete(`sso_config:${workspaceId}`);

    await auditService.logImmediate({
      workspaceId,
      userId: configuredBy,
      performedBy: configuredBy,
      eventType: AuditEventType.WORKSPACE_SSO_CONFIGURED,
      severity: 'INFO',
      description: `SSO configured: ${provider}`,
      metadata: { provider },
    });
  }

  /**
   * Get SSO config for workspace
   */
  async getSsoConfig(workspaceId: string): Promise<any> {
    const cacheKey = `sso_config:${workspaceId}`;
    let cached = await cacheRedis.get(cacheKey);

    if (!cached) {
      const config = await prisma.ssoConfig.findUnique({ where: { workspaceId } });
      if (config) {
        // Decrypt sensitive fields
        cached = {
          ...config,
          samlPrivateKey: config.samlPrivateKey ? decrypt(config.samlPrivateKey) : undefined,
          oidcClientSecret: config.oidcClientSecret ? decrypt(config.oidcClientSecret) : undefined,
        };
        await cacheRedis.set(cacheKey, cached, 300);
      }
    }

    return cached;
  }

  /**
   * Enable/disable SSO
   */
  async setSsoEnabled(workspaceId: string, enabled: boolean, updatedBy: string): Promise<void> {
    await prisma.ssoConfig.update({
      where: { workspaceId },
      data: { enabled, updatedAt: new Date() },
    });

    await cacheRedis.delete(`sso_config:${workspaceId}`);

    if (enabled) {
      await this.initializeStrategy(workspaceId);
    } else {
      this.samlStrategies.delete(workspaceId);
      this.oidcClients.delete(workspaceId);
    }

    await auditService.logImmediate({
      workspaceId,
      userId: updatedBy,
      performedBy: updatedBy,
      eventType: AuditEventType.WORKSPACE_SSO_CONFIGURED,
      severity: 'INFO',
      description: `SSO ${enabled ? 'enabled' : 'disabled'}`,
      metadata: { enabled },
    });
  }

  /**
   * Initiate SSO login
   */
  async initiateLogin(workspaceId: string, returnUrl?: string): Promise<SsoInitiateResult> {
    const ssoConfig = await this.getSsoConfig(workspaceId);
    if (!ssoConfig || !ssoConfig.enabled) {
      throw new Error('SSO_NOT_CONFIGURED');
    }

    const state = generateSecureRandom(32);
    const callbackUrl = `${config.samlCallbackBaseUrl}/callback`;

    // Store state with workspace ID
    await cacheRedis.set(`sso_state:${state}`, { workspaceId, returnUrl }, 600);

    let url: string;

    switch (ssoConfig.provider) {
      case AuthProvider.SAML:
        url = await this.getSamlLoginUrl(ssoConfig, state, callbackUrl);
        break;
      case AuthProvider.OIDC:
      case AuthProvider.OKTA:
      case AuthProvider.AUTH0:
      case AuthProvider.KEYCLOAK:
        url = await this.getOidcLoginUrl(ssoConfig, state, callbackUrl);
        break;
      case AuthProvider.GOOGLE:
        url = await this.getGoogleLoginUrl(ssoConfig, state, callbackUrl);
        break;
      case AuthProvider.MICROSOFT:
        url = await this.getMicrosoftLoginUrl(ssoConfig, state, callbackUrl);
        break;
      default:
        throw new Error('UNSUPPORTED_PROVIDER');
    }

    return { url, state, provider: ssoConfig.provider };
  }

  /**
   * Handle SSO callback
   */
  async handleCallback(provider: AuthProvider, query: Record<string, string>, body: Record<string, string>): Promise<SsoCallbackResult> {
    const state = query.state || body.state;
    if (!state) throw new Error('MISSING_STATE');

    const stateData = await cacheRedis.get<{ workspaceId: string; returnUrl?: string }>(`sso_state:${state}`);
    if (!stateData) throw new Error('INVALID_STATE');

    await cacheRedis.delete(`sso_state:${state}`);

    const ssoConfig = await this.getSsoConfig(stateData.workspaceId);
    if (!ssoConfig) throw new Error('SSO_NOT_CONFIGURED');

    let user: SsoCallbackResult['user'];

    switch (provider) {
      case AuthProvider.SAML:
        user = await this.handleSamlCallback(ssoConfig, body);
        break;
      case AuthProvider.OIDC:
      case AuthProvider.OKTA:
      case AuthProvider.AUTH0:
      case AuthProvider.KEYCLOAK:
        user = await this.handleOidcCallback(ssoConfig, query);
        break;
      case AuthProvider.GOOGLE:
        user = await this.handleGoogleCallback(ssoConfig, query);
        break;
      case AuthProvider.MICROSOFT:
        user = await this.handleMicrosoftCallback(ssoConfig, query);
        break;
      default:
        throw new Error('UNSUPPORTED_PROVIDER');
    }

    return { user, workspaceId: stateData.workspaceId };
  }

  /**
   * Initialize SAML strategy
   */
  private async initializeStrategy(workspaceId: string): Promise<void> {
    const ssoConfig = await this.getSsoConfig(workspaceId);
    if (!ssoConfig || !ssoConfig.enabled) return;

    if (ssoConfig.provider === AuthProvider.SAML) {
      this.initSamlStrategy(workspaceId, ssoConfig);
    } else if ([AuthProvider.OIDC, AuthProvider.OKTA, AuthProvider.AUTH0, AuthProvider.KEYCLOAK].includes(ssoConfig.provider)) {
      await this.initOidcClient(workspaceId, ssoConfig);
    }
  }

  /**
   * Initialize SAML strategy
   */
  private initSamlStrategy(workspaceId: string, ssoConfig: any): void {
    const strategy = new SamlStrategy(
      {
        entryPoint: ssoConfig.samlEntryPoint,
        issuer: ssoConfig.samlIssuer,
        callbackUrl: ssoConfig.samlCallbackUrl || `${config.samlCallbackBaseUrl}/callback`,
        cert: ssoConfig.samlCert,
        privateKey: ssoConfig.samlPrivateKey,
        nameIdFormat: ssoConfig.samlNameIdFormat || 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        identifierFormat: ssoConfig.samlNameIdFormat || 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        forceAuthn: ssoConfig.samlForceAuthn || false,
        allowIdpInitiated: ssoConfig.samlAllowIdpInitiated !== false,
        attributeMapping: ssoConfig.samlAttributeMapping || {
          email: 'email',
          firstName: 'firstName',
          lastName: 'lastName',
          displayName: 'displayName',
        },
        validateInResponseTo: true,
        requestIdExpirationPeriodMs: 60000,
      },
      (profile, done) => {
        // Profile contains SAML attributes
        done(null, profile);
      }
    );

    this.samlStrategies.set(workspaceId, strategy);
    passport.use(`saml-${workspaceId}`, strategy);
  }

  /**
   * Initialize OIDC client
   */
  private async initOidcClient(workspaceId: string, ssoConfig: any): Promise<void> {
    let issuer: Issuer;

    if (ssoConfig.oidcDiscoveryUrl) {
      issuer = await Issuer.discover(ssoConfig.oidcDiscoveryUrl);
    } else if (ssoConfig.oidcIssuer) {
      issuer = await Issuer.discover(ssoConfig.oidcIssuer);
    } else {
      throw new Error('OIDC_ISSUER_REQUIRED');
    }

    const client = new issuer.Client({
      client_id: ssoConfig.oidcClientId,
      client_secret: ssoConfig.oidcClientSecret,
      redirect_uris: [`${config.oidcCallbackBaseUrl}/callback`],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
    });

    this.oidcClients.set(workspaceId, client);
  }

  /**
   * Get SAML login URL
   */
  private async getSamlLoginUrl(ssoConfig: any, state: string, callbackUrl: string): Promise<string> {
    const strategy = this.samlStrategies.get(ssoConfig.workspaceId);
    if (!strategy) throw new Error('SAML_STRATEGY_NOT_INITIALIZED');

    return new Promise((resolve, reject) => {
      strategy.generateServiceProviderMetadata((err, metadata) => {
        if (err) return reject(err);

        const loginUrl = strategy.getAuthorizeUrl({
          RelayState: state,
          callbackUrl,
        });
        resolve(loginUrl);
      });
    });
  }

  /**
   * Get OIDC login URL
   */
  private async getOidcLoginUrl(ssoConfig: any, state: string, callbackUrl: string): Promise<string> {
    const client = this.oidcClients.get(ssoConfig.workspaceId);
    if (!client) throw new Error('OIDC_CLIENT_NOT_INITIALIZED');

    const scopes = ssoConfig.oidcScopes || ['openid', 'profile', 'email'];
    const params: any = {
      scope: scopes.join(' '),
      state,
      redirect_uri: callbackUrl,
    };

    if (ssoConfig.oidcPkceEnabled !== false) {
      const codeVerifier = generateSecureRandom(64);
      await cacheRedis.set(`oidc_pkce:${state}`, codeVerifier, 600);
      const codeChallenge = generateSecureRandom(43); // Simplified - use proper PKCE
      params.code_challenge = codeChallenge;
      params.code_challenge_method = 'S256';
    }

    return client.authorizationUrl(params);
  }

  /**
   * Get Google login URL
   */
  private async getGoogleLoginUrl(ssoConfig: any, state: string, callbackUrl: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: ssoConfig.oidcClientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Get Microsoft login URL
   */
  private async getMicrosoftLoginUrl(ssoConfig: any, state: string, callbackUrl: string): Promise<string> {
    const tenant = ssoConfig.oidcIssuer?.split('/').pop() || 'common';
    const params = new URLSearchParams({
      client_id: ssoConfig.oidcClientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      prompt: 'select_account',
    });

    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /**
   * Handle SAML callback
   */
  private async handleSamlCallback(ssoConfig: any, body: Record<string, string>): Promise<SsoCallbackResult['user']> {
    const strategy = this.samlStrategies.get(ssoConfig.workspaceId);
    if (!strategy) throw new Error('SAML_STRATEGY_NOT_INITIALIZED');

    return new Promise((resolve, reject) => {
      strategy.authenticate('saml', { session: false })(body as any, null, (err: any, user: any) => {
        if (err) return reject(err);
        if (!user) return reject(new Error('SAML_AUTH_FAILED'));

        const attributes = user.attributes || {};
        const attributeMapping = ssoConfig.attributeMapping || {};

        resolve({
          providerId: attributes[attributeMapping.userId || 'email'] || attributes.email,
          email: attributes[attributeMapping.email || 'email'],
          name: attributes[attributeMapping.displayName || 'displayName'] ||
                `${attributes[attributeMapping.firstName || 'firstName'] || ''} ${attributes[attributeMapping.lastName || 'lastName'] || ''}`.trim(),
          avatarUrl: attributes[attributeMapping.avatarUrl || 'avatarUrl'],
          attributes,
        });
      });
    });
  }

  /**
   * Handle OIDC callback
   */
  private async handleOidcCallback(ssoConfig: any, query: Record<string, string>): Promise<SsoCallbackResult['user']> {
    const client = this.oidcClients.get(ssoConfig.workspaceId);
    if (!client) throw new Error('OIDC_CLIENT_NOT_INITIALIZED');

    const code = query.code;
    const state = query.state;
    if (!code) throw new Error('MISSING_AUTH_CODE');

    const params: any = { code, grant_type: 'authorization_code' };

    // Handle PKCE
    const codeVerifier = await cacheRedis.get<string>(`oidc_pkce:${state}`);
    if (codeVerifier) {
      params.code_verifier = codeVerifier;
      await cacheRedis.delete(`oidc_pkce:${state}`);
    }

    const tokenSet: TokenSet = await client.callback(
      `${config.oidcCallbackBaseUrl}/callback`,
      { code, state },
      params
    );

    const claims = tokenSet.claims();
    const attributeMapping = ssoConfig.attributeMapping || {};

    return {
      providerId: claims.sub,
      email: claims[attributeMapping.email || 'email'],
      name: claims[attributeMapping.name || 'name'] || claims.preferred_username,
      avatarUrl: claims[attributeMapping.picture || 'picture'],
      attributes: claims,
    };
  }

  /**
   * Handle Google callback
   */
  private async handleGoogleCallback(ssoConfig: any, query: Record<string, string>): Promise<SsoCallbackResult['user']> {
    const code = query.code;
    if (!code) throw new Error('MISSING_AUTH_CODE');

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: ssoConfig.oidcClientId,
        client_secret: ssoConfig.oidcClientSecret,
        redirect_uri: `${config.oidcCallbackBaseUrl}/callback`,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenResponse.json();
    if (tokens.error) throw new Error(tokens.error_description);

    // Get user info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const userInfo = await userInfoResponse.json();

    return {
      providerId: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      avatarUrl: userInfo.picture,
      attributes: userInfo,
    };
  }

  /**
   * Handle Microsoft callback
   */
  private async handleMicrosoftCallback(ssoConfig: any, query: Record<string, string>): Promise<SsoCallbackResult['user']> {
    const code = query.code;
    if (!code) throw new Error('MISSING_AUTH_CODE');

    const tenant = ssoConfig.oidcIssuer?.split('/').pop() || 'common';
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: ssoConfig.oidcClientId,
        client_secret: ssoConfig.oidcClientSecret,
        redirect_uri: `${config.oidcCallbackBaseUrl}/callback`,
        grant_type: 'authorization_code',
        scope: 'openid profile email',
      }),
    });

    const tokens = await tokenResponse.json();
    if (tokens.error) throw new Error(tokens.error_description);

    // Get user info from Microsoft Graph
    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const userInfo = await userInfoResponse.json();

    return {
      providerId: userInfo.id,
      email: userInfo.mail || userInfo.userPrincipalName,
      name: userInfo.displayName,
      avatarUrl: undefined, // Would need separate call for photo
      attributes: userInfo,
    };
  }

  /**
   * Test SSO configuration
   */
  async testSsoConfig(workspaceId: string): Promise<{ success: boolean; error?: string }> {
    const ssoConfig = await this.getSsoConfig(workspaceId);
    if (!ssoConfig) return { success: false, error: 'SSO not configured' };

    try {
      if (ssoConfig.provider === AuthProvider.SAML) {
        // Validate SAML metadata
        if (!ssoConfig.samlEntryPoint || !ssoConfig.samlCert) {
          return { success: false, error: 'SAML entry point and certificate required' };
        }
      } else {
        // Test OIDC discovery
        if (!ssoConfig.oidcClientId || !ssoConfig.oidcClientSecret) {
          return { success: false, error: 'OIDC client ID and secret required' };
        }
        if (ssoConfig.oidcDiscoveryUrl) {
          await Issuer.discover(ssoConfig.oidcDiscoveryUrl);
        } else if (ssoConfig.oidcIssuer) {
          await Issuer.discover(ssoConfig.oidcIssuer);
        } else {
          return { success: false, error: 'OIDC issuer or discovery URL required' };
        }
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get SAML metadata XML
   */
  async getSamlMetadata(workspaceId: string): Promise<string> {
    const ssoConfig = await this.getSsoConfig(workspaceId);
    if (!ssoConfig || ssoConfig.provider !== AuthProvider.SAML) {
      throw new Error('SAML_NOT_CONFIGURED');
    }

    const strategy = this.samlStrategies.get(workspaceId);
    if (!strategy) throw new Error('SAML_STRATEGY_NOT_INITIALIZED');

    return new Promise((resolve, reject) => {
      strategy.generateServiceProviderMetadata((err, metadata) => {
        if (err) reject(err);
        else resolve(metadata);
      });
    });
  }
}

export const ssoService = new SsoService();