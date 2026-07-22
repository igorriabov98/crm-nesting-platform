import type { PlacedPart, Point2D, SheetResult, UnplacedPart, UnplacedReasonCode } from '../nesting/types';

const DEFAULT_TOLERANCE_MM = 0.01;
const GEOMETRY_EPSILON_MM = 0.0001;

export type LayoutViolationType =
  | 'overlap'
  | 'gap'
  | 'out_of_bounds'
  | 'quantity'
  | 'EXCLUDED_FROM_NESTING'
  | 'EXCLUDED_PROFILE'
  | 'EXCLUDED_PURCHASED'
  | 'NO_SHEET_AVAILABLE'
  | 'MISSING_THICKNESS'
  | 'NESTING_FAILED'
  | 'UNPLACED_WITHOUT_REASON'
  | 'BODY_COUNT_MISMATCH'
  | 'AI_ANALYSIS_FAILED'
  | 'AI_ANALYSIS_WARNING'
  | 'hole_outside'
  | 'part_in_hole';

export type LayoutViolation = {
  type: LayoutViolationType;
  sheetIndex?: number;
  sheetId?: string;
  partIds: string[];
  amountMm?: number;
  expected?: number;
  actual?: number;
  reasonCode?: UnplacedReasonCode;
  reason?: string;
  material?: string | null;
  steelTypeName?: string | null;
  thickness?: number | null;
  requiredWidth?: number | null;
  requiredHeight?: number | null;
  severity?: 'info' | 'warning' | 'error';
  message: string;
};

export type LayoutValidationReport = {
  valid: boolean;
  violations: LayoutViolation[];
  checkedAt: string;
};

export function areLayoutViolationsValid(violations: LayoutViolation[]): boolean {
  return !violations.some((violation) => (violation.severity ?? 'error') === 'error');
}

export type LayoutValidationPart = {
  id: string;
  name: string;
  quantity: number;
};

export type LayoutValidationParams = {
  unplacedParts?: UnplacedPart[];
  excludedParts?: Array<{ partId: string; name: string; quantity: number; reason: string; reasonCode?: UnplacedReasonCode }>;
  toleranceMm?: number;
  stepSolidCount?: number | null;
  accountedBodies?: number | null;
};

type PlacementShape = {
  placement: PlacedPart;
  contour: Point2D[];
  holes: Point2D[][];
  bbox: BBox;
};

type BBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function validateLayout(
  sheets: SheetResult[],
  parts: LayoutValidationPart[],
  params: LayoutValidationParams = {}
): LayoutValidationReport {
  const tolerance = params.toleranceMm ?? DEFAULT_TOLERANCE_MM;
  const violations: LayoutViolation[] = [];
  const placedCounts = new Map<string, number>();

  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
    const sheet = sheets[sheetIndex];
    const shapes = sheet.placements.map((placement) => toPlacementShape(placement));

    for (const shape of shapes) {
      placedCounts.set(shape.placement.partId, (placedCounts.get(shape.placement.partId) ?? 0) + 1);
      validateInsideSheet(shape, sheet, sheetIndex, tolerance, violations);
      validateHoles(shape, sheet, sheetIndex, violations);
    }

    validatePairs(shapes, sheet, sheetIndex, tolerance, violations);
  }

  validateExcludedParts(params.excludedParts ?? [], violations);
  validateUnplacedParts(params.unplacedParts ?? [], violations);
  validateBodyCount(params.stepSolidCount, params.accountedBodies, violations);
  validateQuantities(parts, placedCounts, params.unplacedParts ?? [], violations);

  return {
    valid: areLayoutViolationsValid(violations),
    violations,
    checkedAt: new Date().toISOString(),
  };
}

