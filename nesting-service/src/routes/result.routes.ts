import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../lib/errors';
import { createLeadSegments, type LeadSegment } from '../lib/dxf/leads';
import { readFittedPartGeometry } from '../lib/dxf/part-geometry';
import { ensureCCW, ensureCW, removeClosingPoint, transformContourForDxf, type DxfRotation } from '../lib/dxf/transform';
import { prisma } from '../lib/prisma';
import { normalizeCadText } from '../lib/text-encoding';
import type { UnplacedPart } from '../lib/nesting/types';
import {
  buildUnplacedReasonQueues,
  createUnplacedPart,
  fallbackUnplacedReason,
  takeUnplacedReason,
} from '../lib/nesting/unplaced-reasons';
import { idParamSchema } from '../schemas/common.schema';
import { projectSheetParamsSchema } from '../schemas/project.schema';
import { isCompletedProjectStatus } from '../lib/project-status';
import { excludedReasonCode, isSheetPartType, partTypeLabel } from '../lib/part-type';
import { isPartActive, summarizePartActivity } from '../lib/part-activity';

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
  dimensionMismatch?: boolean;
  mismatchNote?: string | null;
  contourSource?: string;
  contourStale?: boolean;
  bendCount?: number;
  kFactor?: number | null;
  kFactorDefaulted?: boolean;
};

type JsonPoint = {
  x: number;
  y: number;
};

type RemnantCandidateForResult = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  isUsable: boolean;
};

type RemnantPayload = {
  primary: RemnantCandidateForResult | null;
  candidates: RemnantCandidateForResult[];
  selectedIds: string[];
  selectedRemnants: RemnantCandidateForResult[];
};

const LEAD_IN_LENGTH_MM = 3;
const LEAD_OUT_LENGTH_MM = 2;

