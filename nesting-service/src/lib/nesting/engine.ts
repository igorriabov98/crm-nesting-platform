import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { normalizeCadText } from '../text-encoding';
import { distributePartsToSheets } from './multi-sheet';
import { resolveNestingParams } from './params';
import type { NestingParams, NestingPart, NestingResult, Point2D, SheetOption } from './types';

const STRATEGIES: NestingParams['strategy'][] = ['minWaste', 'remnant', 'minSheets'];

type JsonPoint = {
  x: number;
  y: number;
};

type SheetRequirements = {
  totalPartsArea: number;
  maxPartWidth: number;
  maxPartHeight: number;
  parts: Array<Pick<NestingPart, 'width' | 'height'>>;
};

export async function runNesting(projectId: string): Promise<NestingResult> {
  const startTime = Date.now();
  const project = await prisma.nestingProject.findUnique({
    where: { id: projectId },
    include: { parts: true },
  });

  if (!project) {
    throw new Error(`Проект ${projectId} не найден`);
  }

  const strategy = STRATEGIES.includes(project.strategy as NestingParams['strategy'])
    ? (project.strategy as NestingParams['strategy'])
    : 'minWaste';
  const sheetMetalParts = project.parts.filter((part) => part.isSheetMetal);

  if (sheetMetalParts.length === 0) {
    throw new Error('Нет листовых деталей для раскладки');
  }

  const groups = new Map<string, {
    material: string;
    thickness: number;
    steelTypeId: string | null;
    steelTypeName: string | null;
    parts: typeof sheetMetalParts;
  }>();

  for (const part of sheetMetalParts) {
    const material = normalizeCadText(part.material);
    const steelTypeId = part.steelTypeId ?? null;
    const steelTypeName = part.steelTypeName ?? null;
    const key = JSON.stringify([material, part.thickness, steelTypeId, steelTypeName]);
    const group = groups.get(key) ?? {
      material,
      thickness: part.thickness,
      steelTypeId,
      steelTypeName,
      parts: [],
    };
    group.parts.push(part);
    groups.set(key, group);
  }

  const allSheetResults: NestingResult['sheets'] = [];
  const allUnplaced: NestingResult['unplacedParts'] = [];
  let totalParts = 0;
  let placedParts = 0;

  for (const group of groups.values()) {
    const { material, thickness, steelTypeId, steelTypeName, parts: groupParts } = group;
    const nestingParts: NestingPart[] = groupParts.map((part) => ({
      id: part.id,
      name: part.name,
      sourceInputId: part.sourceInputId,
      sourceId: part.sourceId,
      sourceType: part.sourceType,
      sourceLabel: part.sourceLabel,
      sourceMachineId: part.sourceMachineId,
      sourceMachineName: part.sourceMachineName,
      sourceMachineItemId: part.sourceMachineItemId,
      sourceProductId: part.sourceProductId,
      width: part.width,
      height: part.height,
      contour: readPointArray(part.contour, part.width, part.height),
      holes: readHoles(part.holes),
      grainLock: part.grainLock,
      area: part.width * part.height,
    }));
    const quantities = new Map<string, number>();

    for (const part of groupParts) {
      quantities.set(part.id, part.quantity * project.quantity);
    }

    const groupParams = await resolveNestingParams({ material, thickness });
    const groupTotalParts = Array.from(quantities.values()).reduce((sum, quantity) => sum + quantity, 0);
    totalParts += groupTotalParts;

    const requirements = buildSheetRequirements(nestingParts, quantities, groupParams.gap);
    const sheets = await findSuitableSheets(material, thickness, requirements, groupParams.margin);
    if (sheets.length === 0) {
      for (const part of groupParts) {
        const quantity = quantities.get(part.id) ?? 0;
        for (let index = 1; index <= quantity; index += 1) {
          allUnplaced.push({ partId: part.id, name: `${part.name} (#${index})` });
        }
      }
      continue;
    }

    const result = distributePartsToSheets(nestingParts, quantities, sheets, {
      strategy,
      gap: groupParams.gap,
      margin: groupParams.margin,
      grainDirection: 'horizontal',
    });

    allSheetResults.push(
      ...result.sheets.map((sheet) => ({
        ...sheet,
        steelTypeId,
        steelTypeName,
      }))
    );
    allUnplaced.push(...result.unplacedParts);
    placedParts += result.placedParts;
  }

  const avgUtilization =
    allSheetResults.length > 0
      ? roundPercent(allSheetResults.reduce((sum, sheet) => sum + sheet.utilization, 0) / allSheetResults.length)
      : 0;
  const totalWaste =
    allSheetResults.length > 0
      ? roundPercent(allSheetResults.reduce((sum, sheet) => sum + sheet.waste, 0) / allSheetResults.length)
      : 0;

  const result: NestingResult = {
    sheets: allSheetResults,
    unplacedParts: allUnplaced,
    totalParts,
    placedParts,
    totalSheets: allSheetResults.length,
    avgUtilization,
    totalWaste,
    computeTimeMs: Date.now() - startTime,
  };

  await saveResults(projectId, result);

  return result;
}

