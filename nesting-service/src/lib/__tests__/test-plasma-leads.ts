import assert from 'node:assert/strict';
import { createLeadSegments } from '../dxf/leads';
import type { Point2D } from '../nesting/types';

const contour: Point2D[] = [
  { x: 0, y: 0 },
  { x: 0, y: 20 },
  { x: 30, y: 20 },
  { x: 30, y: 0 },
];

const result = createLeadSegments(
  contour,
  { x: 10, y: 10 },
  0,
  'outer',
  { width: 100, height: 100 },
  [{ index: 0, x: 10, y: 10, width: 30, height: 20 }],
  { leadInLength: 3, leadOutLength: 2 }
);

assert.equal(result.warnings.length, 0);
assert.equal(result.segments.length, 2);
assert.equal(result.segments[0].kind, 'leadIn');
assert.equal(result.segments[1].kind, 'leadOut');
assert.equal(segmentLength(result.segments[0]), 3);
assert.equal(segmentLength(result.segments[1]), 2);

console.log('[plasma-leads] all tests passed');

function segmentLength(segment: { from: Point2D; to: Point2D }): number {
  return Math.round(Math.hypot(segment.from.x - segment.to.x, segment.from.y - segment.to.y) * 10) / 10;
}