function validateBodyCount(
  stepSolidCount: number | null | undefined,
  accountedBodies: number | null | undefined,
  violations: LayoutViolation[]
): void {
  if (!Number.isFinite(stepSolidCount) || !Number.isFinite(accountedBodies)) {
    return;
  }

  const expected = Math.round(stepSolidCount as number);
  const actual = Math.round(accountedBodies as number);
  if (expected === actual) {
    return;
  }

  violations.push({
    type: 'BODY_COUNT_MISMATCH',
    partIds: [],
    expected,
    actual,
    severity: 'error',
    message: `bodies: step=${expected}, accounted=${actual}`,
  });
}

function validateInsideSheet(
  shape: PlacementShape,
  sheet: SheetResult,
  sheetIndex: number,
  tolerance: number,
  violations: LayoutViolation[]
): void {
  const minAllowedX = sheet.usedMargin - tolerance;
  const minAllowedY = sheet.usedMargin - tolerance;
  const maxAllowedX = sheet.width - sheet.usedMargin + tolerance;
  const maxAllowedY = sheet.height - sheet.usedMargin + tolerance;

  const outside = shape.contour.some((point) =>
    point.x < minAllowedX ||
    point.y < minAllowedY ||
    point.x > maxAllowedX ||
    point.y > maxAllowedY
  );

  if (!outside) return;

  const amount = Math.max(
    sheet.usedMargin - shape.bbox.minX,
    sheet.usedMargin - shape.bbox.minY,
    shape.bbox.maxX - (sheet.width - sheet.usedMargin),
    shape.bbox.maxY - (sheet.height - sheet.usedMargin),
    0
  );

  violations.push({
    type: 'out_of_bounds',
    sheetIndex,
    partIds: [shape.placement.partId],
    amountMm: roundMm(amount),
    message: `Деталь ${shape.placement.name} выходит за рабочую область листа`,
  });
}

function validateHoles(
  shape: PlacementShape,
  sheet: SheetResult,
  sheetIndex: number,
  violations: LayoutViolation[]
): void {
  for (const hole of shape.holes) {
    const holeOutside = hole.some((point) => !pointInPolygon(point, shape.contour, true)) ||
      segmentsIntersectAny(hole, shape.contour);

    if (!holeOutside) continue;

    violations.push({
      type: 'hole_outside',
      sheetIndex,
      sheetId: sheet.sheetOptionId,
      partIds: [shape.placement.partId],
      message: `Отверстие детали ${shape.placement.name} выходит за внешний контур`,
    });
  }
}

function validatePairs(
  shapes: PlacementShape[],
  sheet: SheetResult,
  sheetIndex: number,
  tolerance: number,
  violations: LayoutViolation[]
): void {
  const minGap = sheet.usedGap - tolerance;

  for (let leftIndex = 0; leftIndex < shapes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < shapes.length; rightIndex += 1) {
      const left = shapes[leftIndex];
      const right = shapes[rightIndex];

      if (bboxDistance(left.bbox, right.bbox) > minGap) continue;

      if (polygonsOverlap(left.contour, right.contour)) {
        violations.push({
          type: 'overlap',
          sheetIndex,
          sheetId: sheet.sheetOptionId,
          partIds: [left.placement.partId, right.placement.partId],
          message: `Детали ${left.placement.name} и ${right.placement.name} пересекаются`,
        });
        continue;
      }

      const distance = polygonDistance(left.contour, right.contour);
      if (distance < minGap) {
        violations.push({
          type: 'gap',
          sheetIndex,
          sheetId: sheet.sheetOptionId,
          partIds: [left.placement.partId, right.placement.partId],
          amountMm: roundMm(Math.max(sheet.usedGap - distance, 0)),
          message: `Зазор между ${left.placement.name} и ${right.placement.name} меньше ${sheet.usedGap} мм`,
        });
      }

      validatePartInHole(left, right, sheet, sheetIndex, violations);
      validatePartInHole(right, left, sheet, sheetIndex, violations);
    }
  }
}

