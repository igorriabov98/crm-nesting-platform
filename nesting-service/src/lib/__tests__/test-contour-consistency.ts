import assert from 'node:assert/strict';
import {
  buildGeometryFingerprint,
  findContourConsistencyViolations,
  validateContourAreaPhysics,
} from '../step-parser';
import { convexHull, projectTo2D } from '../geometry';
import { buildCanonicalMeshFrame } from '../canonical-frame';

const positions = new Float32Array([
  0, 0, 0,
  50.3, 0, 0,
  50.3, 107.6, 0,
  0, 107.6, 0,
]);
const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
const fingerprint = buildGeometryFingerprint(positions, indices);
const contourSize = (points: Array<{ x: number; y: number }>) => ({
  width: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
  height: Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
});
const rotations = [0, 17, 35, 83, 141, 219].map((degrees) => degrees * Math.PI / 180);
const occurrences = rotations.map((angle, occurrenceIndex) => {
  const rotatedPositions = new Float32Array([
    ...rotateAroundAxis(0, 0, 0, angle),
    ...rotateAroundAxis(50.3, 0, 0, angle),
    ...rotateAroundAxis(50.3, 107.6, 0, angle),
    ...rotateAroundAxis(0, 107.6, 0, angle),
  ]);
  const rotatedFingerprint = buildGeometryFingerprint(rotatedPositions, indices);
  assert.equal(
    fingerprint,
    rotatedFingerprint,
    'triangle-edge fingerprint must be invariant under rigid rotation'
  );
  const frame = buildCanonicalMeshFrame(rotatedPositions, indices);
  assert.ok(frame, `canonical frame must resolve occurrence ${occurrenceIndex}`);
  const contour = convexHull(projectTo2D(frame.positions, 'z'));
  const size = contourSize(contour);
  return {
    name: `САИН.204.01.001 Ручка occurrence ${occurrenceIndex + 1}`,
    geometryFingerprint: rotatedFingerprint,
    contourSource: 'CONVEX_HULL' as const,
    width: size.width,
    height: size.height,
    contour,
  };
});

const violations = findContourConsistencyViolations(occurrences);

assert.deepEqual(
  violations,
  [],
  'identical STEP geometry must produce an identical contour in every occurrence'
);

const sourceObservations = findContourConsistencyViolations([
  { ...occurrences[0], contourSource: 'CONVEX_HULL' },
  { ...occurrences[1], contourSource: 'UNFOLDED_BREP' },
]);
assert.equal(sourceObservations.length, 1);
assert.equal(sourceObservations[0].type, 'CONTOUR_SOURCE_DIVERGENCE');
assert.equal(sourceObservations[0].severity, 'info');

assert.equal(validateContourAreaPhysics(2500, 10000, 4).valid, true);
const bentHandlePhysics = validateContourAreaPhysics(6176, 10001.4, 4);
assert.equal(bentHandlePhysics.valid, false);
assert.equal(Math.round(bentHandlePhysics.expectedArea ?? 0), 2500);

function rotateAroundAxis(x: number, y: number, z: number, angle: number): [number, number, number] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotatedX = x * cosine - y * sine;
  const rotatedY = x * sine + y * cosine;
  const tilt = angle * 0.37;
  return [
    rotatedX,
    rotatedY * Math.cos(tilt) - z * Math.sin(tilt),
    rotatedY * Math.sin(tilt) + z * Math.cos(tilt),
  ];
}
