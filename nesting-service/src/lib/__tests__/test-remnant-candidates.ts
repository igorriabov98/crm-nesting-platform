import assert from 'node:assert/strict';
import { buildRemnantCandidates } from '../nesting/remnant-eval';
import type { PlacedPart } from '../nesting/types';

const candidates = buildRemnantCandidates(6000, 1500, [
  createPlaced('tall-left', 5, 5, 540, 1185),
  createPlaced('short-left', 550, 5, 240, 360),
]);

assert.ok(candidates.length >= 2, 'expected multiple remnant candidates');

const topStrip = candidates.find((candidate) => candidate.width >= 5900 && candidate.height >= 250);
assert.ok(topStrip, 'expected a top strip remnant candidate');

const rightWhiteArea = candidates.find((candidate) => candidate.x >= 790 && candidate.width >= 5000 && candidate.height >= 1400);
assert.ok(rightWhiteArea, 'expected the large white right-side remnant candidate');

for (const candidate of candidates) {
  assert.ok(candidate.x >= 5, `candidate ${candidate.id} violates left margin`);
  assert.ok(candidate.y >= 5, `candidate ${candidate.id} violates bottom margin`);
  assert.ok(candidate.x + candidate.width <= 5995, `candidate ${candidate.id} violates right margin`);
  assert.ok(candidate.y + candidate.height <= 1495, `candidate ${candidate.id} violates top margin`);
  assert.ok(candidate.width >= 100 && candidate.height >= 100, `candidate ${candidate.id} is too small`);
}

for (let index = 1; index < candidates.length; index += 1) {
  assert.ok(candidates[index - 1].area >= candidates[index].area, 'candidates should be sorted by area');
}

console.log('[remnant-candidates] all tests passed');

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
