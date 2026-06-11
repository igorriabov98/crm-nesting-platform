import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { normalizeCadText } from '../text-encoding';
import { distributePartsToSheets } from './multi-sheet';
import type { NestingParams, NestingPart, NestingResult, Point2D, SheetOption } from './types';

const STRATEGIES: NestingParams['strategy'][] = ['minWaste', 'remnant', 'minSheets'];
const CUTTING_GAP_MM = 5;

type JsonPoint = {
  x: number;
  y: number;
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

    const groupTotalParts = Array.from(quantities.values()).reduce((sum, quantity) => sum + quantity, 0);
    totalParts += groupTotalParts;

    const sheets = await findSuitableSheets(material, thickness);
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
      gap: CUTTING_GAP_MM,
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

async function findSuitableSheets(material: string, thickness: number): Promise<SheetOption[]> {
  const sheets: SheetOption[] = [];
  const remnants = await prisma.remnant.findMany({
    where: { material, thickness, isAvailable: true },
    orderBy: { createdAt: 'asc' },
  });

  for (const remnant of remnants) {
    sheets.push({
      id: remnant.id,
      width: remnant.width,
      height: remnant.height,
      material: remnant.material,
      thickness: remnant.thickness,
      isRemnant: true,
      priority: 0,
    });
  }

  const catalogSheets = await prisma.sheetCatalog.findMany({
    where: { material, thickness, isActive: true },
    orderBy: [{ width: 'desc' }, { height: 'desc' }],
  });

  for (const sheet of catalogSheets) {
    sheets.push({
      id: sheet.id,
      width: sheet.width,
      height: sheet.height,
      material: sheet.material,
      thickness: sheet.thickness,
      isRemnant: false,
      priority: 1,
    });
  }

  return sheets.sort((a, b) => a.priority - b.priority || b.width * b.height - a.width * a.height);
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