function validatePartInHole(
  candidate: PlacementShape,
  host: PlacementShape,
  sheet: SheetResult,
  sheetIndex: number,
  violations: LayoutViolation[]
): void {
  for (const hole of host.holes) {
    if (candidate.contour.every((point) => pointInPolygon(point, hole, true))) {
      violations.push({
        type: 'part_in_hole',
        sheetIndex,
        sheetId: sheet.sheetOptionId,
        partIds: [candidate.placement.partId, host.placement.partId],
        message: `Деталь ${candidate.placement.name} размещена внутри отверстия детали ${host.placement.name}`,
      });
    }
  }
}

function validateQuantities(
  parts: LayoutValidationPart[],
  placedCounts: Map<string, number>,
  unplacedParts: UnplacedPart[],
  violations: LayoutViolation[]
): void {
  const unplacedCounts = new Map<string, number>();
  for (const item of unplacedParts) {
    unplacedCounts.set(item.partId, (unplacedCounts.get(item.partId) ?? 0) + 1);
  }

  for (const part of parts) {
    const actual = (placedCounts.get(part.id) ?? 0) + (unplacedCounts.get(part.id) ?? 0);
    if (actual === part.quantity) continue;

    violations.push({
      type: 'quantity',
      partIds: [part.id],
      expected: part.quantity,
      actual,
      message: `Количество детали ${part.name}: ожидалось ${part.quantity}, учтено ${actual}`,
    });
  }
}

function validateUnplacedParts(
  unplacedParts: UnplacedPart[],
  violations: LayoutViolation[]
): void {
  for (const part of unplacedParts) {
    if (isExcludedReasonCode(part.reasonCode)) continue;

    const type = reasonCodeToViolationType(part.reasonCode);
    const reason = part.reason?.trim() || 'причина не указана';
    violations.push({
      type,
      partIds: [part.partId],
      reasonCode: part.reasonCode,
      reason,
      material: part.material ?? null,
      steelTypeName: part.steelTypeName ?? null,
      thickness: part.thickness ?? null,
      requiredWidth: part.requiredWidth ?? null,
      requiredHeight: part.requiredHeight ?? null,
      message: `${part.name || part.partId}: ${reason}`,
    });
  }
}

function validateExcludedParts(
  excludedParts: Array<{ partId: string; name: string; quantity: number; reason: string; reasonCode?: UnplacedReasonCode }>,
  violations: LayoutViolation[]
): void {
  for (const part of excludedParts) {
    violations.push({
      type: excludedReasonCodeToViolationType(part.reasonCode),
      partIds: [part.partId],
      expected: part.quantity,
      actual: 0,
      reasonCode: part.reasonCode,
      reason: part.reason,
      severity: 'info',
      message: `Деталь ${part.name} исключена из листового раскроя: ${part.reason}`,
    });
  }
}

function reasonCodeToViolationType(reasonCode: UnplacedReasonCode): LayoutViolationType {
  switch (reasonCode) {
    case 'NO_SHEET_AVAILABLE':
      return 'NO_SHEET_AVAILABLE';
    case 'MISSING_THICKNESS':
      return 'MISSING_THICKNESS';
    case 'NESTING_FAILED':
      return 'NESTING_FAILED';
    case 'EXCLUDED':
      return 'EXCLUDED_FROM_NESTING';
    case 'EXCLUDED_PROFILE':
      return 'EXCLUDED_PROFILE';
    case 'EXCLUDED_PURCHASED':
      return 'EXCLUDED_PURCHASED';
    case 'UNPLACED_WITHOUT_REASON':
      return 'UNPLACED_WITHOUT_REASON';
  }
}

function excludedReasonCodeToViolationType(reasonCode: UnplacedReasonCode | undefined): LayoutViolationType {
  if (reasonCode === 'EXCLUDED_PURCHASED') return 'EXCLUDED_PURCHASED';
  if (reasonCode === 'EXCLUDED_PROFILE') return 'EXCLUDED_PROFILE';
  return 'EXCLUDED_FROM_NESTING';
}

function isExcludedReasonCode(reasonCode: UnplacedReasonCode): boolean {
  return reasonCode === 'EXCLUDED' || reasonCode === 'EXCLUDED_PROFILE' || reasonCode === 'EXCLUDED_PURCHASED';
}

