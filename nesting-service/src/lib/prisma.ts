import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { withPrismaConnectionLimit } from './database-connection';

const logOptions =
  config.NODE_ENV === 'development'
    ? [
        { emit: 'event' as const, level: 'query' as const },
        { emit: 'event' as const, level: 'error' as const },
      ]
    : [{ emit: 'event' as const, level: 'error' as const }];

function createPrismaClient() {
  return new PrismaClient({
    datasourceUrl: withPrismaConnectionLimit(config.DATABASE_URL, config.NESTING_PRISMA_POOL_MAX),
    log: logOptions,
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (config.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

if (config.NODE_ENV === 'development') {
  prisma.$on('query', (event) => {
    console.debug(`[prisma:query] ${event.duration}ms ${event.query}`);
  });
}

prisma.$on('error', (event) => {
  console.error('[prisma:error]', event);
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
