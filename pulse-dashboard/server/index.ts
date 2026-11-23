import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { config } from './config';
import { connectRedis, disconnectRedis } from './db/redis';
import { prisma } from './db/prisma';
import { auditService } from './services/auditService';
import { complianceService } from './services/complianceService';
import { secretsService } from './services/secretsService';
import { rbacService } from './services/rbacService';
import { helmetConfig, corsOptions, securityHeadersMiddleware, suspiciousActivityDetector, trustProxyMiddleware, apiRateLimiter, cspNonceMiddleware } from './middleware/security';
import authRoutes from './routes/auth';
import ssoRoutes from './routes/sso';
import scimRoutes from './routes/scim';
import auditRoutes from './routes/audit';
import rbacRoutes from './routes/rbac';
import secretsRoutes from './routes/secrets';
import complianceRoutes from './routes/compliance';
import ipAllowlistRoutes from './routes/ipAllowlist';

const app = express();

// Trust proxy for correct IP addresses behind load balancer
app.use(trustProxyMiddleware);

// Security middleware
app.use(helmetConfig);
app.use(cspNonceMiddleware);
app.use(securityHeadersMiddleware);
app.use(suspiciousActivityDetector);

// CORS
app.use(cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookies
app.use(cookieParser(config.sessionSecret));

// Compression
app.use(compression());

// Rate limiting
app.use('/api/', apiRateLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '9.0.0',
  });
});

// API routes
const apiPrefix = config.apiPrefix;

app.use(`${apiPrefix}/auth`, authRoutes);
app.use(`${apiPrefix}/sso`, ssoRoutes);
app.use(`${apiPrefix}/scim`, scimRoutes);
app.use(`${apiPrefix}/audit`, auditRoutes);
app.use(`${apiPrefix}/rbac`, rbacRoutes);
app.use(`${apiPrefix}/secrets`, secretsRoutes);
app.use(`${apiPrefix}/compliance`, complianceRoutes);
app.use(`${apiPrefix}/ip-allowlist`, ipAllowlistRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);

  const correlationId = (req as any).correlationId || 'unknown';

  // Don't leak error details in production
  const message = config.nodeEnv === 'production'
    ? 'Internal server error'
    : err.message;

  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message,
    correlationId,
  });
});

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('Shutting down gracefully...');

  // Stop accepting new connections
  server.close(async () => {
    console.log('HTTP server closed');

    try {
      // Flush audit logs
      await auditService.shutdown();

      // Disconnect Redis
      await disconnectRedis();

      // Disconnect Prisma
      await prisma.$disconnect();

      console.log('Shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Force close after 30 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const server = app.listen(config.port, async () => {
  console.log(`🚀 Pulse Server v9.0.0 running on port ${config.port}`);
  console.log(`📍 Environment: ${config.nodeEnv}`);
  console.log(`🔗 API: http://localhost:${config.port}${config.apiPrefix}`);

  try {
    // Connect to Redis
    await connectRedis();
    console.log('✅ Redis connected');

    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connected');

    // Initialize system roles for existing workspaces
    const workspaces = await prisma.workspace.findMany({ where: { deletedAt: null } });
    for (const workspace of workspaces) {
      await rbacService.initializeSystemRoles(workspace.id);
    }

    // Start scheduled jobs
    startScheduledJobs();
  } catch (error) {
    console.error('❌ Startup error:', error);
    process.exit(1);
  }
});

function startScheduledJobs(): void {
  // Run secret rotations every hour
  setInterval(async () => {
    try {
      const rotated = await secretsService.runScheduledRotations();
      if (rotated > 0) {
        console.log(`🔄 Rotated ${rotated} secrets`);
      }
    } catch (error) {
      console.error('Secret rotation job failed:', error);
    }
  }, 60 * 60 * 1000);

  // Run retention policies daily at 2 AM
  setInterval(async () => {
    try {
      const processed = await complianceService.runRetentionPolicies();
      if (processed > 0) {
        console.log(`📦 Applied ${processed} retention policies`);
      }
    } catch (error) {
      console.error('Retention policy job failed:', error);
    }
  }, 24 * 60 * 60 * 1000);

  // Cleanup old audit logs daily
  setInterval(async () => {
    try {
      const workspaces = await prisma.workspace.findMany({ where: { deletedAt: null } });
      for (const workspace of workspaces) {
        const retentionDays = workspace.retentionDays || config.auditLogRetentionDays;
        const deleted = await auditService.cleanup(workspace.id, retentionDays);
        if (deleted > 0) {
          console.log(`🧹 Cleaned up ${deleted} old audit logs for workspace ${workspace.id}`);
        }
      }
    } catch (error) {
      console.error('Audit log cleanup job failed:', error);
    }
  }, 24 * 60 * 60 * 1000);

  console.log('⏰ Scheduled jobs started');
}

export default app;