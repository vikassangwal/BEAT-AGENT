import { PrismaClient } from '@prisma/client';
import { config } from '../config';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: config.nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
  errorFormat: 'pretty',
});

if (config.nodeEnv !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Middleware for soft deletes
prisma.$use(async (params, next) => {
  // Skip if not a find or findMany operation
  if (params.action === 'findUnique' || params.action === 'findFirst') {
    params.action = 'findFirst';
    params.args.where = {
      ...params.args.where,
      deletedAt: null,
    };
  } else if (params.action === 'findMany') {
    params.args.where = {
      ...params.args.where,
      deletedAt: null,
    };
  } else if (params.action === 'delete' || params.action === 'deleteMany') {
    // Soft delete
    params.action = 'update';
    params.args = {
      where: params.args.where,
      data: {
        deletedAt: new Date(),
      },
    };
  }
  return next(params);
});

// Middleware for audit logging on write operations
prisma.$use(async (params, next) => {
  const result = await next(params);

  // Log write operations for audit trail
  if (['create', 'update', 'delete', 'upsert'].includes(params.action)) {
    // The actual audit logging will be done in the service layer
    // This is just a placeholder for any automatic logging
  }

  return result;
});

export default prisma;