import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import csrf from 'csurf';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { AuthenticatedRequest } from './auth';
import { auditService, AuditEventType } from '../services/auditService';
import { generateSecureRandom } from '../utils/crypto';

/**
 * Helmet configuration for security headers
 */
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: ["'self'", 'wss:', 'https:', 'https://api.sentry.io'],
      mediaSrc: ["'self'", 'blob:', 'data:'],
      objectSrc: ["'none'"],
      frameSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      childSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: config.nodeEnv === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: { policy: 'require-corp' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
  permissionsPolicy: {
    features: {
      accelerometer: [],
      camera: [],
      geolocation: [],
      gyroscope: [],
      magnetometer: [],
      microphone: [],
      payment: [],
      usb: [],
      'fullscreen': ['self'],
      'picture-in-picture': [],
    },
  },
});

/**
 * CSP Nonce middleware - generates nonce for inline scripts/styles
 */
export function cspNonceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const nonce = generateSecureRandom(16);
  res.locals.cspNonce = nonce;

  // Update CSP header with nonce
  const cspHeader = res.getHeader('Content-Security-Policy') as string;
  if (cspHeader) {
    const nonceDirectives = [
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
    ];

    const updatedCsp = cspHeader
      .replace(/script-src\s+([^;]+)/, `script-src $1 'nonce-${nonce}'`)
      .replace(/style-src\s+([^;]+)/, `style-src $1 'nonce-${nonce}'`);

    res.setHeader('Content-Security-Policy', updatedCsp);
  }

  next();
}

/**
 * CSRF Protection middleware
 */
export const csrfProtection = csrf({
  cookie: {
    name: config.csrfCookieName,
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: config.sessionCookieSameSite,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
  value: (req: Request) => {
    return req.headers['x-csrf-token'] as string || req.body._csrf || req.query._csrf;
  },
});

/**
 * CSRF error handler
 */
export function csrfErrorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  if (err.code === 'EBADCSRFTOKEN') {
    auditService.logImmediate({
      workspaceId: (req as AuthenticatedRequest).headers['x-workspace-id'] as string || 'unknown',
      userId: (req as AuthenticatedRequest).user?.sub,
      eventType: AuditEventType.CSRF_VIOLATION,
      severity: 'HIGH',
      description: 'CSRF token validation failed',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: (req as AuthenticatedRequest).correlationId,
    });

    res.status(403).json({
      error: 'CSRF_TOKEN_INVALID',
      message: 'Invalid CSRF token',
      correlationId: (req as AuthenticatedRequest).correlationId,
    });
    return;
  }
  next(err);
}

/**
 * Rate limiting middleware
 */
export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user) return `user:${authReq.user.sub}`;
    return req.ip || 'anonymous';
  },
  handler: (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    auditService.logImmediate({
      workspaceId: authReq.headers['x-workspace-id'] as string || 'unknown',
      userId: authReq.user?.sub,
      eventType: AuditEventType.BRUTE_FORCE_DETECTED,
      severity: 'MEDIUM',
      description: 'Rate limit exceeded',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: authReq.correlationId,
    });

    res.status(429).json({
      error: 'RATE_LIMITED',
      message: 'Too many requests, please try again later',
      correlationId: authReq.correlationId,
    });
  },
});

/**
 * Strict rate limiter for auth endpoints
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.authRateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `auth:${req.ip}`,
  handler: (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    auditService.logImmediate({
      workspaceId: authReq.headers['x-workspace-id'] as string || 'unknown',
      eventType: AuditEventType.BRUTE_FORCE_DETECTED,
      severity: 'HIGH',
      description: 'Auth rate limit exceeded',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: authReq.correlationId,
    });

    res.status(429).json({
      error: 'RATE_LIMITED',
      message: 'Too many authentication attempts, please try again later',
      retryAfter: 900, // 15 minutes
      correlationId: authReq.correlationId,
    });
  },
});

/**
 * Suspicious activity detection
 */
