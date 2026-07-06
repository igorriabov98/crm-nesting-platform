import type { NestingProject, NestingSheet, Part } from '@prisma/client';
import { ValidationError, NotFoundError } from '../errors';
import { CAM_DXF_OPTIONS, type DxfGenerationOptions, type DxfPartData, type DxfRemnantData } from '../dxf/generator';
import { readFittedPartGeometry } from '../dxf/part-geometry';
import type { DxfRotation } from '../dxf/transform';
import { prisma } from '../prisma';
import { normalizeCadText } from '../text-encoding';
import { isCompletedProjectStatus } from '../project-status';

export type PlacementForExport = {
  partId: string;
  name?: string;
  x: number;
  y: number;
  rotation: DxfRotation;
  placedW: number;
  placedH: number;
};

export type SheetExportGeometry = {
  project: NestingProject;
  sheet: NestingSheet;
  placements: PlacementForExport[];
  dxfParts: DxfPartData[];
  remnant: DxfRemnantData | null;
  material: string;
  leadSafeMargin: number;
};

export async function buildSheetExportGeometry(projectId: string, sheetId: string): Promise<SheetExportGeometry> {
  const project = await prisma.nestingProject.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new NotFoundError('Project', projectId);
  }

  if (!isCompletedProjectStatus(project.status)) {
    throw new ValidationError(`Calculation is not finished. Status: ${project.status}`);
  }

  const sheet = await prisma.nestingSheet.findUnique({
    where: { id: sheetId },
  });

  if (!sheet || sheet.projectId !== projectId) {
    throw new NotFoundError('Sheet', sheetId);
  }

  const placements = readPlacements(sheet.placements, sheetId);
  const partIds = Array.from(new Set(placements.map((placement) => placement.partId)));
  const parts = await prisma.part.findMany({
    where: { id: { in: partIds }, projectId },
  });
  const partsById = new Map(parts.map((part) => [part.id, part]));

  const dxfParts = placements.map((placement) => {
    const part = partsById.get(placement.partId);

    if (!part) {
      throw new ValidationError(`Placement references missing part ${placement.partId}`);
    }

    return toDxfPartData(placement, part);
  });

  return {
    project,
    sheet,
    placements,
    dxfParts,
    remnant: readRemnant(sheet.remnantGeom, sheetId),
    material: normalizeCadText(sheet.material),
    leadSafeMargin: sheet.usedMargin,
  };
}

export function dxfOptionsForSheet(geometry: Pick<SheetExportGeometry, 'leadSafeMargin'>): DxfGenerationOptions {
  return {
    ...CAM_DXF_OPTIONS,
    leadSafeMargin: geometry.leadSafeMargin,
  };
}

function toDxfPartData(placement: PlacementForExport, part: Part): DxfPartData {
  const localWidth = isQuarterTurn(placement.rotation) ? placement.placedH : placement.placedW;
  const localHeight = isQuarterTurn(placement.rotation) ? placement.placedW : placement.placedH;
  const { contour, holes, needsReview, reviewReason } = readFittedPartGeometry(part.contour, part.holes, localWidth, localHeight, {
    contourStale: part.contourStale,
  });

  return {
    name: normalizeCadText(placement.name || part.name),
    x: placement.x,
    y: placement.y,
    rotation: placement.rotation,
    placedW: placement.placedW,
    placedH: placement.placedH,
    contour,
    holes,
    originalW: localWidth,
    originalH: localHeight,
    grainLock: part.grainLock,
    needsReview,
    reviewReason,
    contourSource: part.contourSource,
  };
}

function readPlacements(value: unknown, sheetId: string): PlacementForExport[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`Sheet ${sheetId} placements are not an array`);
  }

  return value.map((placement, index) => readPlacement(placement, sheetId, index));
}

function readPlacement(value: unknown, sheetId: string, index: number): PlacementForExport {
  if (!isRecord(value)) {
    throw new ValidationError(`Sheet ${sheetId} placement #${index + 1} is not an object`);
  }

  const rotation = readRotation(value.rotation);

  if (
    typeof value.partId !== 'string' ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    rotation === null ||
    !isFiniteNumber(value.placedW) ||
    !isFiniteNumber(value.placedH)
  ) {
    throw new ValidationError(`Sheet ${sheetId} placement #${index + 1} has invalid geometry`);
  }

  if (value.placedW <= 0 || value.placedH <= 0) {
    throw new ValidationError(`Sheet ${sheetId} placement #${index + 1} has non-positive size`);
  }

  return {
    partId: value.partId,
    name: typeof value.name === 'string' ? value.name : undefined,
    x: value.x,
    y: value.y,
    rotation,
    placedW: value.placedW,
    placedH: value.placedH,
  };
}

function readRemnant(value: unknown, sheetId: string): DxfRemnantData | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new ValidationError(`Sheet ${sheetId} remnant geometry is invalid`);
  }

  if (value.isUsable === false) {
    return null;
  }

  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.width) || !isFiniteNumber(value.height)) {
    throw new ValidationError(`Sheet ${sheetId} remnant geometry has invalid dimensions`);
  }

  if (value.width <= 0 || value.height <= 0) {
    return null;
  }

  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  };
}

function readRotation(value: unknown): DxfRotation | null {
  if (value === 0 || value === 90 || value === 180 || value === 270) {
    return value;
  }

  return null;
}

function isQuarterTurn(rotation: DxfRotation): boolean {
  return rotation === 90 || rotation === 270;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
