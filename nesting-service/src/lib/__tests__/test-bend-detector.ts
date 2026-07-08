import assert from 'node:assert/strict';
import * as path from 'node:path';
import { parseStepFile, type ContourSource } from '../step-parser';
import { detectFixtureTopology, fixturesDir } from './brep-test-utils';

const K_FACTOR = 0.4;
const STRIP66_ARC_CENTER = { x: 75, y: 167.117 };
const STRIP66_ARC_RADIUS = 5;

type ArcExpectation = {
  center: { x: number; y: number };
  radius: number;
  tolerance: number;
  minPoints: number;
  label: string;
};

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
  await assertUnfoldedFixture('u_channel_100x40x40_t2_r3.step', 100, 125.94, 2);
  await assertUnfoldedFixture('z_profile_100x40x40_t2_r3.step', 100, 154.84, 2, 0.001);

  const strip66 = await detectFixtureTopology('synthetic/multiaxis/strip66x3_r5notch_w75_t6_r4.step');
  assert.ok(strip66, 'strip66 topology should be detected');
  assert.equal(strip66.bends.length, 3, 'strip66 should have exactly three bend pairs');
  await assertUnfoldedFixture(
    'synthetic/multiaxis/strip66x3_r5notch_w75_t6_r4.step',
    75,
    222.12,
    3,
    0.02,
    4,
    undefined,
    {
      center: STRIP66_ARC_CENTER,
      radius: STRIP66_ARC_RADIUS,
      tolerance: 0.2,
      minPoints: 8,
      label: 'strip66 R5 notch',
    }
  );

  const flangeTree = await detectFixtureTopology('synthetic/multiaxis/flange_tree_100x100_t2_r3.step');
  assert.ok(flangeTree, 'flange tree topology should be detected');
  assert.equal(flangeTree.bends.length, 3, 'flange tree should have three bends');
  assert.equal(uniqueAxisKeys(flangeTree.bends.map((bend) => bend.axis)).length, 3, 'flange tree bends should use three axes');
  await assertUnfoldedFixture('synthetic/multiaxis/flange_tree_100x100_t2_r3.step', 130.97, 130.97, 3, 0.02, 9, 9);
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
  tolerance = 0.005,
  minContourPoints = 0,
  exactContourPoints?: number,
  expectArc?: ArcExpectation
): Promise<void> {
  const parsed = await parseFixture(file);
  assert.equal(parsed.parts.length, 1, `${file} should parse as one part`);
  const part = parsed.parts[0];
  assert.equal(part.contourSource, 'UNFOLDED_BREP', `${file} should unfold`);
  assert.equal(part.suspectedBend, false, `${file} successful unfold should not be marked suspected`);
  assert.equal(part.bendCount, expectedBends, `${file} bend count`);
  assertWithin(part.width, expectedWidth, tolerance, `${file} unfolded width`);
  assertWithin(part.height, expectedHeight, tolerance, `${file} unfolded height`);
  const contourPoints = openLoop(part.contour).length;
  if (exactContourPoints !== undefined) {
    assert.equal(contourPoints, exactContourPoints, `${file} unfolded contour point count`);
  } else if (minContourPoints > 0) {
    assert.ok(contourPoints > minContourPoints, `${file} should keep unfold contour vertices`);
  }
  if (expectArc) {
    assertArcPoints(
      part.contour,
      expectArc.center,
      expectArc.radius,
      expectArc.tolerance,
      expectArc.minPoints,
      expectArc.label
    );
  }
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

function uniqueAxisKeys(axes: Array<{ x: number; y: number; z: number }>): string[] {
  return [...new Set(axes.map((axis) => (
    `${Math.round(Math.abs(axis.x) * 1000)},${Math.round(Math.abs(axis.y) * 1000)},${Math.round(Math.abs(axis.z) * 1000)}`
  )))];
}

function openLoop<T extends { x: number; y: number }>(points: T[]): T[] {
  const first = points[0];
  const last = points[points.length - 1];
  return first && last && Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6
    ? points.slice(0, -1)
    : points;
}

function assertArcPoints(
  points: Array<{ x: number; y: number }>,
  center: { x: number; y: number },
  radius: number,
  tolerance: number,
  minPoints: number,
  label: string
): void {
  const arcPoints = openLoop(points).filter((point) => (
    Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius) <= tolerance
  ));
  assert.ok(
    arcPoints.length >= minPoints,
    `${label} should preserve arc points: expected >=${minPoints}, got ${arcPoints.length}`
  );
}

main()
  .then(() => {
    console.log('[bend-detector] all tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
