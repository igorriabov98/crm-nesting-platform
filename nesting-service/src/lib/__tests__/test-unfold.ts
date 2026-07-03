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
  const lExpectedLength = 40 + 40 + BEND_ALLOWANCE;
  assertWithin(lUnfold.height, lExpectedLength, 0.005, 'L-angle unfolded length');
  logLengthCheck('L-angle', '40 + 40 + pi/2 * (3 + 0.4 * 2)', lExpectedLength, lUnfold.height);
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
  const uExpectedLength = 40 + 34 + 40 + 2 * BEND_ALLOWANCE;
  assertWithin(uUnfold.height, uExpectedLength, 0.005, 'U-channel unfolded length');
  logLengthCheck('U-channel', '40 + 34 + 40 + 2 * pi/2 * (3 + 0.4 * 2)', uExpectedLength, uUnfold.height);

  const zTopology = await detectFixtureTopology('z_profile_100x40x40_t2_r3.step');
  assert.ok(zTopology, 'Z-profile topology should be detected');
  assert.equal(zTopology.bends.length, 2, 'Z-profile should have two bends');
  assert.deepEqual(
    [...new Set(zTopology.bends.map((bend) => bend.direction))].sort(),
    ['down', 'up'],
    'Z-profile bends should keep opposite directions'
  );
  const zUnfold = unfoldPart(zTopology, K_FACTOR);
  assert.ok(zUnfold, 'Z-profile should unfold');
  assert.equal(zUnfold.source, 'UNFOLDED_BREP');
  assert.equal(zUnfold.bendCount, 2);
  // Z-profile fixture has two 40 mm flanges, 34 mm tangent web span, and two BA strips.
  const zExpectedLength = 40 + 34 + 40 + 2 * BEND_ALLOWANCE;
  assertWithin(zUnfold.height, zExpectedLength, 0.005, 'Z-profile unfolded length');
  logLengthCheck('Z-profile', '40 + 34 + 40 + 2 * pi/2 * (3 + 0.4 * 2)', zExpectedLength, zUnfold.height);

  const invalidExpectedArea = uTopology.volume / uTopology.thickness;
  const badKFactor = 2.0;
  const invalidBa = RIGHT_ANGLE * (INNER_RADIUS + badKFactor * THICKNESS);
  const invalidLength = 40 + 34 + 40 + 2 * invalidBa;
  const invalidArea = uUnfold.width * invalidLength;
  const invalidMismatch = percent(Math.abs(invalidArea - invalidExpectedArea) / invalidExpectedArea);
  const invalidUnfold = unfoldPart(uTopology, badKFactor);
  assert.equal(invalidUnfold, null, 'area preservation check should reject intentionally bad K-factor');
  console.log(
    `[unfold] area-check fallback: kFactor=2.0 expectedArea=${formatNumber(invalidExpectedArea)} actualArea=${formatNumber(invalidArea)} mismatch=${invalidMismatch}% warning="unfold validation failed (bend-zone cutout or area mismatch)"`
  );
}

function assertWithin(actual: number, expected: number, tolerance: number, label: string): void {
  const relativeError = Math.abs(actual - expected) / expected;
  assert.ok(relativeError <= tolerance, `${label}: ${actual} should be within ${tolerance * 100}% of ${expected}`);
}

function logLengthCheck(label: string, formula: string, expected: number, actual: number): void {
  console.log(
    `[unfold] ${label}: formula=${formula}; t=${THICKNESS}; r=${INNER_RADIUS}; K=${K_FACTOR}; expected=${formatNumber(expected)} actual=${formatNumber(actual)} delta=${percent(Math.abs(actual - expected) / expected)}%`
  );
}

function formatNumber(value: number): string {
  return value.toFixed(3);
}

function percent(value: number): string {
  return (value * 100).toFixed(3);
}

main()
  .then(() => {
    console.log('[unfold] all tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
