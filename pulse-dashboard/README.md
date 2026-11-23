# Pulse - Enterprise Collaborative Dashboard

## Sprint 9: Enterprise Auth & Security

A production-ready enterprise authentication and security system built with React 18, TypeScript, Node.js/Express, Prisma, PostgreSQL, and Redis.

### 🚀 Features Implemented

#### 1. SSO/SAML/OIDC Authentication
- **SAML 2.0**: Full support for Okta, Azure AD, Auth0, Keycloak, and any SAML 2.0 IdP
- **OIDC/OpenID Connect**: Google Workspace, Microsoft Entra ID, Okta, Auth0, Keycloak
- **Auto-provisioning**: Automatic user/group creation from IdP
- **Attribute Mapping**: Flexible mapping of IdP attributes to user profiles
- **Metadata Exchange**: SP metadata XML generation for IdP configuration

#### 2. SCIM 2.0 Provisioning
- **User Management**: Create, read, update, patch, delete users via SCIM
- **Group Management**: Full group lifecycle management
- **Attribute Mapping**: Configurable user/group attribute mapping
- **Filtering & Pagination**: Standard SCIM filtering and pagination
- **Bulk Operations**: Efficient bulk user/group operations
- **Service Provider Config**: Standard SCIM endpoints discovery

#### 3. Advanced RBAC (Role-Based Access Control)
- **Custom Roles**: Create custom roles with fine-grained permissions
- **Resource-Level Permissions**: Permissions per resource type (WORKSPACE, PROJECT, PAGE, etc.)
- **Action-Based Permissions**: CREATE, READ, UPDATE, DELETE, MANAGE, EXECUTE, APPROVE, SHARE, EXPORT, IMPORT
- **ABAC Conditions**: Attribute-based access control with custom conditions
- **Role Inheritance**: System roles (Owner, Admin, Member, Viewer, Guest) with priority
- **Permission Caching**: Redis-backed permission caching for performance

#### 4. Audit Logging
- **Immutable Event Stream**: Tamper-proof audit log with 50+ event types
- **Severity Levels**: INFO, LOW, MEDIUM, HIGH, CRITICAL
- **Rich Context**: Before/after state, IP, user agent, geo-location, correlation IDs
- **Export Formats**: JSON, CSV, CEF (Common Event Format), LEEF (Log Event Extended Format)
- **SIEM Integration**: Structured logs for Splunk, Elastic, Datadog, etc.
- **Compliance Reports**: Automated SOC 2, GDPR, HIPAA, ISO 27001 reports

#### 5. IP Allowlists & Geo-blocking
- **IP/CIDR Rules**: Allow/deny specific IPs or CIDR ranges
- **Geo-blocking**: Country-level allow/deny (ISO 3166-1 alpha-2)
- **Evaluation Order**: Deny → Allow → Geo-deny → Geo-allow
- **Expiration**: Time-limited rules with automatic cleanup
- **Bulk Import/Export**: JSON-based bulk operations

#### 6. Session Management
- **Device Tracking**: Fingerprint-based device identification
- **Concurrent Session Limits**: Configurable per workspace
- **Session Revocation**: Individual or bulk session termination
- **Token Rotation**: Automatic refresh token rotation on use
- **Token Reuse Detection**: Security alert on token replay attacks

#### 7. Secrets Management
- **Encrypted Storage**: AES-256-GCM encryption at rest
- **Version History**: Full secret versioning with rollback
- **Automatic Rotation**: Scheduled rotation with configurable intervals
- **Access Logging**: Complete audit trail of secret access
- **Vault Integration**: HashiCorp Vault and AWS Secrets Manager sync
- **Secret Types**: API keys, database URLs, encryption keys, JWT secrets, certificates

#### 8. Compliance
- **Frameworks**: SOC 2, GDPR, HIPAA, ISO 27001, CCPA, PCI DSS, FedRAMP
- **Automated Checks**: 30+ compliance controls with evidence
- **Retention Policies**: Automated data lifecycle management
- **Data Residency**: Multi-region deployment with encryption
- **GDPR Tools**: Data export (Article 20) and deletion (Article 17)
- **Key Management**: Managed, customer-managed, or HSM keys

#### 9. Security Hardening
- **CSP**: Content Security Policy with nonce support
- **HSTS**: HTTP Strict Transport Security
- **COOP/COEP**: Cross-Origin Opener/Embedder Policy
- **Permissions Policy**: Feature policy restrictions
- **CSRF Protection**: Double-submit cookie pattern
- **Rate Limiting**: Adaptive rate limiting with Redis
- **XSS Protection**: Input sanitization and output encoding
- **Security Headers**: Complete helmet.js configuration