const updateRemnantsSchema = z.object({
  selectedRemnantIds: z.array(z.string().min(1)).max(10),
});

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

    if (!isCompletedProjectStatus(project.status)) {
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
      const placements = enrichPlacements(basePlacements, partsById, sheet.width, sheet.height, sheet.usedMargin);

      for (const placement of placements) {
        placedParts += 1;
        placedByPartId.set(placement.partId, (placedByPartId.get(placement.partId) ?? 0) + 1);
      }

      const remnantPayload = readRemnantPayload(sheet.remnantGeom);

      return {
        id: sheet.id,
        sheetIndex: sheet.sheetIndex,
        material: normalizeCadText(sheet.material),
        steelTypeId: sheet.steelTypeId,
        steelTypeName: sheet.steelTypeName,
        thickness: sheet.thickness,
        width: sheet.width,
        height: sheet.height,
        usedGap: sheet.usedGap,
        usedMargin: sheet.usedMargin,
        isRemnant: Boolean(sheet.remnantId),
        placements,
        utilization: sheet.utilization,
        bboxUtilization: sheet.bboxUtilization,
        waste: sheet.waste,
        remnantGeom: remnantPayload.primary,
        remnantCandidates: remnantPayload.candidates,
        selectedRemnants: remnantPayload.selectedRemnants,
      };
    });

    const activeProjectParts = project.parts.filter(isPartActive);
    const activitySummary = summarizePartActivity(project.parts, project.quantity);
    const totalParts = activitySummary.activeParts;
    const unplacedParts: UnplacedPart[] = [];
    const unplacedReasonQueues = buildUnplacedReasonQueues(project.validationReport);

    for (const part of activeProjectParts) {
      const required = part.quantity * project.quantity;
      const placed = placedByPartId.get(part.id) ?? 0;
      const baseName = normalizeCadText(part.name);
      const material = normalizeCadText(part.material);

      if (!isSheetPartType(part.partType, part.isSheetMetal)) {
        const reason = buildExcludedFromNestingReason(part);
        const reasonCode = excludedReasonCode(part.partType);
        for (let index = 1; index <= required; index += 1) {
          unplacedParts.push(createUnplacedPart({
            partId: part.id,
            baseName,
            copyIndex: index,
            reasonCode,
            reason,
            material,
            steelTypeName: part.steelTypeName,
            thickness: part.thickness,
            requiredWidth: part.width,
            requiredHeight: part.height,
          }));
        }
        continue;
      }

      for (let index = placed + 1; index <= required; index += 1) {
        const reasonInfo = takeUnplacedReason(unplacedReasonQueues, part.id, {
          ...fallbackUnplacedReason(),
          material,
          steelTypeName: part.steelTypeName,
          thickness: part.thickness,
          requiredWidth: part.width,
          requiredHeight: part.height,
        });

        unplacedParts.push(createUnplacedPart({
          partId: part.id,
          baseName,
          copyIndex: index,
          reasonCode: reasonInfo.reasonCode,
          reason: reasonInfo.reason,
          material: reasonInfo.material,
          steelTypeName: reasonInfo.steelTypeName,
          thickness: reasonInfo.thickness,
          requiredWidth: reasonInfo.requiredWidth,
          requiredHeight: reasonInfo.requiredHeight,
        }));
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
        totalBodies: activitySummary.totalBodies,
        activeParts: activitySummary.activeParts,
        inactiveParts: activitySummary.inactiveParts,
        placedParts,
        profileParts: unplacedParts.filter((part) => part.reasonCode === 'EXCLUDED_PROFILE').length,
        purchasedParts: unplacedParts.filter((part) => part.reasonCode === 'EXCLUDED_PURCHASED').length,
        noSheetParts: unplacedParts.filter((part) => part.reasonCode === 'NO_SHEET_AVAILABLE').length,
        totalSheets: sheets.length,
        avgUtilization,
        totalWaste,
        validationReport: project.validationReport,
      },
    };
  });

  app.put('/:id/sheets/:sheetId/remnants', async (request) => {
    const { id, sheetId } = projectSheetParamsSchema.parse(request.params);
    const body = updateRemnantsSchema.parse(request.body);
    const selectedIds = Array.from(new Set(body.selectedRemnantIds));
    const sheet = await prisma.nestingSheet.findFirst({
      where: { id: sheetId, projectId: id },
      select: { id: true, remnantGeom: true },
    });

    if (!sheet) {
      throw new NotFoundError('Лист раскладки', sheetId);
    }

    const payload = readRemnantPayload(sheet.remnantGeom);
    const candidateById = new Map(payload.candidates.map((candidate) => [candidate.id, candidate]));

    for (const selectedId of selectedIds) {
      if (!candidateById.has(selectedId)) {
        throw new ValidationError(`Остаток ${selectedId} не найден среди кандидатов листа`);
      }
    }

    const selectedRemnants = selectedIds.map((selectedId) => candidateById.get(selectedId)!);
    validateNonOverlappingRemnants(selectedRemnants);

    const nextStorage = createRemnantStorage(payload.candidates, selectedIds);
    await prisma.nestingSheet.update({
      where: { id: sheetId },
      data: { remnantGeom: nextStorage === null ? Prisma.JsonNull : nextStorage as Prisma.InputJsonValue },
    });

    const nextPayload = readRemnantPayload(nextStorage);
    return {
      data: {
        remnantGeom: nextPayload.primary,
        remnantCandidates: nextPayload.candidates,
        selectedRemnants: nextPayload.selectedRemnants,
      },
    };
  });
}

function buildExcludedFromNestingReason(part: {
  partType?: string | null;
  classificationMethod: string | null;
  classificationWarning: string | null;
}): string {
  const typeLabel = partTypeLabel(part.partType);
  if (part.classificationMethod === 'manual') {
    return `ручная метка "${typeLabel} — не для листового раскроя"`;
  }

  if (part.classificationMethod === 'pdf_bom') {
    return `PDF/BOM указал ${typeLabel.toLowerCase()} — не для листового раскроя`;
  }

  return part.classificationWarning || `автоматическая классификация: ${typeLabel.toLowerCase()} — не для листового раскроя`;
}

