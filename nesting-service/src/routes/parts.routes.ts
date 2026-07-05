import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { NotFoundError, ValidationError } from '../lib/errors';
import { normalizeCadText } from '../lib/text-encoding';
import { idParamSchema } from '../schemas/common.schema';
import { projectPartParamsSchema, updatePartSchema } from '../schemas/project.schema';

const partListSelect = {
  id: true,
  sourceInputId: true,
  sourceId: true,
  sourceType: true,
  sourceLabel: true,
  sourceMachineId: true,
  sourceMachineName: true,
  sourceMachineItemId: true,
  sourceProductId: true,
  name: true,
  thickness: true,
  material: true,
  steelTypeId: true,
  steelTypeName: true,
  steelTypeRaw: true,
  width: true,
  height: true,
  bboxSizeX: true,
  bboxSizeY: true,
  bboxSizeZ: true,
  meshVolume: true,
  meshArea: true,
  facesCount: true,
  contourSource: true,
  quantity: true,
  isSheetMetal: true,
  grainLock: true,
  hasBends: true,
  bendCount: true,
  kFactor: true,
  kFactorDefaulted: true,
  dimensionMismatch: true,
  mismatchNote: true,
  thicknessMismatch: true,
  thicknessMismatchNote: true,
  thumbnailSvg: true,
  classificationMethod: true,
  classificationWarning: true,
} as const;

function normalizePartText<T extends { name: string; material: string }>(part: T): T {
  return {
    ...part,
    name: normalizeCadText(part.name),
    material: normalizeCadText(part.material),
  };
}

async function getProjectStatusOrThrow(id: string): Promise<string> {
  const project = await prisma.nestingProject.findUnique({
    where: { id },
    select: { status: true },
  });

  if (!project) {
    throw new NotFoundError('Проект', id);
  }

  return project.status;
}

export async function partsRoutes(app: FastifyInstance) {
  app.get('/:id/parts', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const status = await getProjectStatusOrThrow(id);

    if (status === 'created' || status === 'parsing') {
      throw new ValidationError('Парсинг ещё не завершён');
    }

    const [parts, total] = await prisma.$transaction([
      prisma.part.findMany({
        where: { projectId: id },
        orderBy: { name: 'asc' },
        select: partListSelect,
      }),
      prisma.part.count({ where: { projectId: id } }),
    ]);

    return { data: parts.map(normalizePartText), total };
  });

  app.get('/:id/parts/:partId', async (request) => {
    const { id, partId } = projectPartParamsSchema.parse(request.params);
    await getProjectStatusOrThrow(id);

    const part = await prisma.part.findFirst({
      where: { id: partId, projectId: id },
    });

    if (!part) {
      throw new NotFoundError('Деталь', partId);
    }

    return { data: normalizePartText(part) };
  });

  app.put('/:id/parts/:partId', async (request) => {
    const { id, partId } = projectPartParamsSchema.parse(request.params);
    await getProjectStatusOrThrow(id);

    const data = updatePartSchema.parse(request.body ?? {});
    const updateData: Prisma.PartUpdateInput = { ...data };
    if (data.isSheetMetal !== undefined) {
      updateData.classificationMethod = 'manual';
      updateData.classificationWarning = data.isSheetMetal
        ? null
        : 'Ручная метка: профиль/круг — не для листового раскроя';
      if (!data.isSheetMetal) {
        updateData.hasBends = false;
      }
    }
    const part = await prisma.part.findFirst({
      where: { id: partId, projectId: id },
      select: { id: true },
    });

    if (!part) {
      throw new NotFoundError('Деталь', partId);
    }

    const needsUnfoldRecalculation =
      data.material !== undefined ||
      data.thickness !== undefined ||
      data.isSheetMetal !== undefined ||
      data.steelTypeId !== undefined ||
      data.steelTypeName !== undefined ||
      data.steelTypeRaw !== undefined;
    const updated = await prisma.$transaction(async (tx) => {
      const nextPart = await tx.part.update({
        where: { id: partId },
        data: updateData,
        select: partListSelect,
      });

      if (needsUnfoldRecalculation) {
        await tx.nestingProject.update({
          where: { id },
          data: {
            status: 'parsed',
            errorMessage: 'требуется пересчёт развёртки после изменения материала/толщины',
          },
        });
      }

      return nextPart;
    });

    return { data: normalizePartText(updated) };
  });
}