export function suspiciousActivityDetector(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const userAgent = req.headers['user-agent'] || '';
  const ip = req.ip || '';

  // Check for common attack patterns
  const suspiciousPatterns = [
    /sqlmap/i,
    /nikto/i,
    /nessus/i,
    /openvas/i,
    /acunetix/i,
    /burp/i,
    /w3af/i,
    /<script/i,
    /javascript:/i,
    /onerror=/i,
    /onload=/i,
    /union.*select/i,
    /drop.*table/i,
    /insert.*into/i,
    /delete.*from/i,
    /update.*set/i,
  ];

  const queryString = JSON.stringify(req.query);
  const bodyString = JSON.stringify(req.body);
  const fullString = `${queryString} ${bodyString} ${userAgent}`;

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(fullString)) {
      auditService.logImmediate({
        workspaceId: req.headers['x-workspace-id'] as string || 'unknown',
        userId: req.user?.sub,
        eventType: AuditEventType.SUSPICIOUS_ACTIVITY_DETECTED,
        severity: 'HIGH',
        description: `Suspicious pattern detected: ${pattern.source}`,
        ipAddress: ip,
        userAgent,
        correlationId: req.correlationId,
        metadata: { pattern: pattern.source, path: req.path },
      });
      break;
    }
  }

  next();
}

/**
 * Security headers middleware (additional to helmet)
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy
  res.setHeader('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');

  // Cache control for sensitive endpoints
  if (req.path.startsWith('/api/v1/auth') || req.path.startsWith('/api/v1/secrets')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  next();
}

/**
 * Request validation middleware
 */
export function validateRequestBody(maxSize: string = '1mb') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    const maxBytes = parseSize(maxSize);

    if (contentLength > maxBytes) {
      res.status(413).json({
        error: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds maximum size of ${maxSize}`,
        correlationId: (req as AuthenticatedRequest).correlationId,
      });
      return;
    }
    next();
  };
}

/**
 * Parse size string to bytes
 */
function parseSize(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
  if (!match) return 1024 * 1024; // Default 1MB

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'b').toLowerCase();

  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };

  return Math.floor(value * (multipliers[unit] || 1));
}

/**
 * API Key authentication middleware
 */
export async function apiKeyAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return next(); // Allow other auth methods
  }

  // Verify API key format
  if (!apiKey.startsWith('pulse_')) {
    res.status(401).json({
      error: 'INVALID_API_KEY',
      message: 'Invalid API key format',
      correlationId: req.correlationId,
    });
    return;
  }

  // In a real implementation, verify against hashed keys in database
  // For now, extract prefix and validate structure
  const keyPrefix = apiKey.split('_')[1]?.substring(0, 8);
  if (!keyPrefix) {
    res.status(401).json({
      error: 'INVALID_API_KEY',
      message: 'Invalid API key',
      correlationId: req.correlationId,
    });
    return;
  }

  // Set API key info on request
  (req as any).apiKey = { prefix: keyPrefix };

  next();
}

/**
 * Device fingerprinting middleware
 */
export function deviceFingerprintMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const ip = req.ip || '';

  // Generate device fingerprint
  const fingerprint = generateDeviceFingerprint(userAgent, ip);
  req.headers['x-device-fingerprint'] = fingerprint;

  next();
}

/**
 * Generate device fingerprint
 */
function generateDeviceFingerprint(userAgent: string, ip: string): string {
  const crypto = require('crypto');
  const data = `${userAgent}|${acceptLanguage}|${acceptEncoding}|${ip}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

/**
 * CORS configuration
 */
export const corsOptions = {
  origin: config.corsOrigin,
  credentials: config.corsCredentials,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-CSRF-Token',
    'X-Workspace-ID',
    'X-Correlation-ID',
    'X-API-Key',
    'X-Device-Fingerprint',
  ],
  exposedHeaders: [
    'X-Correlation-ID',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
  ],
  maxAge: 86400, // 24 hours
};

/**
 * Trust proxy configuration (for correct IP behind load balancer)
 */
export function trustProxyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Trust first proxy
  req.app.set('trust proxy', 1);
  next();
}