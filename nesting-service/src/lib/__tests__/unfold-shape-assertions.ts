import assert from 'node:assert/strict';
import { validateSimpleUnfoldContour } from '../brep/unfolder';
import { polygonNetArea, type Point2D } from '../geometry';

export type ArcShapeExpectation = {
  center: Point2D;
  radius: number;
  tolerance: number;
  minPoints: number;
  label: string;
};

export type FeaturePointExpectation = {
  x: number;
  y: number;
  tolerance: number;
  label: string;
};

export type UnfoldShapeSubject = {
  contour: Point2D[];
  holes?: Point2D[][];
  area?: number;
};

export type UnfoldShapeExpectation = {
  label: string;
  expectedArea?: number;
  areaTolerance?: number;
  bomBbox?: { width: number; height: number; tolerance?: number };
  exactContourPoints?: number;
  minContourPoints?: number;
  arcs?: ArcShapeExpectation[];
  featurePoints?: FeaturePointExpectation[];
};

export function assertUnfoldShape(subject: UnfoldShapeSubject, expectation: UnfoldShapeExpectation): void {
  const holes = subject.holes ?? [];
  assert.equal(
    validateSimpleUnfoldContour(subject.contour),
    null,
    `${expectation.label} contour should be simple`
  );

  const contourArea = polygonNetArea(subject.contour, holes);
  if (typeof subject.area === 'number') {
    assertWithin(contourArea, subject.area, 0.0001, `${expectation.label} stored area must match cut contour area`);
  }
  if (typeof expectation.expectedArea === 'number') {
    assertWithin(
      contourArea,
      expectation.expectedArea,
      expectation.areaTolerance ?? 0.02,
      `${expectation.label} cut contour area`
    );
  }

  if (expectation.bomBbox) {
    assertInsideBbox(subject.contour, expectation.bomBbox, expectation.label);
  }

  const contourPoints = openLoop(subject.contour).length;
  if (expectation.exactContourPoints !== undefined) {
    assert.equal(contourPoints, expectation.exactContourPoints, `${expectation.label} contour point count`);
  } else if (expectation.minContourPoints !== undefined) {
    assert.ok(
      contourPoints > expectation.minContourPoints,
      `${expectation.label} contour should keep real shape vertices`
    );
  }

  for (const arc of expectation.arcs ?? []) {
    assertArcPoints(subject.contour, arc);
  }
  for (const feature of expectation.featurePoints ?? []) {
    assertHasPoint(subject.contour, feature);
  }
}

export function assertNoComponentOverlap(
  contour: Point2D[],
  holes: Point2D[][],
  componentArea: number,
  label: string,
  tolerance = 0.5
): void {
  const cutArea = polygonNetArea(contour, holes);
  assert.ok(
    Math.abs(componentArea - cutArea) <= tolerance,
    `${label} component area should equal union cut area: components=${componentArea}, union=${cutArea}`
  );
}

export function openLoop<T extends Point2D>(points: T[]): T[] {
  const first = points[0];
  const last = points[points.length - 1];
  return first && last && Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6
    ? points.slice(0, -1)
    : points;
}

function assertInsideBbox(
  contour: Point2D[],
  bbox: { width: number; height: number; tolerance?: number },
  label: string
): void {
  const tolerance = bbox.tolerance ?? 0.5;
  for (const point of openLoop(contour)) {
    assert.ok(point.x >= -tolerance, `${label}: x=${point.x} is left of blank bbox`);
    assert.ok(point.y >= -tolerance, `${label}: y=${point.y} is below blank bbox`);
    assert.ok(point.x <= bbox.width + tolerance, `${label}: x=${point.x} exceeds blank width ${bbox.width}`);
    assert.ok(point.y <= bbox.height + tolerance, `${label}: y=${point.y} exceeds blank height ${bbox.height}`);
  }
}

function assertArcPoints(points: Point2D[], arc: ArcShapeExpectation): void {
  const arcPoints = openLoop(points).filter((point) => (
    Math.abs(Math.hypot(point.x - arc.center.x, point.y - arc.center.y) - arc.radius) <= arc.tolerance
  ));
  assert.ok(
    arcPoints.length >= arc.minPoints,
    `${arc.label} should preserve arc points: expected >=${arc.minPoints}, got ${arcPoints.length}`
  );
}

function assertHasPoint(points: Point2D[], feature: FeaturePointExpectation): void {
  assert.ok(
    points.some((point) => Math.hypot(point.x - feature.x, point.y - feature.y) <= feature.tolerance),
    `${feature.label}: expected point near ${feature.x},${feature.y}`
  );
}

function assertWithin(actual: number, expected: number, tolerance: number, label: string): void {
  const denominator = Math.max(1, Math.abs(expected));
  const relativeError = Math.abs(actual - expected) / denominator;
  assert.ok(relativeError <= tolerance, `${label}: ${actual} should be within ${tolerance * 100}% of ${expected}`);
}
