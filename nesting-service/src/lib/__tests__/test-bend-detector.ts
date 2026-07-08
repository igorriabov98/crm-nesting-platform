import assert from 'node:assert/strict';
import * as path from 'node:path';
import { parseStepFile, type ContourSource } from '../step-parser';
import { detectFixtureTopology, fixturesDir } from './brep-test-utils';

const K_FACTOR = 0.4;

async function main(): Promise<void> {
  const lAngle = await detectFixtureTopology('l_angle_100x40x40_t2_r3_holes.step');
  assert.ok(lAngle, 'L-angle topology should be detected');
  assert.equal(lAngle.flanges.length, 2);
  assert.equal(lAngle.bends.length, 1);

  const uChannel = await detectFixtureTopology('u_channel_100x40x40_t2_r3.step');
  assert.ok(uChannel, 'U-channel topology should be detected');
  assert.equal(uChannel.flanges.length, 3);
  assert.equal(uChannel.bends.length, 2);

  const box = await detectFixtureTopology('box_cycle_100x40x40_t2_r3.step');
  assert.equal(box, null, 'closed bend cycle should be outside the phase2 scope');
  await assertSuspectedBendFallback('box_cycle_100x40x40_t2_r3.step');

  const flatPlate = await detectFixtureTopology('plate_100x50x3_two_holes.step');
  assert.equal(flatPlate, null, 'flat plate should not be classified as bent topology');

  await assertFlatFixture('plate_100x50x3_half_edge_hole_r6.step', 'EXACT_BREP');
  await assertFlatFixture('plate_100x50x3_slot_30x10.step', 'EXACT_BREP');
  await assertFlatFixture('plate_100x50x2_edge_fillet_r1.step');

  await assertUnfoldedFixture('l_angle_100x40x40_t2_r3_holes.step', 100, 85.97, 1);
  await assertUnfoldedFixture('z_profile_100x40x40_t2_r3.step', 100, 154.84, 2, 0.001);
}

async function assertFlatFixture(file: string, expectedSource?: ContourSource): Promise<void> {
  const topology = await detectFixtureTopology(file);
  assert.equal(topology, null, `${file} should not be classified as bent topology`);

  const parsed = await parseFixture(file);
  assert.equal(parsed.parts.length, 1, `${file} should parse as one part`);
  const part = parsed.parts[0];
  assert.notEqual(part.contourSource, 'UNFOLDED_BREP', `${file} should not unfold`);
  if (expectedSource) {
    assert.equal(part.contourSource, expectedSource, `${file} contour source`);
  }
}

async function assertUnfoldedFixture(
  file: string,
  expectedWidth: number,
  expectedHeight: number,
  expectedBends: number,
  tolerance = 0.005
): Promise<void> {
  const parsed = await parseFixture(file);
  assert.equal(parsed.parts.length, 1, `${file} should parse as one part`);
  const part = parsed.parts[0];
  assert.equal(part.contourSource, 'UNFOLDED_BREP', `${file} should unfold`);
  assert.equal(part.bendCount, expectedBends, `${file} bend count`);
  assertWithin(part.width, expectedWidth, tolerance, `${file} unfolded width`);
  assertWithin(part.height, expectedHeight, tolerance, `${file} unfolded height`);
}

async function assertSuspectedBendFallback(file: string): Promise<void> {
  const parsed = await parseFixture(file);
  assert.equal(parsed.parts.length, 1, `${file} should parse as one part`);
  const part = parsed.parts[0];
  assert.equal(part.suspectedBend, true, `${file} should be marked as suspected bend`);
  assert.notEqual(part.contourSource, 'EXACT_BREP', `${file} must not silently use folded exact B-Rep`);
  assert.match(part.classificationWarning ?? '', /suspected bend/, `${file} should require review`);
  assert.ok(part.fallbackReason, `${file} should keep fallback reason`);
}

async function parseFixture(file: string) {
  const parsed = await parseStepFile(path.join(fixturesDir, file), {
    resolveKFactor: () => ({ kFactor: K_FACTOR, defaulted: false }),
  });
  assert.equal(parsed.success, true, `${file} should parse`);
  return parsed;
}

function assertWithin(actual: number, expected: number, tolerance: number, label: string): void {
  const relativeError = Math.abs(actual - expected) / expected;
  assert.ok(relativeError <= tolerance, `${label}: ${actual} should be within ${tolerance * 100}% of ${expected}`);
}

main()
  .then(() => {
    console.log('[bend-detector] all tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
