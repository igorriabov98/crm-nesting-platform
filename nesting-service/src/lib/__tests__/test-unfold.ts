import assert from 'node:assert/strict';
import { unfoldPart } from '../brep/unfolder';
import type { SheetMetalTopology } from '../brep/bend-detector';
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
  const holeCenters = lUnfold.holes.map(measureHoleCenter).sort((left, right) => left.x - right.x);
  assertWithin(holeCenters[0].x, 30, 0.01, 'first hole x');
  assertWithin(holeCenters[1].x, 70, 0.01, 'second hole x');
  const expectedHoleY = 40 + BEND_ALLOWANCE + 18;
  assertWithin(holeCenters[0].y, expectedHoleY, 0.001, 'first hole y');
  assertWithin(holeCenters[1].y, expectedHoleY, 0.001, 'second hole y');

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
  // Z-profile has opposite bend directions; the developed length is validated against volume/thickness.
  const zExpectedArea = zTopology.volume / zTopology.thickness;
  const zExpectedLength = zExpectedArea / zUnfold.width;
  assertWithin(zUnfold.height, zExpectedLength, 0.001, 'Z-profile unfolded length');
  assertWithin(zUnfold.area, zExpectedArea, 0.005, 'Z-profile unfolded area');
  logLengthCheck('Z-profile', 'volume / thickness / width', zExpectedLength, zUnfold.height);

  const shapedTopology = await detectFixtureTopology('l_angle_100x60_t2_r3_shaped_flange.step');
  assert.ok(shapedTopology, 'shaped L-angle topology should be detected');
  const shapedUnfold = unfoldPart(shapedTopology, K_FACTOR);
  assert.ok(shapedUnfold, 'shaped L-angle should unfold');
  // Shaped L-angle: rectangular flange 100*60, shaped flange 100*60 - 20*20/2 chamfer - 15*10 notch,
  // plus one BA strip 100 * pi/2 * (3 + 0.4 * 2) = 12246.9 mm2.
  const shapedExpectedArea = 100 * 60 + (100 * 60 - (20 * 20) / 2 - 15 * 10) + 100 * BEND_ALLOWANCE;
  assert.equal(openLoop(shapedUnfold.contour).length > 4, true, 'shaped L-angle contour should not be rectangular');
  assertWithin(shapedUnfold.area, shapedExpectedArea, 0.01, 'shaped L-angle unfolded area');
  assertWithin(shapedUnfold.width, 100, 0.005, 'shaped L-angle unfolded width');
  assertWithin(shapedUnfold.height, 60 + 60 + BEND_ALLOWANCE, 0.005, 'shaped L-angle unfolded height');
  assertHasPoint(shapedUnfold.contour, 40, shapedUnfold.height - 10, 0.05, 'notch inner-left corner');
  assertHasPoint(shapedUnfold.contour, 55, shapedUnfold.height - 10, 0.05, 'notch inner-right corner');
  assertHasPoint(shapedUnfold.contour, 80, shapedUnfold.height, 0.05, 'chamfer top point');
  assertHasPoint(shapedUnfold.contour, 100, shapedUnfold.height - 20, 0.05, 'chamfer side point');

  assertChainUnfolds([45, 90, 90, 90, 90], '5-bend chain 45+90*4');
  assertChainUnfolds([90, 90, 90, 90, 37], '5-bend chain 90*4+37');
  assertChainUnfolds([66, 66, 66], '3-bend chain 66*3');
  assertAlternatingZChainUnfolds([45, 37], 'Z-chain 45/37 alternating');

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

function assertChainUnfolds(anglesDeg: number[], label: string): void {
  const topology = buildChainTopology(anglesDeg);
  const unfolded = unfoldPart(topology, K_FACTOR);
  assert.ok(unfolded, `${label} should unfold`);
  assert.equal(unfolded.bendCount, anglesDeg.length, `${label} bend count`);

  const expectedArea = topology.volume / topology.thickness;
  const expectedHeight = 40 * (anglesDeg.length + 1) +
    anglesDeg.reduce((sum, angle) => sum + toRadians(angle) * (INNER_RADIUS + K_FACTOR * THICKNESS), 0);
  assertWithin(unfolded.area, expectedArea, 0.001, `${label} unfolded area`);
  assertWithin(unfolded.height, expectedHeight, 0.001, `${label} unfolded length`);
  logLengthCheck(label, `${anglesDeg.join('+')} deg chain`, expectedHeight, unfolded.height);
}

