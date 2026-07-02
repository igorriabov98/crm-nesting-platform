import type { PlacedPart, RemnantCandidate, RemnantInfo } from './types';

const MIN_REMNANT_WIDTH = 100;
const MIN_REMNANT_HEIGHT = 100;
const MAX_CANDIDATES = 10;
const EPSILON_MM = 0.001;

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function evaluateRemnant(
  sheetW: number,
  sheetH: number,
  placements: PlacedPart[],
  _strategy: 'minWaste' | 'remnant' | 'minSheets',
  gap: number,
  margin: number
): RemnantInfo | null {
  const candidates = buildRemnantCandidates(sheetW, sheetH, placements, gap, margin);
  const selected = candidates[0] ?? null;

  if (!selected) {
    return null;
  }

  return {
    ...selected,
    candidates,
    selectedIds: [selected.id],
  };
}

export function buildRemnantCandidates(
  sheetW: number,
  sheetH: number,
  placements: PlacedPart[],
  gap: number,
  margin: number
): RemnantCandidate[] {
  const workArea: Rect = {
    x: margin,
    y: margin,
    width: sheetW - margin * 2,
    height: sheetH - margin * 2,
  };

  if (workArea.width < MIN_REMNANT_WIDTH || workArea.height < MIN_REMNANT_HEIGHT) {
    return [];
  }

  const obstacles = placements.map((placement) => inflatePlacement(placement, workArea, gap)).filter((rect): rect is Rect => rect !== null);
  const xStarts = new Set<number>([workArea.x]);
  const xEnds = new Set<number>([workArea.x + workArea.width]);
  const yStarts = new Set<number>([workArea.y]);
  const yEnds = new Set<number>([workArea.y + workArea.height]);

  for (const obstacle of obstacles) {
    xStarts.add(obstacle.x + obstacle.width);
    xEnds.add(obstacle.x);
    yStarts.add(obstacle.y + obstacle.height);
    yEnds.add(obstacle.y);
  }

  const candidates: RemnantCandidate[] = [];
  const sortedXStarts = sortedValues(xStarts);
  const sortedXEnds = sortedValues(xEnds);
  const sortedYStarts = sortedValues(yStarts);
  const sortedYEnds = sortedValues(yEnds);

  for (const x of sortedXStarts) {
    for (const endX of sortedXEnds) {
      const width = endX - x;
      if (width < MIN_REMNANT_WIDTH - EPSILON_MM) continue;

      for (const y of sortedYStarts) {
        for (const endY of sortedYEnds) {
          const height = endY - y;
          if (height < MIN_REMNANT_HEIGHT - EPSILON_MM) continue;

          const candidate = normalizeRect({ x, y, width, height });
          if (!isInside(candidate, workArea) || intersectsAny(candidate, obstacles)) {
            continue;
          }

          candidates.push(toCandidate(candidate));
        }
      }
    }
  }

  return removeContainedDuplicates(candidates)
    .sort((a, b) => b.area - a.area || b.width - a.width || b.height - a.height || a.y - b.y || a.x - b.x)
    .slice(0, MAX_CANDIDATES);
}

function inflatePlacement(placement: PlacedPart, workArea: Rect, gap: number): Rect | null {
  const x1 = Math.max(workArea.x, placement.x - gap);
  const y1 = Math.max(workArea.y, placement.y - gap);
  const x2 = Math.min(workArea.x + workArea.width, placement.x + placement.placedW + gap);
  const y2 = Math.min(workArea.y + workArea.height, placement.y + placement.placedH + gap);

  if (x2 <= x1 || y2 <= y1) {
    return null;
  }

  return normalizeRect({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}

function removeContainedDuplicates(candidates: RemnantCandidate[]): RemnantCandidate[] {
  const byId = new Map<string, RemnantCandidate>();
  for (const candidate of candidates) {
    byId.set(candidate.id, candidate);
  }

  const unique = Array.from(byId.values());
  return unique.filter((candidate, index) => {
    return !unique.some((other, otherIndex) => otherIndex !== index && containsRect(other, candidate));
  });
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x + EPSILON_MM &&
    outer.y <= inner.y + EPSILON_MM &&
    outer.x + outer.width >= inner.x + inner.width - EPSILON_MM &&
    outer.y + outer.height >= inner.y + inner.height - EPSILON_MM &&
    outer.width * outer.height > inner.width * inner.height + EPSILON_MM
  );
}

function isInside(candidate: Rect, workArea: Rect): boolean {
  return containsOrEquals(workArea.x, candidate.x) &&
    containsOrEquals(workArea.y, candidate.y) &&
    containsOrEquals(candidate.x + candidate.width, workArea.x + workArea.width) &&
    containsOrEquals(candidate.y + candidate.height, workArea.y + workArea.height);
}

function containsOrEquals(left: number, right: number): boolean {
  return left <= right + EPSILON_MM;
}

function intersectsAny(candidate: Rect, obstacles: Rect[]): boolean {
  return obstacles.some((obstacle) => rectanglesOverlap(candidate, obstacle));
}

function rectanglesOverlap(left: Rect, right: Rect): boolean {
  return !(
    left.x + left.width <= right.x + EPSILON_MM ||
    right.x + right.width <= left.x + EPSILON_MM ||
    left.y + left.height <= right.y + EPSILON_MM ||
    right.y + right.height <= left.y + EPSILON_MM
  );
}

function toCandidate(rect: Rect): RemnantCandidate {
  const normalized = normalizeRect(rect);
  return {
    id: remnantId(normalized),
    ...normalized,
    area: Math.round(normalized.width * normalized.height),
    isUsable: true,
  };
}

function remnantId(rect: Rect): string {
  return [
    roundMm(rect.x),
    roundMm(rect.y),
    roundMm(rect.width),
    roundMm(rect.height),
  ].join(':');
}

function sortedValues(values: Set<number>): number[] {
  return Array.from(values).map(roundMm).sort((a, b) => a - b);
}

function normalizeRect(rect: Rect): Rect {
  return {
    x: roundMm(rect.x),
    y: roundMm(rect.y),
    width: roundMm(rect.width),
    height: roundMm(rect.height),
  };
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}
