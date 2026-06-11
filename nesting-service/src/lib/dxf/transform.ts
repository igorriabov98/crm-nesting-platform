import type { Point2D } from '../nesting/types';

export type DxfRotation = 0 | 90 | 180 | 270;

const CLOSING_POINT_EPSILON_MM = 0.01;

export function transformContourForDxf(
  contour: Point2D[],
  rotation: DxfRotation,
  offsetX: number,
  offsetY: number,
  partW: number,
  partH: number
): Point2D[] {
  return contour.map((point) => {
    switch (rotation) {
      case 0:
        return { x: point.x + offsetX, y: point.y + offsetY };
      case 90:
        return { x: partH - point.y + offsetX, y: point.x + offsetY };
      case 180:
        return { x: partW - point.x + offsetX, y: partH - point.y + offsetY };
      case 270:
        return { x: point.y + offsetX, y: partW - point.x + offsetY };
      default:
        return { x: point.x + offsetX, y: point.y + offsetY };
    }
  });
}

export function signedArea(points: Point2D[]): number {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
}

export function ensureCW(points: Point2D[]): Point2D[] {
  return signedArea(points) > 0 ? [...points].reverse() : points;
}

export function ensureCCW(points: Point2D[]): Point2D[] {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

export function removeClosingPoint(points: Point2D[]): Point2D[] {
  if (points.length < 2) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const dist = Math.hypot(first.x - last.x, first.y - last.y);

  if (dist < CLOSING_POINT_EPSILON_MM) {
    return points.slice(0, -1);
  }

  return points;
}