function readPlacements(value: unknown): PlacementForResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPlacementForResult);
}

function enrichPlacements(
  placements: PlacementForResult[],
  partsById: Map<string, {
    id: string;
    width: number;
    height: number;
    contour: unknown;
    holes: unknown;
    contourSource: string;
    contourStale: boolean;
    bendCount: number;
    kFactor: number | null;
    kFactorDefaulted: boolean;
    dimensionMismatch: boolean;
    mismatchNote: string | null;
  }>,
  sheetWidth: number,
  sheetHeight: number,
  usedMargin: number
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
    const placedW = Number(placement.placedW);
    const placedH = Number(placement.placedH);
    const rotation = readRotation(placement.rotation);

    if (
      !part ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(placedW) ||
      !Number.isFinite(placedH) ||
      rotation === null
    ) {
      return part ? {
        ...placement,
        contourSource: part.contourSource,
        contourStale: part.contourStale,
        bendCount: part.bendCount,
        kFactor: part.kFactor,
        kFactorDefaulted: part.kFactorDefaulted,
        dimensionMismatch: part.dimensionMismatch,
        mismatchNote: part.mismatchNote,
      } : placement;
    }

    const localWidth = isQuarterTurn(rotation) ? placedH : placedW;
    const localHeight = isQuarterTurn(rotation) ? placedW : placedH;
    const { contour, holes } = readFittedPartGeometry(part.contour, part.holes, localWidth, localHeight, {
      contourStale: part.contourStale,
    });
    const localOuterContour = ensureCW(
      removeClosingPoint(transformContourForDxf(contour, rotation, 0, 0, localWidth, localHeight))
    );
    const localHoleContours = holes.map((hole) =>
      ensureCCW(removeClosingPoint(transformContourForDxf(hole, rotation, 0, 0, localWidth, localHeight)))
    );
    const leadResults = [
      createLeadSegments(localOuterContour, { x, y }, index, 'outer', { width: sheetWidth, height: sheetHeight }, boxes, {
        leadInLength: LEAD_IN_LENGTH_MM,
        leadOutLength: LEAD_OUT_LENGTH_MM,
        safeMargin: usedMargin,
      }),
      ...localHoleContours.map((hole, holeIndex) =>
        createLeadSegments(hole, { x, y }, index, `hole-${holeIndex + 1}`, { width: sheetWidth, height: sheetHeight }, boxes, {
          leadInLength: LEAD_IN_LENGTH_MM,
          leadOutLength: LEAD_OUT_LENGTH_MM,
          safeMargin: usedMargin,
        })
      ),
    ];
    const leadSegments = leadResults.flatMap((result) => result.segments);

    return {
      ...placement,
      contourSource: part.contourSource,
      contourStale: part.contourStale,
      bendCount: part.bendCount,
      kFactor: part.kFactor,
      kFactorDefaulted: part.kFactorDefaulted,
      dimensionMismatch: part.dimensionMismatch,
      mismatchNote: part.mismatchNote,
      contour: transformContourForDxf(contour, rotation, x, y, localWidth, localHeight).map(roundPoint),
      holes: holes.map((hole) => transformContourForDxf(hole, rotation, x, y, localWidth, localHeight).map(roundPoint)),
      leadIn: leadSegments.filter((segment) => segment.kind === 'leadIn').map((segment) => translateLeadSegment(segment, x, y)),
      leadOut: leadSegments.filter((segment) => segment.kind === 'leadOut').map((segment) => translateLeadSegment(segment, x, y)),
    };
  });
}

function isQuarterTurn(rotation: DxfRotation): boolean {
  return rotation === 90 || rotation === 270;
}

function readRotation(value: unknown): DxfRotation | null {
  return value === 0 || value === 90 || value === 180 || value === 270 ? value : null;
}

function translateLeadSegment(segment: LeadSegment, offsetX: number, offsetY: number): LeadSegmentForResult {
  return {
    from: roundPoint({ x: segment.from.x + offsetX, y: segment.from.y + offsetY }),
    to: roundPoint({ x: segment.to.x + offsetX, y: segment.to.y + offsetY }),
  };
}

