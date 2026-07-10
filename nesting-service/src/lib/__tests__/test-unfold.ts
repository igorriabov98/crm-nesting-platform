import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { unfoldPart, unionUnfoldPolygons, validateSimpleUnfoldContour } from '../brep/unfolder';
import type { SheetMetalTopology } from '../brep/bend-detector';
import { polygonNetArea, type Point2D } from '../geometry';
import { detectFixtureTopology, fixturesDir } from './brep-test-utils';
import { assertNoComponentOverlap, assertUnfoldShape } from './unfold-shape-assertions';

const K_FACTOR = 0.4;
const THICKNESS = 2;
const INNER_RADIUS = 3;
const RIGHT_ANGLE = Math.PI / 2;
const BEND_ALLOWANCE = RIGHT_ANGLE * (INNER_RADIUS + K_FACTOR * THICKNESS);
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
  assertSelfIntersectingSideWallContourRejected();
  assertUnionTargetFixture();

  const lTopology = await detectFixtureTopology('l_angle_100x40x40_t2_r3_holes.step');
  assert.ok(lTopology, 'L-angle topology should be detected');
  const lUnfold = unfoldPart(lTopology, K_FACTOR);
  assert.ok(lUnfold, 'L-angle should unfold');
  assertSimpleContour(lUnfold.contour, 'L-angle');
  // L-angle: 40 + 40 + BA, BA = pi/2 * (3 + 0.4 * 2) = 5.969 mm.
  const lExpectedLength = 40 + 40 + BEND_ALLOWANCE;
  assertUnfoldShape(lUnfold, {
    label: 'L-angle',
    expectedArea: lTopology.volume / lTopology.thickness,
    bomBbox: { width: 100, height: lExpectedLength },
  });
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
  assertSimpleContour(uUnfold.contour, 'U-channel');
  // U-channel fixture has two 40 mm side flanges, 34 mm tangent base span, and two BA strips.
  const uExpectedLength = 40 + 34 + 40 + 2 * BEND_ALLOWANCE;
  assertUnfoldShape(uUnfold, {
    label: 'U-channel',
    expectedArea: uTopology.volume / uTopology.thickness,
    bomBbox: { width: 100, height: uExpectedLength },
  });
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
  assertSimpleContour(zUnfold.contour, 'Z-profile');
  assert.equal(zUnfold.source, 'UNFOLDED_BREP');
  assert.equal(zUnfold.bendCount, 2);
  // Z-profile has opposite bend directions; the developed length is validated against volume/thickness.
  const zExpectedArea = zTopology.volume / zTopology.thickness;
  const zExpectedLength = zExpectedArea / zUnfold.width;
  assertUnfoldShape(zUnfold, {
    label: 'Z-profile',
    expectedArea: zExpectedArea,
    bomBbox: { width: 100, height: zExpectedLength },
  });
  assertWithin(zUnfold.height, zExpectedLength, 0.001, 'Z-profile unfolded length');
  assertWithin(zUnfold.area, zExpectedArea, 0.005, 'Z-profile unfolded area');
  logLengthCheck('Z-profile', 'volume / thickness / width', zExpectedLength, zUnfold.height);

  const shapedTopology = await detectFixtureTopology('l_angle_100x60_t2_r3_shaped_flange.step');
  assert.ok(shapedTopology, 'shaped L-angle topology should be detected');
  const shapedUnfold = unfoldPart(shapedTopology, K_FACTOR);
  assert.ok(shapedUnfold, 'shaped L-angle should unfold');
  assertSimpleContour(shapedUnfold.contour, 'shaped L-angle');
  // Shaped L-angle: rectangular flange 100*60, shaped flange 100*60 - 20*20/2 chamfer - 15*10 notch,
  // plus one BA strip 100 * pi/2 * (3 + 0.4 * 2) = 12246.9 mm2.
  const shapedExpectedArea = 100 * 60 + (100 * 60 - (20 * 20) / 2 - 15 * 10) + 100 * BEND_ALLOWANCE;
  assertUnfoldShape(shapedUnfold, {
    label: 'shaped L-angle',
    expectedArea: shapedExpectedArea,
    areaTolerance: 0.01,
    bomBbox: { width: 100, height: 60 + 60 + BEND_ALLOWANCE },
    minContourPoints: 4,
    featurePoints: [
      { x: 40, y: shapedUnfold.height - 10, tolerance: 0.05, label: 'notch inner-left corner' },
      { x: 55, y: shapedUnfold.height - 10, tolerance: 0.05, label: 'notch inner-right corner' },
      { x: 80, y: shapedUnfold.height, tolerance: 0.05, label: 'chamfer top point' },
      { x: 100, y: shapedUnfold.height - 20, tolerance: 0.05, label: 'chamfer side point' },
    ],
  });
  assert.equal(openLoop(shapedUnfold.contour).length > 4, true, 'shaped L-angle contour should not be rectangular');
  assertWithin(shapedUnfold.area, shapedExpectedArea, 0.01, 'shaped L-angle unfolded area');
  assertWithin(shapedUnfold.width, 100, 0.005, 'shaped L-angle unfolded width');
  assertWithin(shapedUnfold.height, 60 + 60 + BEND_ALLOWANCE, 0.005, 'shaped L-angle unfolded height');
  assertHasPoint(shapedUnfold.contour, 40, shapedUnfold.height - 10, 0.05, 'notch inner-left corner');
  assertHasPoint(shapedUnfold.contour, 55, shapedUnfold.height - 10, 0.05, 'notch inner-right corner');
  assertHasPoint(shapedUnfold.contour, 80, shapedUnfold.height, 0.05, 'chamfer top point');
  assertHasPoint(shapedUnfold.contour, 100, shapedUnfold.height - 20, 0.05, 'chamfer side point');

  const rearLikeTopology = buildChainTopology([90, 90, 90, 90, 37]);
  const rearLikeUnfold = unfoldPart(rearLikeTopology, K_FACTOR);
  assert.ok(rearLikeUnfold, 'rear-like rectangular chain should unfold');
  assertSimpleContour(rearLikeUnfold.contour, 'rear-like rectangular chain');
  assertUnfoldShape(rearLikeUnfold, {
    label: 'rear-like rectangular chain',
    expectedArea: rearLikeTopology.volume / rearLikeTopology.thickness,
    bomBbox: { width: rearLikeUnfold.width, height: rearLikeUnfold.height },
    exactContourPoints: 4,
  });
  assertRectangularContour(rearLikeUnfold.contour, 'rear-like rectangular chain');
  assertChainUnfolds([45, 90, 90, 90, 90], '5-bend chain 45+90*4');
  assertChainUnfolds([90, 90, 90, 90, 37], '5-bend chain 90*4+37');
  assertChainUnfolds([66, 66, 66], '3-bend chain 66*3');
  assertAlternatingZChainUnfolds([45, 37], 'Z-chain 45/37 alternating');
  await assertPassportFixtureUnfolds(
    'synthetic/multiaxis/strip66x3_r5notch_w75_t6_r4.step',
    'strip66 R5-notch',
    100649.9991 / 6,
    75,
    222.12,
    3,
    4,
    undefined,
    {
      center: STRIP66_ARC_CENTER,
      radius: STRIP66_ARC_RADIUS,
      tolerance: 0.2,
      minPoints: 8,
      label: 'strip66 R5-notch',
    }
  );
  await assertPassportFixtureUnfolds(
    'synthetic/multiaxis/flange_tree_100x100_t2_r3.step',
    'flange tree 3-axis',
    29665.2300 / 2,
    130.97,
    130.97,
    3,
    8,
    9
  );

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
  assertSimpleContour(unfolded.contour, label);
  assert.equal(unfolded.bendCount, anglesDeg.length, `${label} bend count`);

  const expectedArea = topology.volume / topology.thickness;
  const expectedHeight = 40 * (anglesDeg.length + 1) +
    anglesDeg.reduce((sum, angle) => sum + toRadians(angle) * (INNER_RADIUS + K_FACTOR * THICKNESS), 0);
  assertUnfoldShape(unfolded, {
    label,
    expectedArea,
    areaTolerance: 0.001,
    bomBbox: { width: 100, height: expectedHeight },
  });
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
  assertSimpleContour(unfolded.contour, label);

  const expectedArea = topology.volume / topology.thickness;
  const expectedHeight = expectedArea / unfolded.width;
  assertUnfoldShape(unfolded, {
    label,
    expectedArea,
    areaTolerance: 0.005,
    bomBbox: { width: 100, height: expectedHeight },
  });
  assert.equal(unfolded.bendCount, anglesDeg.length, `${label} bend count`);
  assertWithin(unfolded.height, expectedHeight, 0.001, `${label} unfolded length`);
  assertWithin(unfolded.area, expectedArea, 0.005, `${label} unfolded area`);
  logLengthCheck(label, `${anglesDeg.join('+')} deg alternating + supplement`, expectedHeight, unfolded.height);
}

