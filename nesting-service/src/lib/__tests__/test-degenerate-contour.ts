import assert from 'node:assert/strict';
import {
  DEGENERATE_CONTOUR_WARNING,
  isValidStepContourShape,
  resolvePartTypeForContour,
  resolveStepContourShape,
} from '../step-parser';
import { buildNestingFailedReason } from '../nesting/unplaced-reasons';

function testCollinearBoundaryFallsBackToHull(): void {
  const collinear = [
    { x: 0, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: 4.5 },
  ];
  const projectedMesh = [
    { x: 0, y: 0 },
    { x: 50.3, y: 0 },
    { x: 50.3, y: 107.6 },
    { x: 0, y: 107.6 },
  ];

  assert.equal(isValidStepContourShape(collinear), false);
  const resolved = resolveStepContourShape(collinear, projectedMesh);
  assert.equal(resolved.usedFallback, true);
  assert.equal(resolved.valid, true);
  assert.equal(isValidStepContourShape(resolved.contour), true);
}

function testFullyDegenerateContourIsExcludedFromSheetNesting(): void {
  const collinear = [
    { x: 0, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: 4.5 },
  ];
  const resolved = resolveStepContourShape(collinear, collinear);

  assert.equal(resolved.usedFallback, true);
  assert.equal(resolved.valid, false);
  assert.equal(resolvePartTypeForContour('SHEET', resolved.contour), 'PROFILE');
  assert.match(DEGENERATE_CONTOUR_WARNING, /вырожденный контур/);
}

function testOversizedPartReasonNamesPartAndSheetDimensions(): void {
  const reason = buildNestingFailedReason({
    material: 'Сталь',
    thickness: 2.5,
    requiredWidth: 1447.08,
    requiredHeight: 1509.37,
    availableSheets: [{ width: 2500, height: 1250 }],
  });

  assert.match(reason, /деталь 1447\.08x1509\.37 не помещается на лист 2500x1250 ни в одной ориентации/);
}

function testAlgorithmFailureRemainsDistinctFromOversize(): void {
  const reason = buildNestingFailedReason({
    material: 'Сталь',
    thickness: 2.5,
    requiredWidth: 1000,
    requiredHeight: 500,
    availableSheets: [{ width: 2500, height: 1250 }],
  });

  assert.match(reason, /^алгоритм не нашёл свободную позицию/);
}

testCollinearBoundaryFallsBackToHull();
testFullyDegenerateContourIsExcludedFromSheetNesting();
testOversizedPartReasonNamesPartAndSheetDimensions();
testAlgorithmFailureRemainsDistinctFromOversize();

console.log('✓ degenerate STEP contours and nesting failure reasons');