function readRemnantPayload(value: unknown): RemnantPayload {
  const record = isRecord(value) ? value : null;
  const candidates = Array.isArray(record?.candidates)
    ? record.candidates.map(readRemnantCandidate).filter((candidate): candidate is RemnantCandidateForResult => candidate !== null)
    : [];
  const legacy = readRemnantCandidate(value);
  const normalizedCandidates = uniqueRemnants(candidates.length > 0 ? candidates : legacy ? [legacy] : []);
  const selectedIds = Array.isArray(record?.selectedIds)
    ? record.selectedIds.filter((id): id is string => typeof id === 'string')
    : normalizedCandidates.length > 0 && legacy?.isUsable !== false
      ? [normalizedCandidates[0].id]
      : [];
  const selectedSet = new Set(selectedIds);
  const selectedRemnants = normalizedCandidates.filter((candidate) => selectedSet.has(candidate.id));
  const primary = selectedRemnants.sort(compareRemnants)[0] ?? null;

  return {
    primary,
    candidates: normalizedCandidates,
    selectedIds: selectedRemnants.map((candidate) => candidate.id),
    selectedRemnants,
  };
}

function createRemnantStorage(candidates: RemnantCandidateForResult[], selectedIds: string[]): Record<string, unknown> | null {
  if (candidates.length === 0) {
    return null;
  }

  const selectedSet = new Set(selectedIds);
  const selectedRemnants = candidates.filter((candidate) => selectedSet.has(candidate.id)).sort(compareRemnants);
  const base = selectedRemnants[0] ?? candidates[0];

  return {
    ...base,
    isUsable: selectedRemnants.length > 0,
    candidates,
    selectedIds: selectedRemnants.map((candidate) => candidate.id),
  };
}

function readRemnantCandidate(value: unknown): RemnantCandidateForResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  const area = Number.isFinite(Number(value.area)) ? Number(value.area) : Math.round(width * height);
  const candidate = {
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : remnantId({ x, y, width, height }),
    x: roundMm(x),
    y: roundMm(y),
    width: roundMm(width),
    height: roundMm(height),
    area: Math.round(area),
    isUsable: value.isUsable !== false,
  };

  return candidate;
}

function uniqueRemnants(candidates: RemnantCandidateForResult[]): RemnantCandidateForResult[] {
  const byId = new Map<string, RemnantCandidateForResult>();
  for (const candidate of candidates) {
    byId.set(candidate.id, candidate);
  }
  return Array.from(byId.values()).sort(compareRemnants);
}

function validateNonOverlappingRemnants(remnants: RemnantCandidateForResult[]): void {
  for (let leftIndex = 0; leftIndex < remnants.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < remnants.length; rightIndex += 1) {
      if (remnantsOverlap(remnants[leftIndex], remnants[rightIndex])) {
        throw new ValidationError('Выбранные деловые остатки пересекаются. Оставьте один из пересекающихся вариантов.');
      }
    }
  }
}

function remnantsOverlap(left: RemnantCandidateForResult, right: RemnantCandidateForResult): boolean {
  return !(
    left.x + left.width <= right.x + 0.001 ||
    right.x + right.width <= left.x + 0.001 ||
    left.y + left.height <= right.y + 0.001 ||
    right.y + right.height <= left.y + 0.001
  );
}

function compareRemnants(left: RemnantCandidateForResult, right: RemnantCandidateForResult): number {
  return right.area - left.area || right.width - left.width || right.height - left.height || left.y - right.y || left.x - right.x;
}

function remnantId(rect: Pick<RemnantCandidateForResult, 'x' | 'y' | 'width' | 'height'>): string {
  return [roundMm(rect.x), roundMm(rect.y), roundMm(rect.width), roundMm(rect.height)].join(':');
}

function roundPoint(point: JsonPoint): JsonPoint {
  return {
    x: Math.round(point.x * 10) / 10,
    y: Math.round(point.y * 10) / 10,
  };
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
