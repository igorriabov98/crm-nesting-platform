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
  {
    unplacedParts: [{
      partId: 'a',
      name: 'A (#2) - нет листа: материал Сталь/S235, t=20, мин. размер 160x90',
      reasonCode: 'NO_SHEET_AVAILABLE',
      reason: 'нет листа: материал Сталь/S235, t=20, мин. размер 160x90',
      material: 'Сталь',
      steelTypeName: 'S235',
      thickness: 20,
      requiredWidth: 160,
      requiredHeight: 90,
    }],
  }
);
assertViolation(explicitUnplacedReport, 'NO_SHEET_AVAILABLE');
assertNoViolation(explicitUnplacedReport, 'quantity');
assert.equal(explicitUnplacedReport.violations[0].reason, 'нет листа: материал Сталь/S235, t=20, мин. размер 160x90');

const excludedReport = validateLayout(
  [sheet([part('a', 10, 10, 20, 20)])],
  [
    { id: 'a', name: 'A', quantity: 1 },
    { id: 'b', name: 'B', quantity: 1 },
  ],
  {
    unplacedParts: [{
      partId: 'b',
      name: 'B (#1) - ручная метка',
      reasonCode: 'EXCLUDED_PROFILE',
      reason: 'ручная метка',
    }],
    excludedParts: [{ partId: 'b', name: 'B', quantity: 1, reason: 'ручная метка', reasonCode: 'EXCLUDED_PROFILE' }],
  }
);
assert.equal(excludedReport.valid, true);
assertInfoViolation(excludedReport, 'EXCLUDED_PROFILE');
assertNoViolation(excludedReport, 'quantity');

const unexplainedReport = validateLayout(
  [sheet([part('a', 10, 10, 20, 20)])],
  [{ id: 'a', name: 'A', quantity: 2 }],
  {
    unplacedParts: [{
      partId: 'a',
      name: 'A (#2)',
      reasonCode: 'UNPLACED_WITHOUT_REASON',
      reason: '',
    }],
  }
);
assertViolation(unexplainedReport, 'UNPLACED_WITHOUT_REASON');
assertNoViolation(unexplainedReport, 'quantity');

const bodyMismatchReport = validateLayout([], [], { stepSolidCount: 20, accountedBodies: 24 });
assertViolation(bodyMismatchReport, 'BODY_COUNT_MISMATCH');
assert.equal(bodyMismatchReport.violations[0].severity, 'error');
assert.equal(bodyMismatchReport.violations[0].message, 'bodies: step=20, accounted=24');

const skmWithoutT20Report = validateLayout(
  [sheet(Array.from({ length: 9 }, (_, index) => part(`placed-${index + 1}`, 10 + index * 25, 10, 20, 20)), { width: 260 })],
  [
    { id: 'placed-1', name: 'Placed 1', quantity: 1 },
    { id: 'placed-2', name: 'Placed 2', quantity: 1 },
    { id: 'placed-3', name: 'Placed 3', quantity: 1 },
    { id: 'placed-4', name: 'Placed 4', quantity: 1 },
    { id: 'placed-5', name: 'Placed 5', quantity: 1 },
    { id: 'placed-6', name: 'Placed 6', quantity: 1 },
    { id: 'placed-7', name: 'Placed 7', quantity: 1 },
    { id: 'placed-8', name: 'Placed 8', quantity: 1 },
    { id: 'placed-9', name: 'Placed 9', quantity: 1 },
    { id: 'excluded', name: 'Kufe', quantity: 4 },
    { id: 'oese', name: 'Oese', quantity: 2 },
  ],
  {
    unplacedParts: [
      ...Array.from({ length: 4 }, (_, index) => ({
        partId: 'excluded',
        name: `Kufe (#${index + 1}) - PDF/BOM указал профиль/круг — не для листового раскроя`,
        reasonCode: 'EXCLUDED_PROFILE' as const,
        reason: 'PDF/BOM указал профиль/круг — не для листового раскроя',
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        partId: 'oese',
        name: `Oese (#${index + 1}) - нет листа: материал Сталь/S235, t=20, мин. размер 160x90`,
        reasonCode: 'NO_SHEET_AVAILABLE' as const,
        reason: 'нет листа: материал Сталь/S235, t=20, мин. размер 160x90',
        material: 'Сталь',
        steelTypeName: 'S235',
        thickness: 20,
        requiredWidth: 160,
        requiredHeight: 90,
      })),
    ],
    excludedParts: [{ partId: 'excluded', name: 'Kufe', quantity: 4, reason: 'PDF/BOM указал профиль/круг — не для листового раскроя', reasonCode: 'EXCLUDED_PROFILE' }],
  }
);
assert.equal(countViolations(skmWithoutT20Report, 'NO_SHEET_AVAILABLE'), 2);
assert.equal(countViolations(skmWithoutT20Report, 'EXCLUDED_PROFILE'), 1);
assertNoViolation(skmWithoutT20Report, 'quantity');
assertNoViolation(skmWithoutT20Report, 'UNPLACED_WITHOUT_REASON');

