import assert from 'node:assert/strict';
import { validateLayout, type LayoutViolationType } from '../validation/layout-validator';
import type { PlacedPart, Point2D, SheetResult } from '../nesting/types';

const validReport = validateLayout(
  [sheet([part('a', 10, 10, 20, 20), part('b', 40, 10, 20, 20)])],
  [
    { id: 'a', name: 'A', quantity: 1 },
    { id: 'b', name: 'B', quantity: 1 },
  ]
);
assert.equal(validReport.valid, true);
assert.deepEqual(validReport.violations, []);

const overlapReport = validateLayout(
  [sheet([part('a', 10, 10, 20, 20), part('b', 20, 15, 20, 20)])],
  [
    { id: 'a', name: 'A', quantity: 1 },
    { id: 'b', name: 'B', quantity: 1 },
  ]
);
assertViolation(overlapReport, 'overlap');

const gapReport = validateLayout(
  [sheet([part('a', 10, 10, 20, 20), part('b', 37, 10, 20, 20)], { usedGap: 10 })],
  [
    { id: 'a', name: 'A', quantity: 1 },
    { id: 'b', name: 'B', quantity: 1 },
  ]
);
assertViolation(gapReport, 'gap');
assert.equal(gapReport.violations[0].amountMm, 3);

const outOfBoundsReport = validateLayout(
  [sheet([part('a', 2, 10, 20, 20)], { usedMargin: 5 })],
  [{ id: 'a', name: 'A', quantity: 1 }]
);
assertViolation(outOfBoundsReport, 'out_of_bounds');

const missingReport = validateLayout(
  [sheet([part('a', 10, 10, 20, 20)])],
  [{ id: 'a', name: 'A', quantity: 2 }]
);
assertViolation(missingReport, 'quantity');
assert.equal(missingReport.violations[0].expected, 2);
assert.equal(missingReport.violations[0].actual, 1);

const explicitUnplacedReport = validateLayout(
  [sheet([part('a', 10, 10, 20, 20)])],
  [{ id: 'a', name: 'A', quantity: 2 }],
  { unplacedParts: [{ partId: 'a', name: 'A (#2)' }] }
);
assert.equal(explicitUnplacedReport.valid, true, 'explicit unplaced list should satisfy quantity invariant');

console.log('[layout-validator] all tests passed');

function assertViolation(report: ReturnType<typeof validateLayout>, type: LayoutViolationType): void {
  assert.equal(report.valid, false);
  assert.ok(report.violations.some((violation) => violation.type === type), `expected ${type} violation`);
}

function sheet(placements: PlacedPart[], overrides: Partial<Pick<SheetResult, 'usedGap' | 'usedMargin'>> = {}): SheetResult {
  return {
    sheetOptionId: 'sheet-1',
    width: 100,
    height: 80,
    material: 'Сталь',
    steelTypeId: null,
    steelTypeName: null,
    thickness: 3,
    isRemnant: false,
    usedGap: overrides.usedGap ?? 5,
    usedMargin: overrides.usedMargin ?? 5,
    placements,
    utilization: 0,
    bboxUtilization: 0,
    waste: 100,
    remnant: null,
  };
}

function part(id: string, x: number, y: number, width: number, height: number): PlacedPart {
  return {
    partId: id,
    name: id.toUpperCase(),
    x,
    y,
    rotation: 0,
    placedW: width,
    placedH: height,
    area: width * height,
    contour: rectangle(x, y, width, height),
    holes: [],
  };
}

function rectangle(x: number, y: number, width: number, height: number): Point2D[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
    { x, y },
  ];
}
