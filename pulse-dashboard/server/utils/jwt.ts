import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { config } from '../config';
import { JwtPayload, RefreshTokenPayload, ApiKeyPayload } from '@shared/types';
import { generateCorrelationId } from './crypto';

const JWT_SECRET = config.jwtSecret;
const JWT_ISSUER = config.jwtIssuer;
const JWT_AUDIENCE = config.jwtAudience;

// JWKS client for external JWT validation (e.g., Auth0, Azure AD)
const jwksClients = new Map<string, jwksClient.JwksClient>();

function getJwksClient(jwksUri: string): jwksClient.JwksClient {
  let client = jwksClients.get(jwksUri);
  if (!client) {
    client = jwksClient({
      jwksUri,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
    jwksClients.set(jwksUri, client);
  }
  return client;
}

/**
 * Sign an access token
 */
export function signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp' | 'jti'>): string {
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + 15 * 60, // 15 minutes
    jti: generateCorrelationId().replace('corr_', ''),
  };
  return jwt.sign(tokenPayload, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: 'HS256',
  });
}

/**
 * Sign a refresh token
 */
export function signRefreshToken(payload: Omit<RefreshTokenPayload, 'iat' | 'exp' | 'jti'>): string {
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload: RefreshTokenPayload = {
    ...payload,
    iat: now,
    exp: now + 7 * 24 * 60 * 60, // 7 days
    jti: generateCorrelationId().replace('corr_', ''),
  };
  return jwt.sign(tokenPayload, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: 'HS256',
  });
}

/**
 * Sign an API key token
 */
export function signApiKeyToken(payload: Omit<ApiKeyPayload, 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload: ApiKeyPayload = {
    ...payload,
    iat: now,
    exp: now + 365 * 24 * 60 * 60, // 1 year
  };
  return jwt.sign(tokenPayload, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: 'HS256',
  });
}

/**
 * Verify and decode an access token
 */
export function verifyAccessToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
      clockTolerance: 30,
    }) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Verify and decode a refresh token
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
      clockTolerance: 30,
    }) as RefreshTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Verify and decode an API key token
 */
export function verifyApiKeyToken(token: string): ApiKeyPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
      clockTolerance: 30,
    }) as ApiKeyPayload;
  } catch {
    return null;
  }
}

/**
 * Verify an external JWT using JWKS (for OIDC/SAML tokens)
 */
export async function verifyExternalJwt(token: string, jwksUri: string, issuer: string, audience: string): Promise<Record<string, unknown> | null> {
  try {
    const client = getJwksClient(jwksUri);

    const getKey = (header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) => {
      client.getSigningKey(header.kid!, (err, key) => {
        if (err) {
          callback(err);
          return;
        }
        callback(null, key.getPublicKey());
      });
    };

    return new Promise((resolve, reject) => {
      jwt.verify(token, getKey, {
        issuer,
        audience,
        algorithms: ['RS256'],
        clockTolerance: 30,
      }, (err, decoded) => {
        if (err) {
          resolve(null);
        } else {
          resolve(decoded as Record<string, unknown>);
        }
      });
    });
  } catch {
    return null;
  }
}

/**
 * Decode token without verification (for debugging/logging)
 */
export function decodeToken(token: string): JwtPayload | RefreshTokenPayload | ApiKeyPayload | null {
  try {
    return jwt.decode(token) as JwtPayload | RefreshTokenPayload | ApiKeyPayload;
  } catch {
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1];
}

/**
 * Get token expiry in seconds
 */
export function getTokenExpiry(token: string): number | null {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return null;
  return decoded.exp - Math.floor(Date.now() / 1000);
}

/**
 * Check if token is expired
 */
export function isTokenExpired(token: string): boolean {
  const expiry = getTokenExpiry(token);
  return expiry !== null && expiry <= 0;
}

/**
 * Create token pair (access + refresh)
 */
export function createTokenPair(
  userId: string,
  email: string,
  workspaceId: string | undefined,
  role: string | undefined,
  permissions: string[],
  sessionId: string,
  deviceId: string | undefined
): { accessToken: string; refreshToken: string } {
  const accessToken = signAccessToken({
    sub: userId,
    email,
    workspaceId,
    role,
    permissions,
    sessionId,
    deviceId,
  });

  const refreshToken = signRefreshToken({
    sub: userId,
    sessionId,
    tokenVersion: 1,
  });

  return { accessToken, refreshToken };
}