import assert from 'node:assert/strict';
import { isNestingCandidate } from '../nesting/review';
import { normalizeCloneClassifications, type ParsedPart } from '../step-parser';
import { validateLayout } from '../validation/layout-validator';

function part(overrides: Partial<ParsedPart>): ParsedPart {
  return {
    name: 'Клон',
    assemblyPath: [],
    thickness: null,
    width: 30,
    height: 30,
    contour: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }],
    holes: [],
    contourSource: 'CONVEX_HULL',
    isSheetMetal: false,
    partType: 'PURCHASED',
    hasBends: false,
    confidence: 0.8,
    classificationMethod: 'heuristic',
    classificationWarning: null,
    thumbnailSvg: '',
    boundingBox: { minX: 0, minY: 0, minZ: 0, maxX: 30, maxY: 30, maxZ: 5, sizeX: 30, sizeY: 30, sizeZ: 5 },
    meshVolume: 100,
    meshArea: 100,
    facesCount: 6,
    bendCount: 0,
    kFactor: null,
    kFactorDefaulted: false,
    suspectedBend: false,
    fallbackReason: null,
    ...overrides,
  };
}

function testPurchasedCloneIsNotIntercepted(): void {
  const group = normalizeCloneClassifications([
    part({ thickness: null }),
    part({ thickness: 5 }),
  ]);
  assert.ok(group.every((item) => item.partType === 'PURCHASED'));
  assert.ok(group.every((item) => item.thickness === 5));
  assert.ok(group.every((item) => item.needsReview !== true));
}

function testSheetConsensusAndThicknessNormalizationPrecedeReview(): void {
  const group = normalizeCloneClassifications([
    part({ partType: 'SHEET', isSheetMetal: true, thickness: 2 }),
    part({ partType: 'PROFILE', thickness: null }),
  ]);
  assert.ok(group.every((item) => item.partType === 'SHEET'));
  assert.ok(group.every((item) => item.thickness === 2));
  assert.ok(group.every((item) => item.needsReview !== true));
}

function testSheetThresholdWarningRequiresReview(): void {
  const warning = 'толщина bbox 35мм выше листового порога; толщина не определена';
  const group = normalizeCloneClassifications([
    part({ partType: 'SHEET', isSheetMetal: true, classificationWarning: warning }),
    part({ partType: 'PROFILE' }),
  ]);
  assert.ok(group.every((item) => item.partType === 'SHEET'));
  assert.ok(group.every((item) => item.needsReview === true));
  assert.ok(group.every((item) => item.needsReviewReason === warning));
}

function testReviewPartIsExcludedFromNesting(): void {
  assert.equal(isNestingCandidate({ partType: 'SHEET', isSheetMetal: true, needsReview: true }), false);
  assert.equal(isNestingCandidate({ partType: 'SHEET', isSheetMetal: true, needsReview: false }), true);
}

function testReviewViolationIsVisibleButDoesNotInvalidateLayout(): void {
  const reason = 'толщина bbox 35мм выше листового порога';
  const report = validateLayout([], [{ id: 'review-1', name: 'Пластина', quantity: 1 }], {
    unplacedParts: [{
      partId: 'review-1',
      name: `Пластина (#1) - ${reason}`,
      reasonCode: 'NEEDS_REVIEW',
      reason,
    }],
  });
  const violation = report.violations.find((item) => item.type === 'NEEDS_REVIEW');

  assert.equal(report.valid, true);
  assert.equal(violation?.severity, 'warning');
  assert.equal(violation?.message, `Пластина (#1): ${reason}`);
}

testPurchasedCloneIsNotIntercepted();
testSheetConsensusAndThicknessNormalizationPrecedeReview();
testSheetThresholdWarningRequiresReview();
testReviewPartIsExcludedFromNesting();
testReviewViolationIsVisibleButDoesNotInvalidateLayout();
console.log('✓ clone review flag is orthogonal to part type');
