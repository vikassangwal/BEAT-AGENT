import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiPrefix: '/api/v1',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pulse',

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  redisSessionPrefix: 'pulse:session:',
  redisRateLimitPrefix: 'pulse:ratelimit:',
  redisCachePrefix: 'pulse:cache:',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
  jwtAccessExpiry: '15m',
  jwtRefreshExpiry: '7d',
  jwtIssuer: 'pulse',
  jwtAudience: 'pulse-api',

  // Encryption
  encryptionKey: process.env.ENCRYPTION_KEY || '32-char-encryption-key-here!!',
  encryptionAlgorithm: 'aes-256-gcm',

  // Password
  bcryptRounds: 12,
  argon2MemoryCost: 65536,
  argon2TimeCost: 3,
  argon2Parallelism: 4,

  // Session
  sessionSecret: process.env.SESSION_SECRET || 'session-secret-change-in-production',
  sessionCookieName: 'pulse.sid',
  sessionCookieSecure: process.env.NODE_ENV === 'production',
  sessionCookieSameSite: 'lax' as const,
  sessionMaxAge: 7 * 24 * 60 * 60 * 1000, // 7 days

  // Rate Limiting
  rateLimitWindowMs: 15 * 60 * 1000, // 15 minutes
  rateLimitMaxRequests: 100,
  authRateLimitMaxRequests: 10,
  apiRateLimitMaxRequests: 1000,

  // Security
  corsOrigin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'],
  corsCredentials: true,
  helmetEnabled: true,
  csrfEnabled: process.env.NODE_ENV === 'production',
  csrfCookieName: 'pulse.csrf',

  // MFA
  mfaIssuer: 'Pulse',
  mfaWindow: 1,

  // Email
  smtpHost: process.env.SMTP_HOST || 'localhost',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  emailFrom: process.env.EMAIL_FROM || 'noreply@pulse.app',

  // Sentry
  sentryDsn: process.env.SENTRY_DSN,
  sentryEnvironment: process.env.SENTRY_ENVIRONMENT || 'development',

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logFormat: process.env.NODE_ENV === 'production' ? 'json' : 'pretty',

  // File Upload
  maxFileSize: 100 * 1024 * 1024, // 100MB
  uploadDir: process.env.UPLOAD_DIR || './uploads',

  // Webhooks
  webhookTimeout: 30000,
  webhookMaxRetries: 3,
  webhookRetryDelay: 5000,

  // SCIM
  scimBasePath: '/scim/v2',

  // SAML
  samlCallbackBaseUrl: process.env.SAML_CALLBACK_BASE_URL || 'http://localhost:3000/api/v1/auth/saml',

  // OIDC
  oidcCallbackBaseUrl: process.env.OIDC_CALLBACK_BASE_URL || 'http://localhost:3000/api/v1/auth/oidc',

  // Feature Flags
  features: {
    sso: process.env.FEATURE_SSO !== 'false',
    scim: process.env.FEATURE_SCIM !== 'false',
    auditLogs: process.env.FEATURE_AUDIT_LOGS !== 'false',
    advancedRbac: process.env.FEATURE_ADVANCED_RBAC !== 'false',
    ipAllowlist: process.env.FEATURE_IP_ALLOWLIST !== 'false',
    geoBlocking: process.env.FEATURE_GEO_BLOCKING !== 'false',
    secretsManagement: process.env.FEATURE_SECRETS_MANAGEMENT !== 'false',
    compliance: process.env.FEATURE_COMPLIANCE !== 'false',
    mfa: process.env.FEATURE_MFA !== 'false',
  },

  // Compliance
  defaultRetentionDays: 2555, // 7 years
  auditLogRetentionDays: 2555,
  sessionLogRetentionDays: 365,
  secretAccessLogRetentionDays: 365,

  // Vault
  vaultUrl: process.env.VAULT_URL,
  vaultToken: process.env.VAULT_TOKEN,
  vaultMountPath: 'secret/data/pulse',

  // AWS Secrets Manager
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  awsSecretsManagerPrefix: 'pulse/',

  // Data Residency
  defaultDataRegion: 'US_EAST',
  allowedDataRegions: ['US_EAST', 'US_WEST', 'EU_WEST', 'EU_CENTRAL', 'AP_SOUTHEAST', 'AP_NORTHEAST', 'CA_CENTRAL', 'SA_EAST'],
} as const;

export type Config = typeof config;