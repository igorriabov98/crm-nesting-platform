import type { FastifyInstance } from 'fastify';
import { NotFoundError, ValidationError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { normalizeCadText } from '../lib/text-encoding';
import { idParamSchema } from '../schemas/common.schema';

type PlacementForResult = {
  partId: string;
  name?: string;
  sourceInputId?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  sourceLabel?: string | null;
  sourceMachineId?: string | null;
  sourceMachineName?: string | null;
  sourceMachineItemId?: string | null;
  sourceProductId?: string | null;
  x?: number;
  y?: number;
  rotation?: number;
  placedW?: number;
  placedH?: number;
};

export async function resultRoutes(app: FastifyInstance) {
  app.get('/:id/result', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const project = await prisma.nestingProject.findUnique({
      where: { id },
      include: {
        parts: true,
        sheets: {
          orderBy: { sheetIndex: 'asc' },
        },
      },
    });

    if (!project) {
      throw new NotFoundError('Проект', id);
    }

    if (project.status !== 'done') {
      throw new ValidationError(`Расчёт ещё не завершён. Статус: ${project.status}`);
    }

    const placedByPartId = new Map<string, number>();
    let placedParts = 0;

    const sheets = project.sheets.map((sheet) => {
      const placements = readPlacements(sheet.placements).map((placement) => ({
        ...placement,
        name: placement.name ? normalizeCadText(placement.name) : placement.name,
      }));

      for (const placement of placements) {
        placedParts += 1;
        placedByPartId.set(placement.partId, (placedByPartId.get(placement.partId) ?? 0) + 1);
      }

      return {
        id: sheet.id,
        sheetIndex: sheet.sheetIndex,
        material: normalizeCadText(sheet.material),
        steelTypeId: sheet.steelTypeId,
        steelTypeName: sheet.steelTypeName,
        thickness: sheet.thickness,
        width: sheet.width,
        height: sheet.height,
        isRemnant: Boolean(sheet.remnantId),
        placements,
        utilization: sheet.utilization,
        waste: sheet.waste,
        remnantGeom: sheet.remnantGeom,
      };
    });

    const sheetMetalParts = project.parts.filter((part) => part.isSheetMetal);
    const totalParts = sheetMetalParts.reduce((sum, part) => sum + part.quantity * project.quantity, 0);
    const unplacedParts: { partId: string; name: string }[] = [];

    for (const part of sheetMetalParts) {
      const required = part.quantity * project.quantity;
      const placed = placedByPartId.get(part.id) ?? 0;

      for (let index = placed + 1; index <= required; index += 1) {
        unplacedParts.push({ partId: part.id, name: `${normalizeCadText(part.name)} (#${index})` });
      }
    }

    const avgUtilization =
      sheets.length > 0 ? roundPercent(sheets.reduce((sum, sheet) => sum + sheet.utilization, 0) / sheets.length) : 0;
    const totalWaste =
      sheets.length > 0 ? roundPercent(sheets.reduce((sum, sheet) => sum + sheet.waste, 0) / sheets.length) : 0;

    return {
      data: {
        sheets,
        unplacedParts,
        totalParts,
        placedParts,
        totalSheets: sheets.length,
        avgUtilization,
        totalWaste,
      },
    };
  });
}

function readPlacements(value: unknown): PlacementForResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPlacementForResult);
}

function isPlacementForResult(value: unknown): value is PlacementForResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'partId' in value &&
    typeof value.partId === 'string'
  );
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}
