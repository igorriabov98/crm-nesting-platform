import assert from 'node:assert/strict';
import { distributePartsToSheets } from '../nesting/multi-sheet';
import type { NestingParams, NestingPart, SheetOption } from '../nesting/types';

const sheets: SheetOption[] = [
  {
    id: 'large',
    width: 6000,
    height: 2000,
    material: 'Steel',
    thickness: 3,
    isRemnant: false,
    priority: 1,
  },
  {
    id: 'optimal',
    width: 6000,
    height: 1500,
    material: 'Steel',
    thickness: 3,
    isRemnant: false,
    priority: 1,
  },
];

const parts: NestingPart[] = [
  createPart('panel', 'Panel', 787, 356),
  createPart('rail', 'Rail', 5530, 40),
];

const quantities = new Map([
  ['panel', 2],
  ['rail', 1],
]);

for (const strategy of ['minWaste', 'remnant', 'minSheets'] as const) {
  const params: NestingParams = { strategy, gap: 5, grainDirection: 'horizontal' };
  const result = distributePartsToSheets(parts, quantities, sheets, params);

  assert.equal(result.totalSheets, 1, `${strategy}: expected all parts on one sheet`);
  assert.equal(result.placedParts, 3, `${strategy}: expected all parts to be placed`);
  assert.equal(result.sheets[0].sheetOptionId, 'optimal', `${strategy}: should pick the smallest suitable sheet`);
  assert.equal(result.sheets[0].width, 6000);
  assert.equal(result.sheets[0].height, 1500);
  assertMinimumPlacementGap(result.sheets[0].placements, params.gap, strategy);
}

console.log('[nesting-sheet-selection] all tests passed');

function createPart(id: string, name: string, width: number, height: number): NestingPart {
  return {
    id,
    name,
    width,
    height,
    contour: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
      { x: 0, y: 0 },
    ],
    holes: [],
    grainLock: false,
    area: width * height,
  };
}

function assertMinimumPlacementGap(
  placements: Array<{ name: string; x: number; y: number; placedW: number; placedH: number }>,
  gap: number,
  strategy: string
): void {
  for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < placements.length; rightIndex += 1) {
      const left = placements[leftIndex];
      const right = placements[rightIndex];
      const xGap = Math.max(0, Math.max(left.x, right.x) - Math.min(left.x + left.placedW, right.x + right.placedW));
      const yGap = Math.max(0, Math.max(left.y, right.y) - Math.min(left.y + left.placedH, right.y + right.placedH));
      const minGap = xGap === 0 || yGap === 0 ? Math.max(xGap, yGap) : Math.hypot(xGap, yGap);

      assert.ok(
        minGap >= gap,
        `${strategy}: expected at least ${gap}mm between ${left.name} and ${right.name}, got ${minGap}`
      );
    }
  }
}
