import type { PlacedPart, RemnantInfo } from './types';

const MIN_REMNANT_WIDTH = 100;
const MIN_REMNANT_HEIGHT = 100;

export function evaluateRemnant(
  sheetW: number,
  sheetH: number,
  placements: PlacedPart[],
  strategy: 'minWaste' | 'remnant' | 'minSheets',
  gap: number
): RemnantInfo | null {
  if (placements.length === 0) {
    return null;
  }

  let x: number;
  let y: number;
  let width: number;
  let height: number;

  if (strategy === 'remnant') {
    const maxX = Math.max(...placements.map((placement) => placement.x + placement.placedW));
    x = maxX + gap;
    y = 0;
    width = sheetW - x;
    height = sheetH;
  } else {
    const maxY = Math.max(...placements.map((placement) => placement.y + placement.placedH));
    x = 0;
    y = maxY + gap;
    width = sheetW;
    height = sheetH - y;
  }

  if (width < MIN_REMNANT_WIDTH || height < MIN_REMNANT_HEIGHT) {
    return null;
  }

  return {
    x: roundMm(x),
    y: roundMm(y),
    width: roundMm(width),
    height: roundMm(height),
    area: Math.round(width * height),
    isUsable: true,
  };
}

function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}
