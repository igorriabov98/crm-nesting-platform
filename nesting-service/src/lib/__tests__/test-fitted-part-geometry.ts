import assert from 'node:assert/strict';
import { readFittedPartGeometry } from '../dxf/part-geometry';

const geometry = readFittedPartGeometry(
  [
    { x: -120, y: -40 },
    { x: 80, y: -40 },
    { x: 80, y: 60 },
    { x: -120, y: 60 },
    { x: -120, y: -40 },
  ],
  [
    [
      { x: -20, y: -10 },
      { x: 0, y: -10 },
      { x: 0, y: 10 },
      { x: -20, y: 10 },
      { x: -20, y: -10 },
    ],
  ],
  50,
  25
);

assertGeometryInsideBox(geometry.contour, 50, 25, 'outer contour');
assertGeometryInsideBox(geometry.holes[0], 50, 25, 'hole');
assert.equal(Math.min(...geometry.contour.map((point) => point.x)), 0);
assert.equal(Math.min(...geometry.contour.map((point) => point.y)), 0);
assert.equal(Math.max(...geometry.contour.map((point) => point.x)), 50);
assert.equal(Math.max(...geometry.contour.map((point) => point.y)), 25);

console.log('[fitted-part-geometry] all tests passed');

function assertGeometryInsideBox(points: Array<{ x: number; y: number }>, width: number, height: number, label: string): void {
  for (const point of points) {
    assert.ok(point.x >= 0 && point.x <= width, `${label}: x=${point.x} is outside 0..${width}`);
    assert.ok(point.y >= 0 && point.y <= height, `${label}: y=${point.y} is outside 0..${height}`);
  }
}
