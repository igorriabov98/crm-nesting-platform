import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { ZodError } from 'zod';
import { config } from './config';
import { registerRoutes } from './routes';
import { stopBoss } from './lib/queue';
import { AppError } from './lib/errors';
import { ensureDir } from './lib/utils';
import { disconnectPrisma } from './lib/prisma';
import { verifyServiceAuthorization } from './lib/service-auth';

async function main() {
  if (config.NODE_ENV !== 'production') {
    ensureDir(config.UPLOAD_DIR);
    ensureDir(config.OUTPUT_DIR);
  }

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss Z' } }
          : undefined,
    },
  });

  await app.register(cors, { origin: config.CORS_ORIGIN });
  await app.register(multipart, {
    limits: {
      fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024,
      files: 200,
    },
  });
  if (config.NODE_ENV !== 'production') {
    await app.register(fastifyStatic, {
      root: path.resolve(config.OUTPUT_DIR),
      prefix: '/files/',
      decorateReply: false,
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (!verifyServiceAuthorization(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: 'Маршрут не найден',
      method: request.method,
      url: request.url,
    });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        details: error.details,
      });
    }

    const errorName = error instanceof Error ? error.name : undefined;
    if (error instanceof ZodError || errorName === 'ZodError') {
      return reply.status(400).send({
        error: 'Ошибка валидации',
        details: error,
      });
    }

    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 413) {
      return reply.status(413).send({
        error: `Файл слишком большой. Максимум: ${config.MAX_FILE_SIZE_MB} МБ`,
      });
    }

    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: error instanceof Error ? error.message : 'Ошибка запроса',
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      error: 'Внутренняя ошибка сервера',
    });
  });

  await registerRoutes(app);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    app.log.info(`${signal} received, shutting down...`);

    const results = await Promise.allSettled([
      app.close(),
      stopBoss(),
      disconnectPrisma(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        app.log.error(result.reason);
      }
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`Nesting service running on http://${config.HOST}:${config.PORT}`);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