#### 10. Penetration Testing Ready
- **CSP Nonce**: Dynamic nonce for inline scripts/styles
- **CSRF Tokens**: Per-session CSRF protection
- **Input Validation**: Zod schema validation on all endpoints
- **SQL Injection Prevention**: Prisma ORM with parameterized queries
- **Security Testing**: Built-in suspicious pattern detection

---

### 📁 Project Structure

```
pulse/
├── prisma/
│   └── schema.prisma          # Complete database schema
├── server/
│   ├── config/
│   │   └── index.ts           # Environment configuration
│   ├── db/
│   │   ├── prisma.ts          # Prisma client with middleware
│   │   └── redis.ts           # Redis client with pub/sub
│   ├── middleware/
│   │   ├── auth.ts            # JWT authentication & RBAC
│   │   ├── workspaceAccess.ts # Workspace membership & permissions
│   │   └── security.ts        # Helmet, CSRF, rate limiting, CSP
│   ├── routes/
│   │   ├── auth.ts            # Login, register, MFA, sessions
│   │   ├── sso.ts             # SAML/OIDC configuration & callbacks
│   │   ├── scim.ts            # SCIM 2.0 endpoints
│   │   ├── audit.ts           # Audit log query & export
│   │   ├── rbac.ts            # Role & permission management
│   │   ├── secrets.ts         # Secrets CRUD & rotation
│   │   ├── compliance.ts      # Reports, retention, GDPR
│   │   └── ipAllowlist.ts     # IP/geo allowlist management
│   ├── services/
│   │   ├── authService.ts     # Core authentication logic
│   │   ├── rbacService.ts     # RBAC with ABAC support
│   │   ├── ssoService.ts      # SAML/OIDC strategy management
│   │   ├── scimService.ts     # SCIM provisioning engine
│   │   ├── auditService.ts    # Batched audit logging
│   │   ├── secretsService.ts  # Encrypted secrets management
│   │   ├── complianceService.ts # Compliance reports & GDPR
│   │   └── ipAllowlistService.ts # IP/geo access control
│   ├── utils/
│   │   ├── crypto.ts          # Encryption, hashing, tokens
│   │   └── jwt.ts             # JWT signing & verification
│   └── index.ts               # Express app with all middleware
├── src/
│   ├── components/
│   │   ├── ui/                # Reusable UI components
│   │   └── Layout.tsx         # Main app layout with sidebar
│   ├── hooks/
│   │   └── useAuth.ts         # Authentication state management
│   ├── lib/
│   │   └── api.ts             # Typed API client with interceptors
│   ├── pages/
│   │   ├── auth/              # Login, register, MFA pages
│   │   ├── settings/          # Workspace, SSO, SCIM settings
│   │   └── security/          # Audit, RBAC, secrets, compliance
│   ├── App.tsx                # Routes & protected routes
│   ├── main.tsx               # Entry point with providers
│   └── index.css              # Tailwind + custom styles
├── public/
│   └── favicon.svg
├── package.json
├── tsconfig.json
├── tsconfig.server.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── docker-compose.yml
├── Dockerfile.server
├── Dockerfile.client
├── nginx.conf
└── .env.example
```

---

### 🛠️ Quick Start

#### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- Docker (optional)

#### 1. Clone and Install
```bash
cd pulse
npm install --break-system-packages
```

#### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your configuration
```

Required environment variables:
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/pulse
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-32-char-secret-minimum
ENCRYPTION_KEY=your-32-char-encryption-key
SESSION_SECRET=your-32-char-session-secret
```

#### 3. Database Setup
```bash
npm run db:generate
npm run db:migrate
```

#### 4. Start Development
```bash
npm run dev
```

Server: http://localhost:3000  
Client: http://localhost:5173

#### 5. Docker Deployment
```bash
docker-compose up -d
```

---

### 🔐 Authentication Flow

#### Local Authentication
```mermaid
sequenceDiagram
    Client->>Server: POST /api/v1/auth/login {email, password}
    Server->>Client: 200 {accessToken, refreshToken, user, workspace}
    Client->>Server: GET /api/v1/auth/me (Bearer accessToken)
    Server->>Client: 200 {user, workspace, permissions}
```

#### SSO Authentication (SAML/OIDC)
```mermaid
sequenceDiagram
    Client->>Server: GET /api/v1/sso/login?workspaceId=xxx
    Server->>Client: 302 Redirect to IdP
    IdP->>User: Authentication
    IdP->>Server: POST /api/v1/sso/callback (SAMLResponse or code)
    Server->>Client: 302 Redirect to /sso/callback?token=xxx
    Client->>Server: POST /api/v1/auth/refresh {refreshToken}
    Server->>Client: 200 {accessToken}
```

