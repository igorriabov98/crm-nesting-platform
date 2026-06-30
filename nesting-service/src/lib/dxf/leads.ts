import type { Point2D } from '../nesting/types';

const EPSILON_MM = 0.01;

export type LeadSegmentKind = 'leadIn' | 'leadOut';

export type LeadSegment = {
  from: Point2D;
  to: Point2D;
  kind: LeadSegmentKind;
};

export type LeadPlacedPart = {
  x: number;
  y: number;
};

export type LeadObstacleBox = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LeadOptions = {
  leadInLength: number;
  leadOutLength: number;
};

export function createLeadSegments(
  contour: Point2D[],
  part: LeadPlacedPart,
  partIndex: number,
  contourName: string,
  sheet: { width: number; height: number },
  obstacleBoxes: LeadObstacleBox[],
  options: LeadOptions
): { segments: LeadSegment[]; warnings: string[] } {
  if (options.leadInLength <= 0 && options.leadOutLength <= 0) {
    return { segments: [], warnings: [] };
  }

  if (contour.length < 3) {
    return { segments: [], warnings: [`LEAD_SKIPPED part=${partIndex + 1} contour=${contourName} reason=short_contour`] };
  }

  for (let index = 0; index < contour.length; index += 1) {
    const point = contour[index];
    const next = contour[(index + 1) % contour.length];
    const previous = contour[(index - 1 + contour.length) % contour.length];
    const candidateSegments: LeadSegment[] = [];

    if (options.leadInLength > 0) {
      const normal = leftNormal(point, next);
      if (!normal) {
        continue;
      }
      candidateSegments.push({
        from: {
          x: point.x + normal.x * options.leadInLength,
          y: point.y + normal.y * options.leadInLength,
        },
        to: point,
        kind: 'leadIn',
      });
    }

    if (options.leadOutLength > 0) {
      const normal = leftNormal(previous, point);
      if (!normal) {
        continue;
      }
      candidateSegments.push({
        from: point,
        to: {
          x: point.x + normal.x * options.leadOutLength,
          y: point.y + normal.y * options.leadOutLength,
        },
        kind: 'leadOut',
      });
    }

    if (
      candidateSegments.every((segment) =>
        isSafeLeadSegment(segment, part, partIndex, sheet, obstacleBoxes)
      )
    ) {
      return { segments: candidateSegments, warnings: [] };
    }
  }

  return { segments: [], warnings: [`LEAD_SKIPPED part=${partIndex + 1} contour=${contourName} reason=no_safe_point`] };
}

function isSafeLeadSegment(
  segment: LeadSegment,
  part: LeadPlacedPart,
  partIndex: number,
  sheet: { width: number; height: number },
  obstacleBoxes: LeadObstacleBox[]
): boolean {
  const start = translatePoint(segment.from, part.x, part.y);
  const end = translatePoint(segment.to, part.x, part.y);

  if (!pointWithinSheet(start, sheet) || !pointWithinSheet(end, sheet)) {
    return false;
  }

  return obstacleBoxes.every((box) => box.index === partIndex || !segmentIntersectsBox(start, end, box));
}

function leftNormal(start: Point2D, end: Point2D): Point2D | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length < EPSILON_MM) {
    return null;
  }

  return { x: -dy / length, y: dx / length };
}

function pointWithinSheet(point: Point2D, sheet: { width: number; height: number }): boolean {
  return (
    point.x >= -EPSILON_MM &&
    point.y >= -EPSILON_MM &&
    point.x <= sheet.width + EPSILON_MM &&
    point.y <= sheet.height + EPSILON_MM
  );
}

function segmentIntersectsBox(start: Point2D, end: Point2D, box: LeadObstacleBox): boolean {
  const minX = box.x - EPSILON_MM;
  const minY = box.y - EPSILON_MM;
  const maxX = box.x + box.width + EPSILON_MM;
  const maxY = box.y + box.height + EPSILON_MM;

  if (pointInBox(start, minX, minY, maxX, maxY) || pointInBox(end, minX, minY, maxX, maxY)) {
    return true;
  }

  const corners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

  for (let index = 0; index < corners.length; index += 1) {
    if (segmentsIntersect(start, end, corners[index], corners[(index + 1) % corners.length])) {
      return true;
    }
  }

  return false;
}

function pointInBox(point: Point2D, minX: number, minY: number, maxX: number, maxY: number): boolean {
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (Math.abs(o1) < EPSILON_MM && pointOnSegment(c, a, b)) return true;
  if (Math.abs(o2) < EPSILON_MM && pointOnSegment(d, a, b)) return true;
  if (Math.abs(o3) < EPSILON_MM && pointOnSegment(a, c, d)) return true;
  if (Math.abs(o4) < EPSILON_MM && pointOnSegment(b, c, d)) return true;

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point: Point2D, start: Point2D, end: Point2D): boolean {
  return (
    point.x >= Math.min(start.x, end.x) - EPSILON_MM &&
    point.x <= Math.max(start.x, end.x) + EPSILON_MM &&
    point.y >= Math.min(start.y, end.y) - EPSILON_MM &&
    point.y <= Math.max(start.y, end.y) + EPSILON_MM
  );
}

function translatePoint(point: Point2D, offsetX: number, offsetY: number): Point2D {
  return { x: point.x + offsetX, y: point.y + offsetY };
}