function toPlacementShape(placement: PlacedPart): PlacementShape {
  const contour = normalizePolygon(placement.contour.length >= 3 ? placement.contour : rectangleContour(placement));
  const holes = placement.holes.map(normalizePolygon).filter((hole) => hole.length >= 3);

  return {
    placement,
    contour,
    holes,
    bbox: boundsOf(contour),
  };
}

function rectangleContour(placement: PlacedPart): Point2D[] {
  return [
    { x: placement.x, y: placement.y },
    { x: placement.x + placement.placedW, y: placement.y },
    { x: placement.x + placement.placedW, y: placement.y + placement.placedH },
    { x: placement.x, y: placement.y + placement.placedH },
  ];
}

function normalizePolygon(points: Point2D[]): Point2D[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) <= GEOMETRY_EPSILON_MM) {
    return points.slice(0, -1);
  }
  return points;
}

function boundsOf(points: Point2D[]): BBox {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: points[0].x, minY: points[0].y, maxX: points[0].x, maxY: points[0].y }
  );
}

function bboxDistance(left: BBox, right: BBox): number {
  const dx = Math.max(0, Math.max(left.minX, right.minX) - Math.min(left.maxX, right.maxX));
  const dy = Math.max(0, Math.max(left.minY, right.minY) - Math.min(left.maxY, right.maxY));
  return Math.hypot(dx, dy);
}

function polygonsOverlap(left: Point2D[], right: Point2D[]): boolean {
  if (segmentsIntersectAny(left, right)) return true;
  return pointInPolygon(left[0], right, false) || pointInPolygon(right[0], left, false);
}

function segmentsIntersectAny(left: Point2D[], right: Point2D[]): boolean {
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const a = left[leftIndex];
    const b = left[(leftIndex + 1) % left.length];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const c = right[rightIndex];
      const d = right[(rightIndex + 1) % right.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(c, a, b)) return true;
  if (o2 === 0 && pointOnSegment(d, a, b)) return true;
  if (o3 === 0 && pointOnSegment(a, c, d)) return true;
  if (o4 === 0 && pointOnSegment(b, c, d)) return true;
  return false;
}

function orientation(a: Point2D, b: Point2D, c: Point2D): -1 | 0 | 1 {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) <= GEOMETRY_EPSILON_MM) return 0;
  return value > 0 ? 1 : -1;
}

function pointOnSegment(point: Point2D, start: Point2D, end: Point2D): boolean {
  return (
    point.x <= Math.max(start.x, end.x) + GEOMETRY_EPSILON_MM &&
    point.x + GEOMETRY_EPSILON_MM >= Math.min(start.x, end.x) &&
    point.y <= Math.max(start.y, end.y) + GEOMETRY_EPSILON_MM &&
    point.y + GEOMETRY_EPSILON_MM >= Math.min(start.y, end.y) &&
    Math.abs(cross(start, end, point)) <= GEOMETRY_EPSILON_MM
  );
}

function pointInPolygon(point: Point2D, polygon: Point2D[], includeBoundary: boolean): boolean {
  let inside = false;

  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
    const current = polygon[index];
    const previous = polygon[previousIndex];

    if (pointOnSegment(point, previous, current)) return includeBoundary;

    const intersects = ((current.y > point.y) !== (previous.y > point.y)) &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }

  return inside;
}

function polygonDistance(left: Point2D[], right: Point2D[]): number {
  let minDistance = Number.POSITIVE_INFINITY;

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const a = left[leftIndex];
    const b = left[(leftIndex + 1) % left.length];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const c = right[rightIndex];
      const d = right[(rightIndex + 1) % right.length];
      minDistance = Math.min(
        minDistance,
        pointToSegmentDistance(a, c, d),
        pointToSegmentDistance(b, c, d),
        pointToSegmentDistance(c, a, b),
        pointToSegmentDistance(d, a, b)
      );
    }
  }

  return minDistance;
}

function pointToSegmentDistance(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= GEOMETRY_EPSILON_MM) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function cross(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}