const skmWithT20Report = validateLayout(
  [sheet(Array.from({ length: 11 }, (_, index) => part(`placed-${index + 1}`, 10 + (index % 6) * 25, 10 + Math.floor(index / 6) * 25, 20, 20)), { width: 180, height: 90 })],
  [
    ...Array.from({ length: 11 }, (_, index) => ({ id: `placed-${index + 1}`, name: `Placed ${index + 1}`, quantity: 1 })),
    { id: 'excluded', name: 'Kufe', quantity: 4 },
  ],
  {
    unplacedParts: Array.from({ length: 4 }, (_, index) => ({
      partId: 'excluded',
      name: `Kufe (#${index + 1}) - PDF/BOM указал профиль/круг — не для листового раскроя`,
      reasonCode: 'EXCLUDED_PROFILE' as const,
      reason: 'PDF/BOM указал профиль/круг — не для листового раскроя',
    })),
    excludedParts: [{ partId: 'excluded', name: 'Kufe', quantity: 4, reason: 'PDF/BOM указал профиль/круг — не для листового раскроя', reasonCode: 'EXCLUDED_PROFILE' }],
  }
);
assert.equal(skmWithT20Report.valid, true);
assertInfoViolation(skmWithT20Report, 'EXCLUDED_PROFILE');
assert.equal(countViolations(skmWithT20Report, 'NO_SHEET_AVAILABLE'), 0);
assertNoViolation(skmWithT20Report, 'quantity');

console.log('[layout-validator] all tests passed');

function assertViolation(report: ReturnType<typeof validateLayout>, type: LayoutViolationType): void {
  assert.equal(report.valid, false);
  assert.ok(report.violations.some((violation) => violation.type === type), `expected ${type} violation`);
}

function assertNoViolation(report: ReturnType<typeof validateLayout>, type: LayoutViolationType): void {
  assert.equal(report.violations.some((violation) => violation.type === type), false, `did not expect ${type} violation`);
}

function assertInfoViolation(report: ReturnType<typeof validateLayout>, type: LayoutViolationType): void {
  const violation = report.violations.find((item) => item.type === type);
  assert.ok(violation, `expected ${type} info violation`);
  assert.equal(violation.severity, 'info');
}

function countViolations(report: ReturnType<typeof validateLayout>, type: LayoutViolationType): number {
  return report.violations.filter((violation) => violation.type === type).length;
}

function sheet(placements: PlacedPart[], overrides: Partial<Pick<SheetResult, 'usedGap' | 'usedMargin' | 'width' | 'height'>> = {}): SheetResult {
  return {
    sheetOptionId: 'sheet-1',
    width: overrides.width ?? 100,
    height: overrides.height ?? 80,
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
