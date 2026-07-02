import type { NestingParams, NestingPart, PlacedPart, Point2D } from './types';

type Rotation = PlacedPart['rotation'];

type Candidate = {
  x: number;
  y: number;
  rotation: Rotation;
  placedW: number;
  placedH: number;
  attachmentScore: number;
};

const EPSILON_MM = 0.001;
const SORT_STRATEGIES: Array<(parts: NestingPart[], params: NestingParams) => NestingPart[]> = [
  (parts, params) => sortPartsByStrategy(parts, params.strategy),
  (parts) => [...parts].sort((a, b) => b.width * b.height - a.width * a.height),
  (parts) => [...parts].sort((a, b) => b.height - a.height || b.width - a.width),
  (parts) => [...parts].sort((a, b) => b.width - a.width || b.height - a.height),
  (parts) => [...parts].sort((a, b) => (b.width + b.height) - (a.width + a.height)),
  (parts) => [...parts].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height)),
];

export function nestOnSheet(
  parts: NestingPart[],
  sheetW: number,
  sheetH: number,
  params: NestingParams
): { placed: PlacedPart[]; unplaced: NestingPart[] } {
  return placePartsInOrder(sortPartsByStrategy(parts, params.strategy), sheetW, sheetH, params);
}

export function nestOnSheetOptimized(
  parts: NestingPart[],
  sheetW: number,
  sheetH: number,
  params: NestingParams
): { placed: PlacedPart[]; unplaced: NestingPart[] } {
  let best: { placed: PlacedPart[]; unplaced: NestingPart[] } | null = null;

  for (const sortParts of SORT_STRATEGIES) {
    const result = placePartsInOrder(sortParts(parts, params), sheetW, sheetH, params);

    if (!best || isBetterOptimizedResult(result, best, sheetW, sheetH)) {
      best = result;
    }
  }

  return best ?? { placed: [], unplaced: [...parts] };
}

function placePartsInOrder(
  parts: NestingPart[],
  sheetW: number,
  sheetH: number,
  params: NestingParams
): { placed: PlacedPart[]; unplaced: NestingPart[] } {
  const placed: PlacedPart[] = [];
  const unplaced: NestingPart[] = [];

  for (const part of parts) {
    const candidate = findBestCandidate(part, placed, sheetW, sheetH, params);

    if (!candidate) {
      unplaced.push(part);
      continue;
    }

    placed.push({
      partId: part.id,
      name: part.name,
      sourceInputId: part.sourceInputId,
      sourceId: part.sourceId,
      sourceType: part.sourceType,
      sourceLabel: part.sourceLabel,
      sourceMachineId: part.sourceMachineId,
      sourceMachineName: part.sourceMachineName,
      sourceMachineItemId: part.sourceMachineItemId,
      sourceProductId: part.sourceProductId,
      x: roundMm(candidate.x),
      y: roundMm(candidate.y),
      rotation: candidate.rotation,
      placedW: candidate.placedW,
      placedH: candidate.placedH,
      contour: transformContour(part.contour, candidate.rotation, candidate.x, candidate.y, part.width, part.height),
      holes: part.holes.map((hole) =>
        transformContour(hole, candidate.rotation, candidate.x, candidate.y, part.width, part.height)
      ),
    });
  }

  return { placed, unplaced };
}

function isBetterOptimizedResult(
  candidate: { placed: PlacedPart[]; unplaced: NestingPart[] },
  best: { placed: PlacedPart[]; unplaced: NestingPart[] },
  sheetW: number,
  sheetH: number
): boolean {
  if (candidate.placed.length !== best.placed.length) {
    return candidate.placed.length > best.placed.length;
  }

  const candidateUtilization = placementArea(candidate.placed) / (sheetW * sheetH);
  const bestUtilization = placementArea(best.placed) / (sheetW * sheetH);
  if (Math.abs(candidateUtilization - bestUtilization) > EPSILON_MM) {
    return candidateUtilization > bestUtilization;
  }

  const candidateBounds = placementBounds(candidate.placed);
  const bestBounds = placementBounds(best.placed);
  if (Math.abs(candidateBounds.area - bestBounds.area) > EPSILON_MM) {
    return candidateBounds.area < bestBounds.area;
  }

  if (Math.abs(candidateBounds.maxY - bestBounds.maxY) > EPSILON_MM) {
    return candidateBounds.maxY < bestBounds.maxY;
  }

  if (Math.abs(candidateBounds.maxX - bestBounds.maxX) > EPSILON_MM) {
    return candidateBounds.maxX < bestBounds.maxX;
  }

  return false;
}

