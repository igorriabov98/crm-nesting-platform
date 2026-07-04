import type { FastifyInstance } from 'fastify';
import { AppError, NotFoundError, ValidationError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { idParamSchema } from '../schemas/common.schema';
import { calculateSchema } from '../schemas/project.schema';
import { isCompletedProjectStatus } from '../lib/project-status';
import { queueService } from '../services/queue.service';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new AppError(500, message)), timeoutMs);

    promise
      .then(resolve)
      .catch((error) => reject(error instanceof AppError ? error : new AppError(500, message)))
      .finally(() => clearTimeout(timeoutId));
  });
}

export async function calculateRoutes(app: FastifyInstance) {
  app.post('/:id/calculate', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = calculateSchema.parse(request.body ?? {});

    const project = await prisma.nestingProject.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!project) {
      throw new NotFoundError('Проект', id);
    }

    if (!(project.status === 'parsed' || isCompletedProjectStatus(project.status))) {
      throw new ValidationError(
        `Проект в статусе "${project.status}", расчёт можно запустить для "parsed", "done" или "completed_with_warnings"`
      );
    }

    const sheetMetalPartsCount = await prisma.part.count({
      where: {
        projectId: id,
        isSheetMetal: true,
      },
    });

    if (sheetMetalPartsCount === 0) {
      throw new ValidationError('Нет листовых деталей для раскладки');
    }

    await prisma.$transaction([
      prisma.nestingSheet.deleteMany({ where: { projectId: id } }),
      prisma.nestingProject.update({
        where: { id },
        data: {
          strategy: body.strategy,
          status: 'calculating',
          errorMessage: null,
        },
      }),
    ]);

    try {
      await withTimeout(
        queueService.addNestingJob({ projectId: id }),
        5000,
        'Не удалось поставить проект в очередь расчёта'
      );
    } catch (error) {
      await prisma.nestingProject
        .update({
          where: { id },
          data: {
            status: 'error',
            errorMessage: error instanceof Error ? error.message : 'Не удалось поставить проект в очередь расчёта',
          },
        })
        .catch(() => undefined);
      throw error;
    }

    return reply.send({
      data: {
        id,
        status: 'calculating',
      },
    });
  });
}
