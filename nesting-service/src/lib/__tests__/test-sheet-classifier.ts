import assert from 'node:assert/strict';
import { classifySheetMetalV2, computeBoundingBox } from '../geometry';

type Vec2 = [number, number];
type Triangle = [number, number, number];

type Mesh = {
  positions: Float32Array;
  indices: Uint32Array;
};

function extrudePolygon(points: Vec2[], faceTriangles: Triangle[], depth: number): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const [x, y] of points) {
    positions.push(x, y, 0);
  }
  for (const [x, y] of points) {
    positions.push(x, y, depth);
  }

  const topOffset = points.length;
  for (const [a, b, c] of faceTriangles) {
    indices.push(a, c, b);
    indices.push(topOffset + a, topOffset + b, topOffset + c);
  }

  for (let i = 0; i < points.length; i += 1) {
    const next = (i + 1) % points.length;
    indices.push(i, next, topOffset + next);
    indices.push(i, topOffset + next, topOffset + i);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function classify(mesh: Mesh) {
  return classifySheetMetalV2(computeBoundingBox(mesh.positions), mesh.positions, mesh.indices, 0.15);
}

function assertApprox(actual: number, expected: number, tolerance: number): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

const flatPlate = extrudePolygon(
  [
    [0, 0],
    [787, 0],
    [787, 356],
    [0, 356],
  ],
  [[0, 1, 2], [0, 2, 3]],
  2
);
const flatPlateResult = classify(flatPlate);
assert.equal(flatPlateResult.isSheetMetal, true);
assert.equal(flatPlateResult.thickness, 2);
assert.equal(flatPlateResult.hasBends, false);
assert.equal(flatPlateResult.developedBlank, undefined);

const lProfile = extrudePolygon(
  [
    [0, 0],
    [30, 0],
    [30, 2],
    [2, 2],
    [2, 30],
    [0, 30],
  ],
  [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]],
  1180
);
const lProfileResult = classify(lProfile);
assert.equal(lProfileResult.isSheetMetal, true);
assert.equal(lProfileResult.thickness, 2);
assert.equal(lProfileResult.method, 'volume_area');
assert.equal(lProfileResult.hasBends, true);
assert.ok(lProfileResult.developedBlank);
assertApprox(lProfileResult.developedBlank.width, 1180, 0.1);
assertApprox(lProfileResult.developedBlank.height, 58, 0.1);

const compactPart = extrudePolygon(
  [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
  [[0, 1, 2], [0, 2, 3]],
  5
);
const compactResult = classify(compactPart);
assert.equal(compactResult.isSheetMetal, false);
assert.equal(compactResult.developedBlank, undefined);

const upperLug = extrudePolygon(
  [
    [0, 0],
    [230, 0],
    [230, 68],
    [0, 68],
  ],
  [[0, 1, 2], [0, 2, 3]],
  20
);
const upperLugResult = classify(upperLug);
assert.equal(upperLugResult.isSheetMetal, true);
assert.equal(upperLugResult.thickness, 20);
assert.equal(upperLugResult.method, 'bbox');
assert.equal(upperLugResult.hasBends, false);
assert.deepEqual(upperLugResult.warnings, []);

const lowerLug = extrudePolygon(
  [
    [0, 0],
    [160, 0],
    [160, 90],
    [0, 90],
  ],
  [[0, 1, 2], [0, 2, 3]],
  20
);
const lowerLugResult = classify(lowerLug);
assert.equal(lowerLugResult.isSheetMetal, true);
assert.equal(lowerLugResult.thickness, 20);
assert.equal(lowerLugResult.method, 'bbox');
assert.equal(lowerLugResult.hasBends, false);
assert.deepEqual(lowerLugResult.warnings, []);

console.log('[sheet-classifier] all tests passed');