async function findSuitableSheets(
  material: string,
  thickness: number,
  requirements: SheetRequirements,
  margin: number
): Promise<SheetOption[]> {
  const sheets: SheetOption[] = [];
  const remnants = await prisma.remnant.findMany({
    where: { material, thickness, isAvailable: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const remnant of remnants) {
    if (!sheetCanFitAnyPart(remnant.width, remnant.height, requirements, margin)) {
      continue;
    }

    sheets.push({
      id: remnant.id,
      width: remnant.width,
      height: remnant.height,
      material: remnant.material,
      thickness: remnant.thickness,
      isRemnant: true,
      priority: 0,
      potentialUtilization: potentialUtilization(requirements.totalPartsArea, remnant.width, remnant.height),
    });
  }

  const catalogSheets = await prisma.sheetCatalog.findMany({
    where: { material, thickness, isActive: true },
    orderBy: [{ width: 'asc' }, { height: 'asc' }],
  });

  for (const sheet of catalogSheets) {
    if (!sheetCanFitAnyPart(sheet.width, sheet.height, requirements, margin)) {
      continue;
    }

    sheets.push({
      id: sheet.id,
      width: sheet.width,
      height: sheet.height,
      material: sheet.material,
      thickness: sheet.thickness,
      isRemnant: false,
      priority: 1,
      potentialUtilization: potentialUtilization(requirements.totalPartsArea, sheet.width, sheet.height),
    });
  }

  return sheets.sort(
    (a, b) =>
      a.priority - b.priority ||
      b.potentialUtilization - a.potentialUtilization ||
      a.width * a.height - b.width * b.height
  );
}

function buildSheetRequirements(
  parts: NestingPart[],
  quantities: Map<string, number>,
  gap: number
): SheetRequirements {
  return {
    totalPartsArea: parts.reduce((sum, part) => {
      const quantity = quantities.get(part.id) ?? 0;
      return sum + (part.width + gap) * (part.height + gap) * quantity;
    }, 0),
    maxPartWidth: Math.max(...parts.map((part) => part.width)),
    maxPartHeight: Math.max(...parts.map((part) => part.height)),
    parts: parts.map((part) => ({ width: part.width, height: part.height })),
  };
}

function sheetCanFitAnyPart(
  sheetWidth: number,
  sheetHeight: number,
  requirements: SheetRequirements,
  margin: number
): boolean {
  const workWidth = sheetWidth - margin * 2;
  const workHeight = sheetHeight - margin * 2;
  const largestEnvelopeFits =
    (requirements.maxPartWidth <= workWidth && requirements.maxPartHeight <= workHeight) ||
    (requirements.maxPartHeight <= workWidth && requirements.maxPartWidth <= workHeight);

  if (largestEnvelopeFits) {
    return true;
  }

  return requirements.parts.some((part) =>
    (part.width <= workWidth && part.height <= workHeight) ||
    (part.height <= workWidth && part.width <= workHeight)
  );
}

function potentialUtilization(totalPartsArea: number, sheetWidth: number, sheetHeight: number): number {
  const sheetArea = sheetWidth * sheetHeight;

  if (sheetArea <= 0) {
    return 0;
  }

  return Math.min(100, roundPercent((totalPartsArea / sheetArea) * 100));
}

async function saveResults(projectId: string, result: NestingResult): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.nestingSheet.deleteMany({ where: { projectId } });

    for (let index = 0; index < result.sheets.length; index += 1) {
      const sheet = result.sheets[index];
      const placementsForDb = sheet.placements.map((placement) => ({
        partId: placement.partId,
        name: placement.name,
        sourceInputId: placement.sourceInputId ?? null,
        sourceId: placement.sourceId ?? null,
        sourceType: placement.sourceType ?? null,
        sourceLabel: placement.sourceLabel ?? null,
        sourceMachineId: placement.sourceMachineId ?? null,
        sourceMachineName: placement.sourceMachineName ?? null,
        sourceMachineItemId: placement.sourceMachineItemId ?? null,
        sourceProductId: placement.sourceProductId ?? null,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
        placedW: placement.placedW,
        placedH: placement.placedH,
      }));

      await tx.nestingSheet.create({
        data: {
          projectId,
          sheetRefId: sheet.isRemnant ? null : sheet.sheetOptionId,
          remnantId: sheet.isRemnant ? sheet.sheetOptionId : null,
          material: sheet.material,
          steelTypeId: sheet.steelTypeId,
          steelTypeName: sheet.steelTypeName,
          thickness: sheet.thickness,
          width: sheet.width,
          height: sheet.height,
          sheetIndex: index + 1,
          usedGap: sheet.usedGap,
          usedMargin: sheet.usedMargin,
          placements: placementsForDb as unknown as Prisma.InputJsonValue,
          utilization: sheet.utilization,
          waste: sheet.waste,
          remnantGeom:
            sheet.remnant === null ? Prisma.JsonNull : (sheet.remnant as unknown as Prisma.InputJsonValue),
        },
      });
    }

    await tx.nestingProject.update({
      where: { id: projectId },
      data: {
        status: 'done',
        errorMessage:
          result.unplacedParts.length > 0
            ? `Не размещено деталей: ${result.unplacedParts.length}`
            : null,
      },
    });
  });
}

function readPointArray(value: Prisma.JsonValue, width: number, height: number): Point2D[] {
  if (isPointArray(value)) {
    return value.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  }

  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
    { x: 0, y: 0 },
  ];
}

function readHoles(value: Prisma.JsonValue | null): Point2D[][] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPointArray).map((hole) => hole.map((point) => ({ x: Number(point.x), y: Number(point.y) })));
}

function isPointArray(value: unknown): value is JsonPoint[] {
  return Array.isArray(value) && value.every(isPointLike);
}

function isPointLike(value: unknown): value is JsonPoint {
  const record = value as Record<string, unknown>;

  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof record.x === 'number' &&
    typeof record.y === 'number'
  );
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}
