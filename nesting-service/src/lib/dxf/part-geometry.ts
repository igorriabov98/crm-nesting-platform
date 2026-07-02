import type { Point2D } from '../nesting/types';

const EPSILON_MM = 0.001;
const SCALE_MISMATCH_TOLERANCE = 0.005;

export type FittedPartGeometry = {
  contour: Point2D[];
  holes: Point2D[][];
  needsReview: boolean;
  reviewReason: string | null;
};

type Bounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export function readFittedPartGeometry(
  contourValue: unknown,
  holesValue: unknown,
  width: number,
  height: number
): FittedPartGeometry {
  const targetWidth = Math.max(0, width);
  const targetHeight = Math.max(0, height);
  const rawContour = isPointArray(contourValue) ? toPoints(contourValue) : createRectangleContour(targetWidth, targetHeight);
  const bounds = getBounds(removeClosingPoint(rawContour));

  if (!bounds || bounds.width <= EPSILON_MM || bounds.height <= EPSILON_MM || targetWidth <= 0 || targetHeight <= 0) {
    return {
      contour: createRectangleContour(targetWidth, targetHeight),
      holes: [],
      needsReview: false,
      reviewReason: null,
    };
  }

  const scaleX = targetWidth / bounds.width;
  const scaleY = targetHeight / bounds.height;
  const scaleDelta = Math.abs(scaleX - scaleY) / ((scaleX + scaleY) / 2);

  if (scaleDelta > SCALE_MISMATCH_TOLERANCE) {
    return {
      contour: createRectangleContour(targetWidth, targetHeight),
      holes: [],
      needsReview: true,
      reviewReason: [
        `DXF geometry scale mismatch`,
        `scaleX ${formatPercent(scaleX)}`,
        `scaleY ${formatPercent(scaleY)}`,
        `delta ${formatPercent(scaleDelta)}`,
      ].join('; '),
    };
  }

  const uniformScale = (scaleX + scaleY) / 2;
  const fittedWidth = bounds.width * uniformScale;
  const fittedHeight = bounds.height * uniformScale;
  const offsetX = (targetWidth - fittedWidth) / 2;
  const offsetY = (targetHeight - fittedHeight) / 2;
  const fitPoint = (point: Point2D): Point2D => ({
    x: roundMm((point.x - bounds.minX) * uniformScale + offsetX),
    y: roundMm((point.y - bounds.minY) * uniformScale + offsetY),
  });

  return {
    contour: rawContour.map(fitPoint),
    holes: readHoles(holesValue).map((hole) => hole.map(fitPoint)).filter((hole) => hole.length >= 3),
    needsReview: false,
    reviewReason: null,
  };
}

function createRectangleContour(width: number, height: number): Point2D[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
    { x: 0, y: 0 },
  ];
}

function readHoles(value: unknown): Point2D[][] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPointArray).map(toPoints);
}

function isPointArray(value: unknown): value is Array<{ x: unknown; y: unknown }> {
  return Array.isArray(value) && value.length >= 3 && value.every(isPointLike);
}

function isPointLike(value: unknown): value is { x: unknown; y: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Number.isFinite(Number(record.x)) && Number.isFinite(Number(record.y));
}

function toPoints(points: Array<{ x: unknown; y: unknown }>): Point2D[] {
  return points.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
}

function removeClosingPoint(points: Point2D[]): Point2D[] {
  if (points.length < 2) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];

  if (Math.hypot(first.x - last.x, first.y - last.y) <= EPSILON_MM) {
    return points.slice(0, -1);
  }

  return points;
}

function getBounds(points: Point2D[]): Bounds | null {
  if (points.length === 0) {
    return null;
  }

  const bounds = points.reduce(
    (current, point) => ({
      minX: Math.min(current.minX, point.x),
      minY: Math.min(current.minY, point.y),
      maxX: Math.max(current.maxX, point.x),
      maxY: Math.max(current.maxY, point.y),
    }),
    { minX: points[0].x, minY: points[0].y, maxX: points[0].x, maxY: points[0].y }
  );

  return {
    minX: bounds.minX,
    minY: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
