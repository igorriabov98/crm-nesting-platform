import { nestOnSheetOptimized, sortPartsByStrategy } from './blf';
import { evaluateRemnant } from './remnant-eval';
import type { NestingParams, NestingPart, NestingResult, PlacedPart, SheetOption, SheetResult } from './types';

const MAX_SHEETS = 50;

type SheetCandidate = {
  sheet: SheetOption;
  result: SheetResult;
  unplaced: NestingPart[];
  placedCount: number;
  sheetArea: number;
  remnantArea: number;
};

export function distributePartsToSheets(
  allParts: NestingPart[],
  quantities: Map<string, number>,
  sheets: SheetOption[],
  params: NestingParams
): NestingResult {
  const startTime = Date.now();
  let remaining = sortPartsByStrategy(expandParts(allParts, quantities), params.strategy);
  const sortedSheets = sortSheetOptions(sheets);
  const usedSingleUseSheets = new Set<string>();
  const results: SheetResult[] = [];

  while (remaining.length > 0 && results.length < MAX_SHEETS) {
    const candidates = sortedSheets
      .filter((sheet) => !sheet.isRemnant || !usedSingleUseSheets.has(sheet.id))
      .map((sheet) => createSheetCandidate(sheet, remaining, params))
      .filter((candidate): candidate is SheetCandidate => candidate !== null);

    if (candidates.length === 0) {
      break;
    }

    const best = candidates.reduce((currentBest, candidate) =>
      isBetterSheetCandidate(candidate, currentBest, params.strategy, remaining.length) ? candidate : currentBest
    );

    results.push(best.result);
    if (best.sheet.isRemnant) {
      usedSingleUseSheets.add(best.sheet.id);
    }

    remaining = sortPartsByStrategy(best.unplaced, params.strategy);
  }

  const totalParts = Array.from(quantities.values()).reduce((sum, quantity) => sum + quantity, 0);
  const placedParts = results.reduce((sum, sheet) => sum + sheet.placements.length, 0);
  const avgUtilization =
    results.length > 0 ? roundPercent(results.reduce((sum, sheet) => sum + sheet.utilization, 0) / results.length) : 0;
  const totalWaste =
    results.length > 0 ? roundPercent(results.reduce((sum, sheet) => sum + sheet.waste, 0) / results.length) : 0;

  return {
    sheets: results,
    unplacedParts: remaining.map((part) => ({ partId: part.id, name: part.name })),
    totalParts,
    placedParts,
    totalSheets: results.length,
    avgUtilization,
    totalWaste,
    computeTimeMs: Date.now() - startTime,
  };
}

function expandParts(parts: NestingPart[], quantities: Map<string, number>): NestingPart[] {
  const expanded: NestingPart[] = [];

  for (const part of parts) {
    const quantity = quantities.get(part.id) ?? 0;

    for (let index = 1; index <= quantity; index += 1) {
      expanded.push({
        ...part,
        name: `${part.name} (#${index})`,
      });
    }
  }

  return expanded;
}

function sortSheetOptions(sheets: SheetOption[]): SheetOption[] {
  return [...sheets].sort(
    (a, b) =>
      a.priority - b.priority ||
      Number(a.isRemnant) - Number(b.isRemnant) ||
      b.potentialUtilization - a.potentialUtilization ||
      sheetArea(a) - sheetArea(b)
  );
}

function createSheetCandidate(
  sheet: SheetOption,
  remaining: NestingPart[],
  params: NestingParams
): SheetCandidate | null {
  const { placed, unplaced } = nestOnSheetOptimized(remaining, sheet.width, sheet.height, params);

  if (placed.length === 0) {
    return null;
  }

  const stats = computeSheetStats(placed, sheet.width, sheet.height);
  const remnant = evaluateRemnant(sheet.width, sheet.height, placed, params.strategy, params.gap, params.margin);

  return {
    sheet,
    result: {
      sheetOptionId: sheet.id,
      width: sheet.width,
      height: sheet.height,
      material: sheet.material,
      steelTypeId: null,
      steelTypeName: null,
      thickness: sheet.thickness,
      isRemnant: sheet.isRemnant,
      usedGap: params.gap,
      usedMargin: params.margin,
      placements: placed,
      utilization: stats.utilization,
      bboxUtilization: stats.bboxUtilization,
      waste: stats.waste,
      remnant,
    },
    unplaced,
    placedCount: placed.length,
    sheetArea: sheetArea(sheet),
    remnantArea: remnant?.area ?? 0,
  };
}

function isBetterSheetCandidate(
  candidate: SheetCandidate,
  best: SheetCandidate,
  strategy: NestingParams['strategy'],
  remainingCount: number
): boolean {
  const candidatePlacesAll = candidate.placedCount === remainingCount;
  const bestPlacesAll = best.placedCount === remainingCount;

  if (candidatePlacesAll !== bestPlacesAll) {
    return candidatePlacesAll;
  }

  if (candidate.placedCount !== best.placedCount) {
    return candidate.placedCount > best.placedCount;
  }

  switch (strategy) {
    case 'minWaste':
      return compareMinWasteCandidate(candidate, best) < 0;
    case 'remnant':
      return compareRemnantCandidate(candidate, best) < 0;
    case 'minSheets':
      return compareMinSheetsCandidate(candidate, best) < 0;
  }
}

function compareMinWasteCandidate(candidate: SheetCandidate, best: SheetCandidate): number {
  return (
    compareNumber(candidate.result.waste, best.result.waste) ||
    compareNumber(candidate.sheetArea, best.sheetArea) ||
    compareSheetPriority(candidate, best)
  );
}

function compareRemnantCandidate(candidate: SheetCandidate, best: SheetCandidate): number {
  return (
    compareNumber(candidate.result.waste, best.result.waste) ||
    compareNumber(candidate.sheetArea, best.sheetArea) ||
    compareNumber(best.remnantArea, candidate.remnantArea) ||
    compareSheetPriority(candidate, best)
  );
}

function compareMinSheetsCandidate(candidate: SheetCandidate, best: SheetCandidate): number {
  return (
    compareNumber(candidate.sheetArea, best.sheetArea) ||
    compareNumber(best.result.utilization, candidate.result.utilization) ||
    compareSheetPriority(candidate, best)
  );
}

function compareSheetPriority(candidate: SheetCandidate, best: SheetCandidate): number {
  return (
    compareNumber(candidate.sheet.priority, best.sheet.priority) ||
    compareNumber(Number(candidate.sheet.isRemnant), Number(best.sheet.isRemnant)) ||
    compareNumber(candidate.sheet.width, best.sheet.width) ||
    compareNumber(candidate.sheet.height, best.sheet.height)
  );
}

function computeSheetStats(
  placements: PlacedPart[],
  sheetW: number,
  sheetH: number
): { utilization: number; bboxUtilization: number; waste: number } {
  const usedArea = placements.reduce((sum, placement) => sum + placement.area, 0);
  const bboxUsedArea = placements.reduce((sum, placement) => sum + placement.placedW * placement.placedH, 0);
  const totalArea = sheetW * sheetH;

  if (totalArea <= 0) {
    return { utilization: 0, bboxUtilization: 0, waste: 100 };
  }

  const utilization = roundPercent((usedArea / totalArea) * 100);
  const bboxUtilization = roundPercent((bboxUsedArea / totalArea) * 100);
  const waste = roundPercent(100 - utilization);

  return { utilization, bboxUtilization, waste };
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function sheetArea(sheet: Pick<SheetOption, 'width' | 'height'>): number {
  return sheet.width * sheet.height;
}

function compareNumber(a: number, b: number): number {
  return a === b ? 0 : a - b;
}
