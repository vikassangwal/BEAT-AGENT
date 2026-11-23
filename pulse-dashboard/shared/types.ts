// Shared types for Pulse Enterprise

export interface JwtPayload {
  sub: string;
  email: string;
  workspaceId?: string;
  role?: string;
  permissions?: string[];
  sessionId: string;
  deviceId?: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
  tokenVersion: number;
  iat: number;
  exp: number;
  jti: string;
}

export interface ApiKeyPayload {
  keyId: string;
  workspaceId: string;
  userId: string;
  permissions: string[];
  scopes: string[];
  iat: number;
  exp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: string;
  permissions: string[];
  settings: Record<string, unknown>;
  ipAllowlistEnabled: boolean;
  geoBlockingEnabled: boolean;
  requireMfa: boolean;
  maxConcurrentSessions: number;
  sessionTimeoutMinutes: number;
}

export interface SessionInfo {
  id: string;
  userId: string;
  workspaceId: string | null;
  ipAddress: string;
  userAgent: string;
  deviceId: string | null;
  location: GeoLocation | null;
  status: string;
  expiresAt: Date;
  lastActivityAt: Date;
  createdAt: Date;
}

export interface DeviceInfo {
  id: string;
  deviceId: string;
  name: string;
  type: string;
  os: string | null;
  browser: string | null;
  ipAddress: string;
  location: GeoLocation | null;
  isTrusted: boolean;
  lastSeenAt: Date;
  registeredAt: Date;
  pushToken: string | null;
}

export interface GeoLocation {
  country: string;
  region: string;
  city: string;
  lat: number;
  lon: number;
  timezone: string;
}

export interface IpAllowlistEntry {
  id: string;
  type: 'ALLOW' | 'DENY' | 'GEO_ALLOW' | 'GEO_DENY';
  value: string;
  description: string | null;
  enabled: boolean;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface SsoConfigData {
  id: string;
  workspaceId: string;
  provider: 'SAML' | 'OIDC' | 'GOOGLE' | 'MICROSOFT' | 'OKTA' | 'AUTH0' | 'KEYCLOAK';
  enabled: boolean;
  // SAML
  samlEntryPoint?: string;
  samlIssuer?: string;
  samlCert?: string;
  samlCallbackUrl?: string;
  samlAttributeMapping?: Record<string, string>;
  // OIDC
  oidcClientId?: string;
  oidcIssuer?: string;
  oidcDiscoveryUrl?: string;
  oidcScopes?: string[];
  // General
  autoProvision: boolean;
  defaultRole: string;
  domainWhitelist: string[];
  attributeMapping: Record<string, string>;
}

export interface ScimConfigData {
  id: string;
  workspaceId: string;
  enabled: boolean;
  baseUrl: string;
  userSchema: Record<string, unknown>;
  groupSchema: Record<string, unknown>;
  attributeMapping: Record<string, string>;
  filterConfig: Record<string, unknown>;
  lastSyncAt: Date | null;
  syncStatus: string;
}

export interface AuditLogEntry {
  id: string;
  workspaceId: string;
  userId: string | null;
  performedBy: string | null;
  eventType: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  resourceType: string | null;
  resourceId: string | null;
  action: string | null;
  description: string;
  ipAddress: string | null;
  userAgent: string | null;
  location: GeoLocation | null;
  metadata: Record<string, unknown>;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  correlationId: string | null;
  sessionId: string | null;
  requestId: string | null;
  createdAt: Date;
}

export interface AuditLogFilters {
  workspaceId: string;
  userId?: string;
  eventType?: string[];
  severity?: string[];
  resourceType?: string;
  resourceId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  ipAddress?: string;
  correlationId?: string;
  sessionId?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'severity';
  sortOrder?: 'asc' | 'desc';
}

export interface SecretData {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  value: string; // Decrypted
  version: number;
  description: string | null;
  tags: string[];
  rotationEnabled: boolean;
  rotationInterval: number | null;
  lastRotatedAt: Date | null;
  nextRotationAt: Date | null;
  rotationStatus: string;
  accessCount: number;
  lastAccessedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SecretVersionData {
  id: string;
  secretId: string;
  version: number;
  value: string; // Decrypted
  createdBy: string;
  createdAt: Date;
  description: string | null;
}

export interface ApiKeyData {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  usageCount: number;
  isActive: boolean;
  createdAt: Date;
}

export interface WebhookData {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  retryPolicy: Record<string, unknown>;
  headers: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDeliveryData {
  id: string;
  webhookId: string;
  eventType: string;
  payload: Record<string, unknown>;
  responseStatus: number | null;
  responseBody: string | null;
  attempt: number;
  status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'RETRYING';
  error: string | null;
  nextRetryAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface RoleData {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isDefault: boolean;
  priority: number;
  conditions: Record<string, unknown>;
  permissions: PermissionData[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PermissionData {
  id: string;
  resource: string;
  action: string;
  description: string | null;
  condition?: Record<string, unknown>;
}

export interface ComplianceReportData {
  id: string;
  workspaceId: string;
  framework: string;
  reportType: string;
  status: string;
  dateFrom: Date;
  dateTo: Date;
  fileUrl: string | null;
  findings: ComplianceFinding[];
  createdAt: Date;
  completedAt: Date | null;
}

export interface ComplianceFinding {
  id: string;
  controlId: string;
  controlTitle: string;
  status: 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'NOT_TESTED';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  description: string;
  evidence: string[];
  remediation: string | null;
}

export interface RetentionPolicyData {
  id: string;
  workspaceId: string;
  name: string;
  resourceType: string;
  conditions: Record<string, unknown>;
  retentionDays: number;
  action: 'DELETE' | 'ARCHIVE' | 'ANONYMIZE';
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
}

export interface DataResidencyConfigData {
  id: string;
  workspaceId: string;
  primaryRegion: string;
  allowedRegions: string[];
  replicationEnabled: boolean;
  encryptionAtRest: boolean;
  encryptionInTransit: boolean;
  keyManagement: 'MANAGED' | 'CUSTOMER' | 'HSM';
}

export interface SecurityEventData {
  type: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  workspaceId: string;
  userId?: string;
  ipAddress: string;
  userAgent: string;
  location?: GeoLocation;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface CorsConfig {
  origin: string | string[] | boolean;
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  maxAge: number;
}

export interface HelmetConfig {
  contentSecurityPolicy: boolean | Record<string, unknown>;
  crossOriginEmbedderPolicy: boolean | Record<string, unknown>;
  crossOriginOpenerPolicy: boolean | Record<string, unknown>;
  crossOriginResourcePolicy: boolean | Record<string, unknown>;
  dnsPrefetchControl: boolean | Record<string, unknown>;
  frameguard: boolean | Record<string, unknown>;
  hidePoweredBy: boolean;
  hsts: boolean | Record<string, unknown>;
  ieNoOpen: boolean;
  noSniff: boolean;
  referrerPolicy: boolean | Record<string, unknown>;
  xssFilter: boolean;
  permissionsPolicy: boolean | Record<string, unknown>;
}