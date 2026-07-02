import assert from 'node:assert/strict';
import { buildRemnantCandidates } from '../nesting/remnant-eval';
import { DEFAULT_CUTTING_GAP_MM, DEFAULT_SHEET_MARGIN_MM } from '../nesting/params';
import type { PlacedPart } from '../nesting/types';

const gap = DEFAULT_CUTTING_GAP_MM;
const margin = DEFAULT_SHEET_MARGIN_MM;

const candidates = buildRemnantCandidates(6000, 1500, [
  createPlaced('tall-left', margin, margin, 540, 1185),
  createPlaced('short-left', 550, margin, 240, 360),
], gap, margin);

assert.ok(candidates.length >= 2, 'expected multiple remnant candidates');

const topStrip = candidates.find((candidate) => candidate.width >= 5900 && candidate.height >= 250);
assert.ok(topStrip, 'expected a top strip remnant candidate');

const rightWhiteArea = candidates.find((candidate) => candidate.x >= 790 && candidate.width >= 5000 && candidate.height >= 1400);
assert.ok(rightWhiteArea, 'expected the large white right-side remnant candidate');

for (const candidate of candidates) {
  assert.ok(candidate.x >= margin, `candidate ${candidate.id} violates left margin`);
  assert.ok(candidate.y >= margin, `candidate ${candidate.id} violates bottom margin`);
  assert.ok(candidate.x + candidate.width <= 6000 - margin, `candidate ${candidate.id} violates right margin`);
  assert.ok(candidate.y + candidate.height <= 1500 - margin, `candidate ${candidate.id} violates top margin`);
  assert.ok(candidate.width >= 100 && candidate.height >= 100, `candidate ${candidate.id} is too small`);
}

for (let index = 1; index < candidates.length; index += 1) {
  assert.ok(candidates[index - 1].area >= candidates[index].area, 'candidates should be sorted by area');
}

assertLShapeFreeArea();
assertMostlyEmptySheetHasLargeRemnant();

console.log('[remnant-candidates] all tests passed');

function assertLShapeFreeArea(): void {
  const lShapeCandidates = buildRemnantCandidates(2500, 1250, [
    createPlaced('bottom-a', margin, margin, 1180, 55),
    createPlaced('bottom-b', margin, 65, 1126, 55),
    createPlaced('bottom-c', margin, 125, 780, 55),
    createPlaced('bottom-d', margin, 185, 725, 55),
    createPlaced('right-a', 2300, margin, 55, 1180),
    createPlaced('right-b', 2360, margin, 55, 1180),
  ], gap, margin);
  const largeLShapeCandidate = lShapeCandidates.find((candidate) =>
    candidate.width >= 2000 &&
    candidate.height >= 900 &&
    candidate.area > 1_000_000
  );

  assert.ok(largeLShapeCandidate, 'expected a large rectangular candidate inside the L-shaped free area');
}

function assertMostlyEmptySheetHasLargeRemnant(): void {
  const mostlyEmptyCandidates = buildRemnantCandidates(2500, 1250, [
    createPlaced('leg-a', margin, margin, 495, 100),
    createPlaced('leg-b', 505, margin, 495, 100),
    createPlaced('leg-c', 1005, margin, 495, 100),
    createPlaced('leg-d', 1505, margin, 495, 100),
  ], gap, margin);
  const topRemnant = mostlyEmptyCandidates.find((candidate) =>
    candidate.width >= 2400 &&
    candidate.height >= 1000 &&
    candidate.area > 2_000_000
  );

  assert.ok(topRemnant, 'expected a large business remnant on a mostly empty sheet');
}

function createPlaced(partId: string, x: number, y: number, placedW: number, placedH: number): PlacedPart {
  return {
    partId,
    name: partId,
    x,
    y,
    rotation: 0,
    placedW,
    placedH,
    contour: [],
    holes: [],
  };
}
