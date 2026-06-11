import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { queueService } from '../services/queue.service';

type ServiceStatus = 'ok' | 'down';
type HealthStatus = 'ok' | 'down';

type TimedCheck = {
  status: ServiceStatus;
  latencyMs: number;
  error?: string;
};

type HealthQueueStats = {
  stepParsing: { queued: number };
  nesting: { queued: number };
};

const VERSION = '1.0.0';
const CHECK_TIMEOUT_MS = 1500;

function timeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeoutId));
  });
}

async function measure(label: string, check: () => Promise<unknown>): Promise<TimedCheck> {
  const start = performance.now();

  try {
    await timeout(check(), CHECK_TIMEOUT_MS, label);
    return {
      status: 'ok',
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function emptyQueueStats(): HealthQueueStats {
  return {
    stepParsing: { queued: 0 },
    nesting: { queued: 0 },
  };
}

async function getQueueStats(): Promise<HealthQueueStats> {
  try {
    const queues = await timeout(queueService.getQueueStats(), CHECK_TIMEOUT_MS, 'queue checks');
    return {
      stepParsing: { queued: queues.stepParsing.queued },
      nesting: { queued: queues.nesting.queued },
    };
  } catch {
    return emptyQueueStats();
  }
}

function resolveStatus(database: TimedCheck): HealthStatus {
  return database.status === 'ok' ? 'ok' : 'down';
}

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    const [database, queues] = await Promise.all([
      measure('database', () => prisma.$queryRaw`SELECT 1`),
      getQueueStats(),
    ]);

    const status = resolveStatus(database);
    const statusCode = status === 'down' ? 503 : 200;

    return reply.status(statusCode).send({
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        database,
        queues,
      },
      version: VERSION,
    });
  });
}
