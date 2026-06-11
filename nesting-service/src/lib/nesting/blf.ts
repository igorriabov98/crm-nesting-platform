import type { NestingParams, NestingPart, PlacedPart, Point2D } from './types';

type Rotation = PlacedPart['rotation'];

type Candidate = {
  x: number;
  y: number;
  rotation: Rotation;
  placedW: number;
  placedH: number;
  skylineW: number;
  skylineH: number;
};

export function nestOnSheet(
  parts: NestingPart[],
  sheetW: number,
  sheetH: number,
  params: NestingParams
): { placed: PlacedPart[]; unplaced: NestingPart[] } {
  const sheetWidthUnits = Math.max(0, Math.ceil(sheetW));
  const skyline = Array.from({ length: sheetWidthUnits }, () => 0);
  const placed: PlacedPart[] = [];
  const unplaced: NestingPart[] = [];

  for (const part of sortPartsByStrategy(parts, params.strategy)) {
    const candidate = findBestCandidate(part, skyline, sheetW, sheetH, params);

    if (!candidate) {
      unplaced.push(part);
      continue;
    }

    for (let x = candidate.x; x < Math.min(sheetWidthUnits, candidate.x + candidate.skylineW); x += 1) {
      skyline[x] = candidate.y + candidate.skylineH;
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
  skyline: number[],
  sheetW: number,
  sheetH: number,
  params: NestingParams
): Candidate | null {
  const rotations: Rotation[] = part.grainLock ? [0] : [0, 90];
  let best: Candidate | null = null;

  for (const rotation of rotations) {
    const placedW = rotation === 90 || rotation === 270 ? part.height : part.width;
    const placedH = rotation === 90 || rotation === 270 ? part.width : part.height;
    const skylineW = Math.ceil(placedW + params.gap);
    const skylineH = Math.ceil(placedH + params.gap);

    if (placedW <= 0 || placedH <= 0 || skylineW > sheetW || skylineH > sheetH) {
      continue;
    }

    const maxX = Math.floor(sheetW - skylineW);
    for (let x = 0; x <= maxX; x += 1) {
      const y = maxSkylineY(skyline, x, skylineW);

      if (y + skylineH > sheetH) {
        continue;
      }

      const candidate: Candidate = {
        x,
        y,
        rotation,
        placedW,
        placedH,
        skylineW,
        skylineH,
      };

      if (!best || isBetterCandidate(candidate, best, params.strategy)) {
        best = candidate;
      }
    }
  }

  return best;
}

function maxSkylineY(skyline: number[], startX: number, width: number): number {
  let maxY = 0;
  const endX = Math.min(skyline.length, startX + width);

  for (let x = startX; x < endX; x += 1) {
    maxY = Math.max(maxY, skyline[x] ?? 0);
  }

  return maxY;
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

  if (candidate.skylineH !== best.skylineH) {
    return candidate.skylineH < best.skylineH;
  }

  return candidate.rotation < best.rotation;
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}