function placementArea(placements: PlacedPart[]): number {
  return placements.reduce((sum, placement) => sum + placement.placedW * placement.placedH, 0);
}

function placementBounds(placements: PlacedPart[]): { area: number; maxX: number; maxY: number } {
  if (placements.length === 0) {
    return { area: Number.POSITIVE_INFINITY, maxX: Number.POSITIVE_INFINITY, maxY: Number.POSITIVE_INFINITY };
  }

  const minX = Math.min(...placements.map((placement) => placement.x));
  const minY = Math.min(...placements.map((placement) => placement.y));
  const maxX = Math.max(...placements.map((placement) => placement.x + placement.placedW));
  const maxY = Math.max(...placements.map((placement) => placement.y + placement.placedH));

  return {
    area: (maxX - minX) * (maxY - minY),
    maxX,
    maxY,
  };
}

export function sortPartsByStrategy(
  parts: NestingPart[],
  strategy: 'minWaste' | 'remnant' | 'minSheets'
): NestingPart[] {
  const sorted = [...parts];

  switch (strategy) {
    case 'minWaste':
    case 'minSheets':
      sorted.sort((a, b) => b.width * b.height - a.width * a.height);
      break;
    case 'remnant':
      sorted.sort((a, b) => b.height - a.height || b.width - a.width);
      break;
  }

  return sorted;
}

export function transformContour(
  contour: Point2D[],
  rotation: Rotation,
  offsetX: number,
  offsetY: number,
  partW: number,
  partH: number
): Point2D[] {
  return contour.map((point) => {
    let x: number;
    let y: number;

    switch (rotation) {
      case 0:
        x = point.x;
        y = point.y;
        break;
      case 90:
        x = partH - point.y;
        y = point.x;
        break;
      case 180:
        x = partW - point.x;
        y = partH - point.y;
        break;
      case 270:
        x = point.y;
        y = partW - point.x;
        break;
    }

    return {
      x: roundMm(x + offsetX),
      y: roundMm(y + offsetY),
    };
  });
}

function findBestCandidate(
  part: NestingPart,
  placed: PlacedPart[],
  sheetW: number,
  sheetH: number,
  params: NestingParams
): Candidate | null {
  const rotations: Rotation[] = part.grainLock ? [0] : [0, 90];
  let best: Candidate | null = null;
  const { gap, margin } = params;

  for (const rotation of rotations) {
    const placedW = rotation === 90 || rotation === 270 ? part.height : part.width;
    const placedH = rotation === 90 || rotation === 270 ? part.width : part.height;

    if (!fitsInsideSheet(placedW, placedH, sheetW, sheetH, margin)) {
      continue;
    }

    for (const x of buildCandidateCoordinates('x', placed, placedW, sheetW, gap, margin)) {
      for (const y of buildCandidateCoordinates('y', placed, placedH, sheetH, gap, margin)) {
        if (!isCandidateValid(x, y, placedW, placedH, placed, sheetW, sheetH, gap, margin)) {
          continue;
        }

        const candidate: Candidate = {
          x,
          y,
          rotation,
          placedW,
          placedH,
          attachmentScore: computeAttachmentScore(x, y, placedW, placedH, placed, sheetW, sheetH, gap, margin),
        };

        if (!best || isBetterCandidate(candidate, best, params.strategy)) {
          best = candidate;
        }
      }
    }
  }

  return best;
}

function fitsInsideSheet(placedW: number, placedH: number, sheetW: number, sheetH: number, margin: number): boolean {
  return (
    placedW > 0 &&
    placedH > 0 &&
    placedW <= sheetW - margin * 2 + EPSILON_MM &&
    placedH <= sheetH - margin * 2 + EPSILON_MM
  );
}

