import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { NotFoundError, ValidationError } from '../lib/errors';
import { normalizeCadText } from '../lib/text-encoding';
import { normalizePartType, partTypeFromLegacySheetFlag } from '../lib/part-type';
import { idParamSchema } from '../schemas/common.schema';
import { projectPartParamsSchema, updatePartSchema } from '../schemas/project.schema';
import { summarizePartActivity } from '../lib/part-activity';

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
  contourStale: true,
  quantity: true,
  isSheetMetal: true,
  partType: true,
  isActive: true,
  inactiveReason: true,
  activityChangedBy: true,
  activityChangedAt: true,
  grainLock: true,
  hasBends: true,
  bendCount: true,
  kFactor: true,
  kFactorDefaulted: true,
  dimensionMismatch: true,
  mismatchNote: true,
  thicknessMismatch: true,
  thicknessMismatchNote: true,
  aiApplySnapshot: true,
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

    const [parts, total, project] = await prisma.$transaction([
      prisma.part.findMany({
        where: { projectId: id },
        orderBy: { name: 'asc' },
        select: partListSelect,
      }),
      prisma.part.count({ where: { projectId: id } }),
      prisma.nestingProject.findUnique({
        where: { id },
        select: { quantity: true },
      }),
    ]);
    const activity = summarizePartActivity(parts, project?.quantity ?? 1);

    return { data: parts.map(normalizePartText), total, ...activity };
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
    const nextPartType = data.partType
      ? normalizePartType(data.partType)
      : data.isSheetMetal !== undefined
        ? partTypeFromLegacySheetFlag(data.isSheetMetal)
        : null;

    if (nextPartType) {
      updateData.partType = nextPartType;
      updateData.isSheetMetal = nextPartType === 'SHEET';
      updateData.classificationMethod = 'manual';
      updateData.classificationWarning = null;
      if (nextPartType !== 'SHEET') {
        updateData.hasBends = false;
        updateData.grainLock = false;
        updateData.thicknessMismatch = false;
        updateData.thicknessMismatchNote = null;
      }
    }

    if (data.isActive !== undefined) {
      updateData.isActive = data.isActive;
      updateData.inactiveReason = data.isActive ? null : 'MANUAL';
      updateData.activityChangedBy = data.activityChangedBy ?? null;
      updateData.activityChangedAt = new Date();
    } else {
      delete updateData.activityChangedBy;
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
      data.partType !== undefined ||
      data.steelTypeId !== undefined ||
      data.steelTypeName !== undefined ||
      data.steelTypeRaw !== undefined ||
      data.isActive !== undefined;
    const recalculationMessage = data.isActive !== undefined
      ? 'требуется пересчёт после изменения активности детали'
      : 'требуется пересчёт развёртки после изменения материала/толщины';
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
            errorMessage: recalculationMessage,
          },
        });
      }

      return nextPart;
    });

    return { data: normalizePartText(updated) };
  });
}