#### MFA Flow
```mermaid
sequenceDiagram
    Client->>Server: POST /api/v1/auth/mfa/enable
    Server->>Client: 200 {secret, backupCodes}
    Client->>User: Scan QR / Save codes
    Client->>Server: POST /api/v1/auth/mfa/verify {code}
    Server->>Client: 200 {success: true}
```

---

### 📚 API Reference

#### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | Login with email/password |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/logout` | Logout (revoke session) |
| GET | `/api/v1/auth/me` | Get current user profile |
| POST | `/api/v1/auth/change-password` | Change password |
| POST | `/api/v1/auth/forgot-password` | Request password reset |
| POST | `/api/v1/auth/reset-password` | Reset password with token |
| POST | `/api/v1/auth/mfa/enable` | Enable MFA |
| POST | `/api/v1/auth/mfa/disable` | Disable MFA |
| POST | `/api/v1/auth/mfa/verify` | Verify MFA code |
| GET | `/api/v1/auth/sessions` | List user sessions |
| DELETE | `/api/v1/auth/sessions/:id` | Revoke session |
| GET | `/api/v1/auth/devices` | List trusted devices |
| DELETE | `/api/v1/auth/devices/:id` | Revoke device |

#### SSO Configuration
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/sso/config` | Get SSO config |
| POST | `/api/v1/sso/config` | Configure SSO |
| PUT | `/api/v1/sso/enable` | Enable/disable SSO |
| POST | `/api/v1/sso/test` | Test SSO config |
| GET | `/api/v1/sso/metadata` | Get SAML metadata |
| GET | `/api/v1/sso/login` | Initiate SSO login |
| ALL | `/api/v1/sso/callback` | SSO callback handler |

#### SCIM 2.0
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/scim/config` | Get SCIM config |
| POST | `/api/v1/scim/config` | Configure SCIM |
| POST | `/api/v1/scim/sync` | Trigger sync from IdP |
| GET | `/scim/v2/Users` | List users (IdP) |
| GET | `/scim/v2/Users/:id` | Get user (IdP) |
| POST | `/scim/v2/Users` | Create user (IdP) |
| PUT | `/scim/v2/Users/:id` | Update user (IdP) |
| PATCH | `/scim/v2/Users/:id` | Patch user (IdP) |
| DELETE | `/scim/v2/Users/:id` | Delete user (IdP) |
| GET | `/scim/v2/Groups` | List groups (IdP) |
| ... | ... | ... (full SCIM compliance) |

#### Audit Logs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/audit` | Query audit logs |
| GET | `/api/v1/audit/stats` | Get audit statistics |
| GET | `/api/v1/audit/:id` | Get single log entry |
| POST | `/api/v1/audit/export` | Export audit logs |
| GET | `/api/v1/audit/exports` | List exports |
| GET | `/api/v1/audit/exports/:id` | Get export status |
| GET | `/api/v1/audit/exports/:id/download` | Download export |

#### RBAC
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/rbac/roles` | List roles |
| GET | `/api/v1/rbac/roles/:id` | Get role |
| POST | `/api/v1/rbac/roles` | Create role |
| PUT | `/api/v1/rbac/roles/:id` | Update role |
| DELETE | `/api/v1/rbac/roles/:id` | Delete role |
| POST | `/api/v1/rbac/assign` | Assign role to user |
| POST | `/api/v1/rbac/revoke` | Revoke role from user |
| POST | `/api/v1/rbac/check-permission` | Check permission |
| GET | `/api/v1/rbac/permissions` | List all permissions |
| GET | `/api/v1/rbac/my-permissions` | Get current user permissions |

#### Secrets
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/secrets` | List secrets (no values) |
| GET | `/api/v1/secrets/:id` | Get secret (with value) |
| GET | `/api/v1/secrets/name/:name` | Get secret by name |
| POST | `/api/v1/secrets` | Create secret |
| PUT | `/api/v1/secrets/:id` | Update secret |
| DELETE | `/api/v1/secrets/:id` | Delete secret |
| GET | `/api/v1/secrets/:id/versions` | Get secret versions |
| POST | `/api/v1/secrets/:id/rotate` | Rotate secret |
| GET | `/api/v1/secrets/:id/access-logs` | Get access logs |
| POST | `/api/v1/secrets/sync-vault` | Sync with external vault |

