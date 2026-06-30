import type { FastifyInstance } from 'fastify';
import { NotFoundError, ValidationError } from '../lib/errors';
import { createLeadSegments, type LeadSegment } from '../lib/dxf/leads';
import { ensureCCW, ensureCW, removeClosingPoint, transformContourForDxf, type DxfRotation } from '../lib/dxf/transform';
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

type LeadSegmentForResult = {
  from: JsonPoint;
  to: JsonPoint;
};

type EnrichedPlacementForResult = PlacementForResult & {
  contour?: JsonPoint[];
  holes?: JsonPoint[][];
  leadIn?: LeadSegmentForResult[];
  leadOut?: LeadSegmentForResult[];
};

type JsonPoint = {
  x: number;
  y: number;
};

const LEAD_IN_LENGTH_MM = 3;
const LEAD_OUT_LENGTH_MM = 2;

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

    const partsById = new Map(project.parts.map((part) => [part.id, part]));

    const sheets = project.sheets.map((sheet) => {
      const basePlacements = readPlacements(sheet.placements).map((placement) => ({
        ...placement,
        name: placement.name ? normalizeCadText(placement.name) : placement.name,
      }));
      const placements = enrichPlacements(basePlacements, partsById, sheet.width, sheet.height);

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

function enrichPlacements(
  placements: PlacementForResult[],
  partsById: Map<string, { id: string; width: number; height: number; contour: unknown; holes: unknown }>,
  sheetWidth: number,
  sheetHeight: number
): EnrichedPlacementForResult[] {
  const boxes = placements
    .map((placement, index) => ({
      index,
      x: Number(placement.x),
      y: Number(placement.y),
      width: Number(placement.placedW),
      height: Number(placement.placedH),
    }))
    .filter((box) => [box.x, box.y, box.width, box.height].every(Number.isFinite));

  return placements.map((placement, index) => {
    const part = partsById.get(placement.partId);
    const x = Number(placement.x);
    const y = Number(placement.y);
    const rotation = readRotation(placement.rotation);

    if (!part || !Number.isFinite(x) || !Number.isFinite(y) || rotation === null) {
      return placement;
    }

    const contour = readPointArray(part.contour, part.width, part.height);
    const holes = readHoles(part.holes);
    const localOuterContour = ensureCW(
      removeClosingPoint(transformContourForDxf(contour, rotation, 0, 0, part.width, part.height))
    );
    const localHoleContours = holes.map((hole) =>
      ensureCCW(removeClosingPoint(transformContourForDxf(hole, rotation, 0, 0, part.width, part.height)))
    );
    const leadResults = [
      createLeadSegments(localOuterContour, { x, y }, index, 'outer', { width: sheetWidth, height: sheetHeight }, boxes, {
        leadInLength: LEAD_IN_LENGTH_MM,
        leadOutLength: LEAD_OUT_LENGTH_MM,
      }),
      ...localHoleContours.map((hole, holeIndex) =>
        createLeadSegments(hole, { x, y }, index, `hole-${holeIndex + 1}`, { width: sheetWidth, height: sheetHeight }, boxes, {
          leadInLength: LEAD_IN_LENGTH_MM,
          leadOutLength: LEAD_OUT_LENGTH_MM,
        })
      ),
    ];
    const leadSegments = leadResults.flatMap((result) => result.segments);

    return {
      ...placement,
      contour: transformContourForDxf(contour, rotation, x, y, part.width, part.height).map(roundPoint),
      holes: holes.map((hole) => transformContourForDxf(hole, rotation, x, y, part.width, part.height).map(roundPoint)),
      leadIn: leadSegments.filter((segment) => segment.kind === 'leadIn').map((segment) => translateLeadSegment(segment, x, y)),
      leadOut: leadSegments.filter((segment) => segment.kind === 'leadOut').map((segment) => translateLeadSegment(segment, x, y)),
    };
  });
}

function readRotation(value: unknown): DxfRotation | null {
  return value === 0 || value === 90 || value === 180 || value === 270 ? value : null;
}

function readPointArray(value: unknown, width: number, height: number): JsonPoint[] {
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

function readHoles(value: unknown): JsonPoint[][] {
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
  return typeof record?.x === 'number' && typeof record?.y === 'number';
}

function translateLeadSegment(segment: LeadSegment, offsetX: number, offsetY: number): LeadSegmentForResult {
  return {
    from: roundPoint({ x: segment.from.x + offsetX, y: segment.from.y + offsetY }),
    to: roundPoint({ x: segment.to.x + offsetX, y: segment.to.y + offsetY }),
  };
}

function roundPoint(point: JsonPoint): JsonPoint {
  return {
    x: Math.round(point.x * 10) / 10,
    y: Math.round(point.y * 10) / 10,
  };
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