async function assertPassportFixtureUnfolds(
  fileName: string,
  label: string,
  expectedArea: number,
  expectedWidth: number,
  expectedHeight: number,
  expectedBends: number,
  minContourPoints: number,
  exactContourPoints?: number,
  expectArc?: ArcExpectation
): Promise<void> {
  const topology = await detectFixtureTopology(fileName);
  assert.ok(topology, `${label} topology should be detected`);
  assert.equal(topology.bends.length, expectedBends, `${label} bend count`);

  const unfolded = unfoldPart(topology, K_FACTOR);
  assert.ok(unfolded, `${label} should unfold`);
  assertSimpleContour(unfolded.contour, label);
  assert.equal(unfolded.source, 'UNFOLDED_BREP');
  assert.equal(unfolded.bendCount, expectedBends, `${label} unfolded bend count`);
  assertUnfoldShape(unfolded, {
    label,
    expectedArea,
    bomBbox: { width: expectedWidth, height: expectedHeight },
    exactContourPoints,
    minContourPoints: exactContourPoints === undefined ? minContourPoints : undefined,
    arcs: expectArc ? [expectArc] : undefined,
  });
  const contourPoints = openLoop(unfolded.contour).length;
  if (exactContourPoints !== undefined) {
    assert.equal(contourPoints, exactContourPoints, `${label} contour point count`);
  } else {
    assert.ok(contourPoints > minContourPoints, `${label} contour should be non-rectangular`);
  }
  assertWithin(unfolded.area, expectedArea, 0.02, `${label} unfolded area`);
  assertWithin(unfolded.width, expectedWidth, 0.005, `${label} unfolded width`);
  if (expectArc) {
    assertArcPoints(
      unfolded.contour,
      expectArc.center,
      expectArc.radius,
      expectArc.tolerance,
      expectArc.minPoints,
      expectArc.label
    );
  }
  logAreaCheck(label, expectedArea, unfolded.area, unfolded.width, unfolded.height);
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

function assertUnionTargetFixture(): void {
  const fixturePath = path.join(fixturesDir, 'synthetic/multiaxis/union_target.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    polygons: Record<string, Array<[number, number]>>;
    expected_union_outer: Array<[number, number]>;
    expected_area: number;
  };
  const polygons = Object.values(fixture.polygons).map(pointsFromPairs);
  const expectedOuter = pointsFromPairs(fixture.expected_union_outer);
  const unioned = unionUnfoldPolygons(polygons);

  assert.equal(unioned.failureReason, null, `union target should not fail: ${unioned.failureReason}`);
  assert.ok(unioned.contour, 'union target should return an outer contour');
  assert.equal(unioned.holes.length, 0, 'union target should not produce holes');
  assertSimpleContour(unioned.contour, 'union target');
  assert.equal(openLoop(unioned.contour).length, 8, 'union target outer contour point count');
  assertLoopMatches(unioned.contour, expectedOuter, 0.001, 'union target outer contour');
  assertWithin(polygonNetArea(unioned.contour, unioned.holes), fixture.expected_area, 0.001, 'union target area');
  assertUnfoldShape(
    { contour: unioned.contour, holes: unioned.holes },
    {
      label: 'union target',
      expectedArea: fixture.expected_area,
      areaTolerance: 0.001,
      bomBbox: { width: 360, height: 270 },
      exactContourPoints: 8,
    }
  );
  assertNoComponentOverlap(
    unioned.contour,
    unioned.holes,
    polygons.reduce((sum, polygon) => sum + polygonNetArea(closeLoop(polygon)), 0),
    'union target',
    0.001
  );
}

function assertSelfIntersectingSideWallContourRejected(): void {
  // Known LEDA.525 side-wall state before polygon union: bend-direction placement removes the beak,
  // but the current stitcher still produces a self-intersecting outline. Keep this in NEEDS_REVIEW;
  // the actual union fix is tracked separately in fix-unfold-union.
  const reason = validateSimpleUnfoldContour([
    { x: 1570.155, y: 388.859 },
    { x: 1192.335, y: 104.152 },
    { x: 1207.927, y: 57.552 },
    { x: 1179.162, y: 95.725 },
    { x: 1178.674, y: 95.358 },
    { x: 1174.704, y: 100.627 },
    { x: 1175.192, y: 100.994 },
    { x: 1177.802, y: 100.994 },
    { x: 1177.802, y: 46.6 },
    { x: 1174.664, y: 46.6 },
    { x: 1159.072, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 49.9 },
    { x: 71.062, y: 49.9 },
    { x: 71.062, y: 50.392 },
    { x: 21.654, y: 99.797 },
    { x: 71.062, y: 99.797 },
    { x: 71.062, y: 699.994 },
    { x: 1175.192, y: 699.994 },
    { x: 1572.642, y: 400.494 },
    { x: 1573.129, y: 400.861 },
    { x: 1576.164, y: 396.833 },
  ]);
  assert.match(
    reason ?? '',
    /^self-intersecting unfold contour: edges \[4,7\] at \(1177\.802,96\.515\)/,
    'self-intersecting side-wall contour must not be a valid unfold'
  );
}

function assertSimpleContour(points: Array<{ x: number; y: number }>, label: string): void {
  assert.equal(validateSimpleUnfoldContour(points), null, `${label} contour should be simple`);
}

function logLengthCheck(label: string, formula: string, expected: number, actual: number): void {
  console.log(
    `[unfold] ${label}: formula=${formula}; t=${THICKNESS}; r=${INNER_RADIUS}; K=${K_FACTOR}; expected=${formatNumber(expected)} actual=${formatNumber(actual)} delta=${percent(Math.abs(actual - expected) / expected)}%`
  );
}

function logAreaCheck(label: string, expectedArea: number, actualArea: number, width: number, height: number): void {
  console.log(
    `[unfold] ${label}: area formula=volume / thickness; expectedArea=${formatNumber(expectedArea)} actualArea=${formatNumber(actualArea)} areaDelta=${percent(Math.abs(actualArea - expectedArea) / expectedArea)}%`
  );
  console.log(`[unfold] ${label}: bbox=${formatNumber(width)} x ${formatNumber(height)}`);
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

function assertRectangularContour(points: Array<{ x: number; y: number }>, label: string): void {
  assert.equal(openLoop(points).length, 4, `${label} should drop collinear bend breakpoints`);
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

function assertLoopMatches(actual: Point2D[], expected: Point2D[], tolerance: number, label: string): void {
  const actualOpen = openLoop(actual);
  const expectedOpen = openLoop(expected);
  assert.equal(actualOpen.length, expectedOpen.length, `${label} point count`);

  const matches = (candidate: Point2D[]) => (
    candidate.every((point, index) => distance(point, expectedOpen[index]) <= tolerance)
  );
  for (let start = 0; start < actualOpen.length; start += 1) {
    const rotated = rotateLoop(actualOpen, start);
    if (matches(rotated) || matches([...rotated].reverse())) {
      return;
    }
  }

  assert.fail(`${label} differs from expected loop: actual=${JSON.stringify(actualOpen)} expected=${JSON.stringify(expectedOpen)}`);
}

function rotateLoop<T>(points: T[], start: number): T[] {
  return [...points.slice(start), ...points.slice(0, start)];
}

function pointsFromPairs(points: Array<[number, number]>): Point2D[] {
  return points.map(([x, y]) => ({ x, y }));
}

function closeLoop(points: Point2D[]): Point2D[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6) {
    return points;
  }
  return [...points, first];
}

function distance(left: Point2D, right: Point2D): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
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