function buildCandidateCoordinates(
  axis: 'x' | 'y',
  placed: PlacedPart[],
  size: number,
  sheetSize: number,
  gap: number,
  margin: number
): number[] {
  const values = new Set<number>([margin, sheetSize - margin - size]);

  for (const existing of placed) {
    const start = axis === 'x' ? existing.x : existing.y;
    const existingSize = axis === 'x' ? existing.placedW : existing.placedH;

    values.add(start + existingSize + gap);
    values.add(start - size - gap);
  }

  return Array.from(values)
    .map(roundMm)
    .filter((value) => value >= margin - EPSILON_MM && value + size <= sheetSize - margin + EPSILON_MM)
    .sort((a, b) => a - b);
}

function isCandidateValid(
  x: number,
  y: number,
  placedW: number,
  placedH: number,
  placed: PlacedPart[],
  sheetW: number,
  sheetH: number,
  gap: number,
  margin: number
): boolean {
  if (
    x < margin - EPSILON_MM ||
    y < margin - EPSILON_MM ||
    x + placedW > sheetW - margin + EPSILON_MM ||
    y + placedH > sheetH - margin + EPSILON_MM
  ) {
    return false;
  }

  return placed.every((existing) => !rectanglesConflict({ x, y, placedW, placedH }, existing, gap));
}

function rectanglesConflict(
  candidate: { x: number; y: number; placedW: number; placedH: number },
  existing: Pick<PlacedPart, 'x' | 'y' | 'placedW' | 'placedH'>,
  gap: number
): boolean {
  return !(
    candidate.x + candidate.placedW + gap <= existing.x + EPSILON_MM ||
    existing.x + existing.placedW + gap <= candidate.x + EPSILON_MM ||
    candidate.y + candidate.placedH + gap <= existing.y + EPSILON_MM ||
    existing.y + existing.placedH + gap <= candidate.y + EPSILON_MM
  );
}

function computeAttachmentScore(
  x: number,
  y: number,
  placedW: number,
  placedH: number,
  placed: PlacedPart[],
  sheetW: number,
  sheetH: number,
  gap: number,
  margin: number
): number {
  let score = 0;

  if (isClose(x, margin)) score += 1;
  if (isClose(y, margin)) score += 1;
  if (isClose(x + placedW, sheetW - margin)) score += 1;
  if (isClose(y + placedH, sheetH - margin)) score += 1;

  for (const existing of placed) {
    const overlapsY = intervalsOverlap(y, y + placedH, existing.y, existing.y + existing.placedH);
    const overlapsX = intervalsOverlap(x, x + placedW, existing.x, existing.x + existing.placedW);

    if (overlapsY && (isClose(x, existing.x + existing.placedW + gap) || isClose(existing.x, x + placedW + gap))) {
      score += 1;
    }

    if (overlapsX && (isClose(y, existing.y + existing.placedH + gap) || isClose(existing.y, y + placedH + gap))) {
      score += 1;
    }
  }

  return score;
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd) - EPSILON_MM;
}

function isClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON_MM;
}

function isBetterCandidate(candidate: Candidate, best: Candidate, strategy: NestingParams['strategy']): boolean {
  if (strategy === 'remnant') {
    if (candidate.x !== best.x) {
      return candidate.x < best.x;
    }

    if (candidate.y !== best.y) {
      return candidate.y < best.y;
    }
  } else {
    if (candidate.y !== best.y) {
      return candidate.y < best.y;
    }

    if (candidate.x !== best.x) {
      return candidate.x < best.x;
    }
  }

  if (candidate.attachmentScore !== best.attachmentScore) {
    return candidate.attachmentScore > best.attachmentScore;
  }

  if (isVertical(candidate) !== isVertical(best)) {
    return isVertical(candidate);
  }

  if (candidate.placedH !== best.placedH) {
    return candidate.placedH > best.placedH;
  }

  return candidate.rotation < best.rotation;
}

function isVertical(candidate: Candidate): boolean {
  return candidate.placedH >= candidate.placedW;
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}