function assertAlternatingZChainUnfolds(anglesDeg: [number, number], label: string): void {
  const supplementLength = 28.9;
  const topology = buildChainTopology(anglesDeg, {
    directions: ['down', 'up'],
    usesComplementAngle: [true, true],
    supplementLength,
  });
  const unfolded = unfoldPart(topology, K_FACTOR);
  assert.ok(unfolded, `${label} should unfold`);

  const expectedArea = topology.volume / topology.thickness;
  const expectedHeight = expectedArea / unfolded.width;
  assert.equal(unfolded.bendCount, anglesDeg.length, `${label} bend count`);
  assertWithin(unfolded.height, expectedHeight, 0.001, `${label} unfolded length`);
  assertWithin(unfolded.area, expectedArea, 0.005, `${label} unfolded area`);
  logLengthCheck(label, `${anglesDeg.join('+')} deg alternating + supplement`, expectedHeight, unfolded.height);
}

function buildChainTopology(
  anglesDeg: number[],
  options: {
    directions?: Array<'up' | 'down'>;
    usesComplementAngle?: boolean[];
    supplementLength?: number;
  } = {}
): SheetMetalTopology {
  const length = 100;
  const width = 40;
  const flanges = Array.from({ length: anglesDeg.length + 1 }, (_, index) => ({
    id: index + 1,
    area: length * width,
    normal: { x: 0, y: 0, z: 1 },
    origin: { x: 0, y: index * width, z: 0 },
    localOrigin: { x: 0, y: index * width, z: 0 },
    uAxis: { x: 1, y: 0, z: 0 },
    vAxis: { x: 0, y: 1, z: 0 },
    length,
    width,
    contour: rectangle(0, 0, length, width),
    holes: [],
    sourceFaceIndices: [index * 2, index * 2 + 1] as [number, number],
  }));
  const bends = anglesDeg.map((angle, index) => ({
    id: index + 1,
    from: index + 1,
    to: index + 2,
    innerRadius: INNER_RADIUS,
    angleRad: toRadians(angle),
    axis: { x: 1, y: 0, z: 0 },
    axisLocation: { x: 0, y: (index + 1) * width, z: 0 },
    usesComplementAngle: options.usesComplementAngle?.[index] ?? false,
    direction: options.directions?.[index] ?? 'up' as const,
  }));
  const bendArea = bends.reduce(
    (sum, bend) => sum + length * bend.angleRad * (bend.innerRadius + K_FACTOR * THICKNESS),
    0
  );
  const area = flanges.reduce((sum, flange) => sum + flange.area, 0) + bendArea + length * (options.supplementLength ?? 0);

  return {
    baseFace: flanges[0],
    flanges,
    bends,
    thickness: THICKNESS,
    volume: area * THICKNESS,
    axis: { x: 1, y: 0, z: 0 },
  };
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

function measureHoleCenter(hole: Array<{ x: number; y: number }>): { x: number; y: number } {
  const points = openLoop(hole);
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function assertHasPoint(
  points: Array<{ x: number; y: number }>,
  expectedX: number,
  expectedY: number,
  tolerance: number,
  label: string
): void {
  assert.ok(
    points.some((point) => Math.hypot(point.x - expectedX, point.y - expectedY) <= tolerance),
    `${label}: expected point near ${expectedX},${expectedY}`
  );
}

function openLoop<T extends { x: number; y: number }>(points: T[]): T[] {
  const first = points[0];
  const last = points[points.length - 1];
  return first && last && Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6
    ? points.slice(0, -1)
    : points;
}

function formatNumber(value: number): string {
  return value.toFixed(3);
}

function percent(value: number): string {
  return (value * 100).toFixed(3);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function rectangle(minX: number, minY: number, maxX: number, maxY: number): Array<{ x: number; y: number }> {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: minX, y: minY },
  ];
}

main()
  .then(() => {
    console.log('[unfold] all tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
