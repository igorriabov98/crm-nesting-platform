import assert from 'node:assert/strict';
import { unfoldPart } from '../brep/unfolder';
import { detectFixtureTopology } from './brep-test-utils';

const K_FACTOR = 0.4;
const THICKNESS = 2;
const INNER_RADIUS = 3;
const RIGHT_ANGLE = Math.PI / 2;
const BEND_ALLOWANCE = RIGHT_ANGLE * (INNER_RADIUS + K_FACTOR * THICKNESS);

async function main(): Promise<void> {
  const lTopology = await detectFixtureTopology('l_angle_100x40x40_t2_r3_holes.step');
  assert.ok(lTopology, 'L-angle topology should be detected');
  const lUnfold = unfoldPart(lTopology, K_FACTOR);
  assert.ok(lUnfold, 'L-angle should unfold');
  // L-angle: 40 + 40 + BA, BA = pi/2 * (3 + 0.4 * 2) = 5.969 mm.
  assertWithin(lUnfold.height, 40 + 40 + BEND_ALLOWANCE, 0.005, 'L-angle unfolded length');
  assert.equal(lUnfold.holes.length, 2, 'L-angle holes should survive unfold');
  const holeCenters = lUnfold.holes
    .map((hole) => ({
      x: (Math.min(...hole.map((point) => point.x)) + Math.max(...hole.map((point) => point.x))) / 2,
      y: (Math.min(...hole.map((point) => point.y)) + Math.max(...hole.map((point) => point.y))) / 2,
    }))
    .sort((left, right) => left.x - right.x);
  assertWithin(holeCenters[0].x, 30, 0.01, 'first hole x');
  assertWithin(holeCenters[1].x, 70, 0.01, 'second hole x');
  assert.ok(holeCenters.every((center) => center.y > 40 + BEND_ALLOWANCE), 'holes should be on the second flange');

  const uTopology = await detectFixtureTopology('u_channel_100x40x40_t2_r3.step');
  assert.ok(uTopology, 'U-channel topology should be detected');
  const uUnfold = unfoldPart(uTopology, K_FACTOR);
  assert.ok(uUnfold, 'U-channel should unfold');
  // U-channel fixture has two 40 mm side flanges, 34 mm tangent base span, and two BA strips.
  assertWithin(uUnfold.height, 40 + 34 + 40 + 2 * BEND_ALLOWANCE, 0.005, 'U-channel unfolded length');

  const invalidKFactor = unfoldPart(uTopology, 2.0);
  assert.equal(invalidKFactor, null, 'area preservation check should reject intentionally bad K-factor');
}

function assertWithin(actual: number, expected: number, tolerance: number, label: string): void {
  const relativeError = Math.abs(actual - expected) / expected;
  assert.ok(relativeError <= tolerance, `${label}: ${actual} should be within ${tolerance * 100}% of ${expected}`);
}

main()
  .then(() => {
    console.log('[unfold] all tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
