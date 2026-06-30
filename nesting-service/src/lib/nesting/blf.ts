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

const SHEET_MARGIN_MM = 5;
const CUTTING_GAP_MM = 5;
const EPSILON_MM = 0.001;

export function nestOnSheet(
  parts: NestingPart[],
  sheetW: number,
  sheetH: number,
  params: NestingParams
): { placed: PlacedPart[]; unplaced: NestingPart[] } {
  const placed: PlacedPart[] = [];
  const unplaced: NestingPart[] = [];

  for (const part of sortPartsByStrategy(parts, params.strategy)) {
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
  const gap = CUTTING_GAP_MM;

  for (const rotation of rotations) {
    const placedW = rotation === 90 || rotation === 270 ? part.height : part.width;
    const placedH = rotation === 90 || rotation === 270 ? part.width : part.height;

    if (!fitsInsideSheet(placedW, placedH, sheetW, sheetH)) {
      continue;
    }

    for (const x of buildCandidateCoordinates('x', placed, placedW, sheetW, gap)) {
      for (const y of buildCandidateCoordinates('y', placed, placedH, sheetH, gap)) {
        if (!isCandidateValid(x, y, placedW, placedH, placed, sheetW, sheetH, gap)) {
          continue;
        }

        const candidate: Candidate = {
          x,
          y,
          rotation,
          placedW,
          placedH,
          attachmentScore: computeAttachmentScore(x, y, placedW, placedH, placed, sheetW, sheetH, gap),
        };

        if (!best || isBetterCandidate(candidate, best, params.strategy)) {
          best = candidate;
        }
      }
    }
  }

  return best;
}

function fitsInsideSheet(placedW: number, placedH: number, sheetW: number, sheetH: number): boolean {
  return (
    placedW > 0 &&
    placedH > 0 &&
    placedW <= sheetW - SHEET_MARGIN_MM * 2 + EPSILON_MM &&
    placedH <= sheetH - SHEET_MARGIN_MM * 2 + EPSILON_MM
  );
}

function buildCandidateCoordinates(
  axis: 'x' | 'y',
  placed: PlacedPart[],
  size: number,
  sheetSize: number,
  gap: number
): number[] {
  const values = new Set<number>([SHEET_MARGIN_MM, sheetSize - SHEET_MARGIN_MM - size]);

  for (const existing of placed) {
    const start = axis === 'x' ? existing.x : existing.y;
    const existingSize = axis === 'x' ? existing.placedW : existing.placedH;

    values.add(start + existingSize + gap);
    values.add(start - size - gap);
  }

  return Array.from(values)
    .map(roundMm)
    .filter((value) => value >= SHEET_MARGIN_MM - EPSILON_MM && value + size <= sheetSize - SHEET_MARGIN_MM + EPSILON_MM)
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
  gap: number
): boolean {
  if (
    x < SHEET_MARGIN_MM - EPSILON_MM ||
    y < SHEET_MARGIN_MM - EPSILON_MM ||
    x + placedW > sheetW - SHEET_MARGIN_MM + EPSILON_MM ||
    y + placedH > sheetH - SHEET_MARGIN_MM + EPSILON_MM
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
  gap: number
): number {
  let score = 0;

  if (isClose(x, SHEET_MARGIN_MM)) score += 1;
  if (isClose(y, SHEET_MARGIN_MM)) score += 1;
  if (isClose(x + placedW, sheetW - SHEET_MARGIN_MM)) score += 1;
  if (isClose(y + placedH, sheetH - SHEET_MARGIN_MM)) score += 1;

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
