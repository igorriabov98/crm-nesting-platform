import assert from 'node:assert/strict';
import { nestOnSheet, nestOnSheetOptimized } from '../nesting/blf';
import { distributePartsToSheets } from '../nesting/multi-sheet';
import { DEFAULT_CUTTING_GAP_MM, DEFAULT_SHEET_MARGIN_MM } from '../nesting/params';
import type { NestingParams, NestingPart, SheetOption } from '../nesting/types';

const SHEET_MARGIN_MM = DEFAULT_SHEET_MARGIN_MM;
const CUTTING_GAP_MM = DEFAULT_CUTTING_GAP_MM;

const sheets: SheetOption[] = [
  {
    id: 'large',
    width: 6000,
    height: 2000,
    material: 'Steel',
    thickness: 3,
    isRemnant: false,
    priority: 1,
    potentialUtilization: 8.4,
  },
  {
    id: 'optimal',
    width: 6000,
    height: 1500,
    material: 'Steel',
    thickness: 3,
    isRemnant: false,
    priority: 1,
    potentialUtilization: 11.2,
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
  const params: NestingParams = { strategy, gap: CUTTING_GAP_MM, margin: SHEET_MARGIN_MM, grainDirection: 'horizontal' };
  const result = distributePartsToSheets(parts, quantities, sheets, params);

  assert.equal(result.totalSheets, 1, `${strategy}: expected all parts on one sheet`);
  assert.equal(result.placedParts, 3, `${strategy}: expected all parts to be placed`);
  assert.equal(result.sheets[0].sheetOptionId, 'optimal', `${strategy}: should pick the smallest suitable sheet`);
  assert.equal(result.sheets[0].width, 6000);
  assert.equal(result.sheets[0].height, 1500);
  assertSheetMargin(result.sheets[0].placements, result.sheets[0].width, result.sheets[0].height, strategy);
  assertRemnantMargin(result.sheets[0].remnant, result.sheets[0].width, result.sheets[0].height, strategy);
  assertMinimumPlacementGap(result.sheets[0].placements, CUTTING_GAP_MM, strategy);
  assertAdjacentGapExists(result.sheets[0].placements, CUTTING_GAP_MM, strategy);
}

assertEdgeMargin();
assertExactAdjacentGap();
assertVerticalOrientationPreferred();
assertHorizontalFallbackWhenVerticalDoesNotFit();
assertSmallPartsPreferCompactSheet();
assertOptimizedNestingIsNotWorseThanSingleStrategy();

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

function assertEdgeMargin(): void {
  const params: NestingParams = { strategy: 'minWaste', gap: 50, margin: SHEET_MARGIN_MM, grainDirection: 'horizontal' };
  const result = nestOnSheet([createPart('tight', 'Tight detail', 90, 90)], 100, 100, params);

  assert.equal(result.placed.length, 1, 'detail should fit exactly inside the configured margin frame');
  assert.equal(result.placed[0].x, SHEET_MARGIN_MM);
  assert.equal(result.placed[0].y, SHEET_MARGIN_MM);
  assert.equal(result.placed[0].x + result.placed[0].placedW, 100 - SHEET_MARGIN_MM);
  assert.equal(result.placed[0].y + result.placed[0].placedH, 100 - SHEET_MARGIN_MM);

  const tooLarge = nestOnSheet([createPart('too-large', 'Too large', 91, 90)], 100, 100, params);
  assert.equal(tooLarge.placed.length, 0, 'detail must not enter the configured margin frame');
}

function assertExactAdjacentGap(): void {
  const params: NestingParams = { strategy: 'minWaste', gap: CUTTING_GAP_MM, margin: SHEET_MARGIN_MM, grainDirection: 'horizontal' };
  const result = nestOnSheet(
    [createPart('left', 'Left detail', 40, 40), createPart('right', 'Right detail', 40, 40)],
    100,
    50,
    params
  );

  assert.equal(result.placed.length, 2, 'both details should fit with one fixed cutting gap');
  assert.equal(result.placed[0].x, SHEET_MARGIN_MM);
  assert.equal(result.placed[1].x - (result.placed[0].x + result.placed[0].placedW), CUTTING_GAP_MM);
}

function assertVerticalOrientationPreferred(): void {
  const params: NestingParams = { strategy: 'minWaste', gap: CUTTING_GAP_MM, margin: SHEET_MARGIN_MM, grainDirection: 'horizontal' };
  const result = nestOnSheet([createPart('vertical', 'Vertical preferred', 120, 80)], 200, 200, params);

  assert.equal(result.placed.length, 1);
  assert.equal(result.placed[0].rotation, 90, 'vertical orientation should win when both orientations fit equally');
  assert.equal(result.placed[0].placedW, 80);
  assert.equal(result.placed[0].placedH, 120);
}

function assertHorizontalFallbackWhenVerticalDoesNotFit(): void {
  const params: NestingParams = { strategy: 'minWaste', gap: CUTTING_GAP_MM, margin: SHEET_MARGIN_MM, grainDirection: 'horizontal' };
  const result = nestOnSheet([createPart('horizontal', 'Horizontal fallback', 160, 40)], 180, 80, params);

  assert.equal(result.placed.length, 1);
  assert.equal(result.placed[0].rotation, 0, 'horizontal orientation should be used when vertical does not fit');
  assert.equal(result.placed[0].placedW, 160);
  assert.equal(result.placed[0].placedH, 40);
}

function assertSmallPartsPreferCompactSheet(): void {
  const params: NestingParams = { strategy: 'minWaste', gap: CUTTING_GAP_MM, margin: SHEET_MARGIN_MM, grainDirection: 'horizontal' };
  const leg = createPart('leg', 'Leg support', 495, 100);
  const compactSheets: SheetOption[] = [
    {
      id: 'huge',
      width: 2500,
      height: 1250,
      material: 'Steel',
      thickness: 8,
      isRemnant: false,
      priority: 1,
      potentialUtilization: 6.6,
    },
    {
      id: 'compact',
      width: 1000,
      height: 500,
      material: 'Steel',
      thickness: 8,
      isRemnant: false,
      priority: 1,
      potentialUtilization: 41.4,
    },
  ];
  const result = distributePartsToSheets([leg], new Map([['leg', 4]]), compactSheets, params);

  assert.equal(result.totalSheets, 1, 'four small legs should fit on one compact sheet');
  assert.equal(result.sheets[0].sheetOptionId, 'compact', 'small parts should prefer the compact suitable sheet');
}

function assertOptimizedNestingIsNotWorseThanSingleStrategy(): void {
  const params: NestingParams = { strategy: 'minWaste', gap: CUTTING_GAP_MM, margin: SHEET_MARGIN_MM, grainDirection: 'horizontal' };
  const mixedParts = [
    createPart('wide', 'Wide rail', 900, 80),
    createPart('tall-a', 'Tall A', 90, 700),
    createPart('tall-b', 'Tall B', 90, 700),
    createPart('panel', 'Panel', 300, 300),
  ];
  const single = nestOnSheet(mixedParts, 1000, 900, params);
  const optimized = nestOnSheetOptimized(mixedParts, 1000, 900, params);

  assert.ok(
    optimized.placed.length >= single.placed.length,
    `optimized nesting placed ${optimized.placed.length}, single strategy placed ${single.placed.length}`
  );
}

function assertSheetMargin(
  placements: Array<{ name: string; x: number; y: number; placedW: number; placedH: number }>,
  sheetWidth: number,
  sheetHeight: number,
  strategy: string
): void {
  for (const placement of placements) {
    assert.ok(placement.x >= SHEET_MARGIN_MM, `${strategy}: ${placement.name} is too close to left edge`);
    assert.ok(placement.y >= SHEET_MARGIN_MM, `${strategy}: ${placement.name} is too close to bottom edge`);
    assert.ok(
      placement.x + placement.placedW <= sheetWidth - SHEET_MARGIN_MM,
      `${strategy}: ${placement.name} is too close to right edge`
    );
    assert.ok(
      placement.y + placement.placedH <= sheetHeight - SHEET_MARGIN_MM,
      `${strategy}: ${placement.name} is too close to top edge`
    );
  }
}

function assertRemnantMargin(
  remnant: { x: number; y: number; width: number; height: number } | null,
  sheetWidth: number,
  sheetHeight: number,
  strategy: string
): void {
  if (!remnant) {
    return;
  }

  assert.ok(remnant.x >= SHEET_MARGIN_MM, `${strategy}: remnant is too close to left edge`);
  assert.ok(remnant.y >= SHEET_MARGIN_MM, `${strategy}: remnant is too close to bottom edge`);
  assert.ok(remnant.x + remnant.width <= sheetWidth - SHEET_MARGIN_MM, `${strategy}: remnant is too close to right edge`);
  assert.ok(remnant.y + remnant.height <= sheetHeight - SHEET_MARGIN_MM, `${strategy}: remnant is too close to top edge`);
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

function assertAdjacentGapExists(
  placements: Array<{ name: string; x: number; y: number; placedW: number; placedH: number }>,
  gap: number,
  strategy: string
): void {
  let foundAdjacentPair = false;

  for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < placements.length; rightIndex += 1) {
      const left = placements[leftIndex];
      const right = placements[rightIndex];
      const xGap = Math.max(0, Math.max(left.x, right.x) - Math.min(left.x + left.placedW, right.x + right.placedW));
      const yGap = Math.max(0, Math.max(left.y, right.y) - Math.min(left.y + left.placedH, right.y + right.placedH));

      if (xGap === gap || yGap === gap) {
        foundAdjacentPair = true;
      }
    }
  }

  assert.ok(foundAdjacentPair, `${strategy}: expected at least one adjacent pair with exactly ${gap}mm gap`);
}