#### Compliance
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/compliance/reports` | Generate report |
| GET | `/api/v1/compliance/reports` | List reports |
| GET | `/api/v1/compliance/reports/:id` | Get report |
| GET | `/api/v1/compliance/reports/:id/download` | Download report |
| POST | `/api/v1/compliance/retention-policies` | Create policy |
| GET | `/api/v1/compliance/retention-policies` | List policies |
| DELETE | `/api/v1/compliance/retention-policies/:id` | Delete policy |
| GET | `/api/v1/compliance/data-residency` | Get residency config |
| PUT | `/api/v1/compliance/data-residency` | Configure residency |
| POST | `/api/v1/compliance/gdpr/export` | Request GDPR export |
| POST | `/api/v1/compliance/gdpr/deletion` | Request GDPR deletion |

#### IP Allowlist
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/ip-allowlist` | List entries |
| POST | `/api/v1/ip-allowlist` | Create entry |
| PUT | `/api/v1/ip-allowlist/:id` | Update entry |
| DELETE | `/api/v1/ip-allowlist/:id` | Delete entry |
| POST | `/api/v1/ip-allowlist/bulk` | Bulk import |
| GET | `/api/v1/ip-allowlist/export` | Export entries |
| POST | `/api/v1/ip-allowlist/check` | Check IP access |

---

### 🔒 Security Configuration

#### Content Security Policy
The CSP is configured with nonces for inline scripts/styles:
```typescript
// Server generates nonce per request
res.locals.cspNonce = generateSecureRandom(16);

// Frontend uses nonce
<script nonce={cspNonce}>...</script>
<style nonce={cspNonce}>...</style>
```

#### Rate Limiting
```typescript
// Auth endpoints: 10 requests / 15 min
// API endpoints: 100 requests / 15 min
// Per-user limits for authenticated requests
```

#### Session Security
- Access tokens: 15 minutes (JWT)
- Refresh tokens: 7 days (rotated on use)
- Concurrent sessions: Configurable (default 5)
- Device fingerprinting: SHA-256 of UA + IP

#### Encryption
- Secrets: AES-256-GCM with 32-byte key
- Passwords: Argon2 (PBKDF2 fallback)
- Tokens: SHA-256 hashing for storage
- Database: TLS in transit, encryption at rest

---

### 🧪 Testing

```bash
# Run tests
npm run test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage

# Type checking
npm run typecheck

# Linting
npm run lint
```

---

### 📦 Production Deployment

#### Environment Variables
```env
NODE_ENV=production
JWT_SECRET=generated-with-openssl-rand-base64-32
ENCRYPTION_KEY=generated-with-openssl-rand-base64-32
SESSION_SECRET=generated-with-openssl-rand-base64-32
DATABASE_URL=postgresql://user:pass@host:5432/pulse?sslmode=require
REDIS_URL=redis://:password@host:6379
CORS_ORIGIN=https://your-domain.com
CLIENT_URL=https://your-domain.com
SENTRY_DSN=https://xxx@sentry.io/xxx
```

#### Docker
```bash
# Build
docker-compose build

# Deploy
docker-compose up -d

# Scale
docker-compose up -d --scale pulse-server=3
```

#### Health Checks
```bash
curl http://localhost:3000/health
# Returns: {"status":"ok","timestamp":"...","version":"9.0.0"}
```

---

### 🎯 Sprint 9 Completion Checklist

- ✅ **SSO/SAML/OIDC**: Okta, Azure AD, Google, Auth0, Keycloak
- ✅ **SCIM 2.0**: Full user/group provisioning
- ✅ **Advanced RBAC**: Custom roles, ABAC, resource-level permissions
- ✅ **Audit Logs**: 50+ event types, SIEM export, compliance reports
- ✅ **IP Allowlist/Geo-blocking**: CIDR, country codes, evaluation order
- ✅ **Session Management**: Device tracking, revocation, concurrent limits
- ✅ **Secrets Management**: Encryption, rotation, vault sync, access logs
- ✅ **Compliance**: SOC 2, GDPR, HIPAA, ISO 27001, retention, residency
- ✅ **Security Headers**: CSP, HSTS, COOP/COEP, permissions policy
- ✅ **Pen Testing Ready**: CSP nonce, CSRF, XSS protection, rate limiting

---

### 📄 License

MIT License - see LICENSE file for details.

---

### 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

### 📞 Support

- Documentation: [docs.pulse.app](https://docs.pulse.app)
- Issues: [GitHub Issues](https://github.com/pulse/issues)
- Security: security@pulse.app
- Enterprise: enterprise@pulse.app