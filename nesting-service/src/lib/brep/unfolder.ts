import {
  ensureClockwise,
  ensureCounterClockwise,
  polygonArea,
  polygonNetArea,
  type Point2D,
} from '../geometry';
import type { SheetMetalBend, SheetMetalFlange, SheetMetalTopology } from './bend-detector';

export type UnfoldedPartContour = {
  contour: Point2D[];
  holes: Point2D[][];
  thickness: number;
  source: 'UNFOLDED_BREP';
  area: number;
  width: number;
  height: number;
  bendCount: number;
  kFactor: number;
  kFactorDefaulted: boolean;
};

type OrderedBend = {
  bend: SheetMetalBend;
  afterFlangeId: number;
};

type OrderedFlange = {
  flange: SheetMetalFlange;
  incomingBend: SheetMetalBend | null;
  outgoingBend: SheetMetalBend | null;
};

type Interval = {
  min: number;
  max: number;
};

type Segment = {
  a: Point2D;
  b: Point2D;
};

const AREA_TOLERANCE = 0.015;
const GEOMETRY_EPSILON = 0.001;
const COLLINEAR_EPSILON = 0.01;
const POINT_KEY_PRECISION = 1000;

export function unfoldPart(topology: SheetMetalTopology, kFactor: number): UnfoldedPartContour | null {
  const ordered = orderFlanges(topology);
  if (!ordered) {
    return null;
  }

  let cursorY = 0;
  const holes: Point2D[][] = [];
  const pieces: Point2D[][] = [];

  for (let index = 0; index < ordered.flanges.length; index += 1) {
    const item = ordered.flanges[index];
    const { flange } = item;
    const hasBend = item.incomingBend !== null || item.outgoingBend !== null;
    if (hasBend && hasHoleInBendZone(flange)) {
      return null;
    }

    const flipY = shouldFlipFlangeForUnfold(item);
    const flangeContour = translateContour(orientContour(flange, flipY), cursorY);
    pieces.push(flangeContour);
    holes.push(...flange.holes.map((hole) => translateHole(orientHole(hole, flange.width, flipY), cursorY)));
    cursorY += flange.width;

    const nextBend = ordered.bends.find((item) => item.afterFlangeId === flange.id);
    if (nextBend) {
      const bendHeight = bendAllowance(nextBend.bend, topology.thickness, kFactor);
      const nextFlange = ordered.flanges[index + 1];
      const intervals = nextFlange
        ? bendStripIntervals(item, nextFlange, nextBend.bend)
        : [{ min: 0, max: flange.length }];
      for (const interval of intervals) {
        pieces.push(rectangleContour(interval.min, cursorY, interval.max, cursorY + bendHeight));
      }
      cursorY += bendHeight;
    }
  }

  const stitched = stitchOuterContour(pieces);
  if (!stitched) {
    return null;
  }
  const normalized = normalizeUnfoldGeometry(stitched, holes);
  const width = roundMm(normalized.width, 100);
  const height = roundMm(normalized.height, 100);
  const contour = ensureClockwise(normalized.contour);
  const orientedHoles = normalized.holes.map(ensureCounterClockwise);
  const area = polygonNetArea(contour, orientedHoles);
  const expectedArea = topology.volume / topology.thickness;

  if (
    expectedArea > 0 &&
    Math.abs(area - expectedArea) / expectedArea > AREA_TOLERANCE &&
    !hasComplementBendAngle(topology.bends)
  ) {
    return null;
  }

  return {
    contour,
    holes: orientedHoles,
    thickness: topology.thickness,
    source: 'UNFOLDED_BREP',
    area,
    width,
    height,
    bendCount: topology.bends.length,
    kFactor,
    kFactorDefaulted: false,
  };
}

function orientContour(flange: SheetMetalFlange, flipY: boolean): Point2D[] {
  const cleanedContour = cleanBacktrackingContour(flange.contour);
  const contour = cleanedContour.length >= 4
    ? cleanedContour
    : rectangleContour(0, 0, flange.length, flange.width);

  if (!flipY) {
    return closeContour(contour.map((point) => ({ x: point.x, y: point.y })));
  }

  return closeContour(contour.map((point) => ({
    x: point.x,
    y: flange.width - point.y,
  })));
}

function cleanBacktrackingContour(contour: Point2D[]): Point2D[] {
  const stack: Point2D[] = [];
  for (const point of openContour(contour)) {
    const rounded = roundPoint(point);
    const previous = stack[stack.length - 1];
    if (previous && samePoint(previous, rounded)) {
      continue;
    }

    stack.push(rounded);
    while (stack.length >= 3 && samePoint(stack[stack.length - 1], stack[stack.length - 3])) {
      stack.splice(stack.length - 2, 2);
    }
  }

  return closeContour(removeCollinearOpenPoints(stack));
}

function removeCollinearOpenPoints(points: Point2D[]): Point2D[] {
  if (points.length < 3) {
    return points;
  }

  const cleaned: Point2D[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = cross2D(
      { x: current.x - previous.x, y: current.y - previous.y },
      { x: next.x - current.x, y: next.y - current.y }
    );
    if (distance(previous, current) > GEOMETRY_EPSILON && Math.abs(cross) > COLLINEAR_EPSILON) {
      cleaned.push(current);
    }
  }

  return cleaned.length >= 3 ? cleaned : points;
}

function translateContour(contour: Point2D[], offsetY: number): Point2D[] {
  return closeContour(contour.map((point) => ({
    x: roundMm(point.x, 1000),
    y: roundMm(point.y + offsetY, 1000),
  })));
}

function rectangleContour(minX: number, minY: number, maxX: number, maxY: number): Point2D[] {
  return closeContour([
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]);
}

function bendStripIntervals(
  current: OrderedFlange,
  next: OrderedFlange,
  bend: SheetMetalBend
): Interval[] {
  const currentIntervals = bendSideIntervals(current.flange, bend, shouldFlipFlangeForUnfold(current));
  const nextIntervals = bendSideIntervals(next.flange, bend, shouldFlipFlangeForUnfold(next));
  const intersection = intersectIntervals(currentIntervals, nextIntervals);
  if (intersection.length > 0) {
    return intersection;
  }

  const merged = mergeIntervals([...currentIntervals, ...nextIntervals]);
  if (merged.length > 0) {
    return merged;
  }

  return [{ min: 0, max: Math.max(current.flange.length, next.flange.length) }];
}

function bendSideIntervals(flange: SheetMetalFlange, bend: SheetMetalBend, flipY: boolean): Interval[] {
  const bendY = bendAxisYOnFlange(flange, bend);
  if (bendY === null) {
    return [{ min: 0, max: flange.length }];
  }

  const sideY = bendY < flange.width / 2 ? 0 : flange.width;
  const orientedY = flipY ? flange.width - sideY : sideY;
  const intervals = intervalsAtY(orientContour(flange, flipY), orientedY);

  return intervals.length > 0 ? intervals : [{ min: 0, max: flange.length }];
}

function intervalsAtY(contour: Point2D[], y: number): Interval[] {
  const intervals: Interval[] = [];
  const open = openContour(contour);
  for (let index = 0; index < open.length; index += 1) {
    const a = open[index];
    const b = open[(index + 1) % open.length];
    if (Math.abs(a.y - y) > COLLINEAR_EPSILON || Math.abs(b.y - y) > COLLINEAR_EPSILON) {
      continue;
    }
    const min = Math.min(a.x, b.x);
    const max = Math.max(a.x, b.x);
    if (max - min > GEOMETRY_EPSILON) {
      intervals.push({ min, max });
    }
  }

  return mergeIntervals(intervals);
}

function intersectIntervals(left: Interval[], right: Interval[]): Interval[] {
  const intersections: Interval[] = [];
  for (const a of left) {
    for (const b of right) {
      const min = Math.max(a.min, b.min);
      const max = Math.min(a.max, b.max);
      if (max - min > GEOMETRY_EPSILON) {
        intersections.push({ min, max });
      }
    }
  }

  return mergeIntervals(intersections);
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.max - interval.min > GEOMETRY_EPSILON)
    .sort((left, right) => left.min - right.min || left.max - right.max);
  const merged: Interval[] = [];

  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.min <= previous.max + GEOMETRY_EPSILON) {
      previous.max = Math.max(previous.max, interval.max);
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

function stitchOuterContour(polygons: Point2D[][]): Point2D[] | null {
  const rawSegments = polygons.flatMap((polygon) => contourSegments(polygon));
  if (rawSegments.length === 0) {
    return null;
  }

  const splitSegments = splitCollinearSegments(rawSegments);
  const boundary = removeInternalSegments(splitSegments);
  const loops = chainSegments(boundary);
  const outer = loops
    .filter((loop) => loop.length >= 4)
    .sort((left, right) => polygonArea(right) - polygonArea(left))[0];

  if (!outer) {
    return null;
  }

  return removeCollinearPoints(closeContour(outer));
}

function contourSegments(contour: Point2D[]): Segment[] {
  const open = openContour(contour);
  const segments: Segment[] = [];
  for (let index = 0; index < open.length; index += 1) {
    const a = open[index];
    const b = open[(index + 1) % open.length];
    if (distance(a, b) > GEOMETRY_EPSILON) {
      segments.push({ a, b });
    }
  }

  return segments;
}

function splitCollinearSegments(segments: Segment[]): Segment[] {
  const result: Segment[] = [];

  for (const segment of segments) {
    const splits = [0, 1];
    for (const other of segments) {
      if (segment === other || !sameLine(segment, other)) {
        continue;
      }
      const tA = segmentParameter(segment, other.a);
      const tB = segmentParameter(segment, other.b);
      if (tA > GEOMETRY_EPSILON && tA < 1 - GEOMETRY_EPSILON) splits.push(tA);
      if (tB > GEOMETRY_EPSILON && tB < 1 - GEOMETRY_EPSILON) splits.push(tB);
    }

    const unique = uniqueNumbers(splits).sort((left, right) => left - right);
    for (let index = 0; index < unique.length - 1; index += 1) {
      const start = unique[index];
      const end = unique[index + 1];
      if (end - start <= GEOMETRY_EPSILON) {
        continue;
      }
      const a = interpolate(segment, start);
      const b = interpolate(segment, end);
      if (distance(a, b) > GEOMETRY_EPSILON) {
        result.push({ a, b });
      }
    }
  }

  return result;
}

function removeInternalSegments(segments: Segment[]): Segment[] {
  const counts = new Map<string, { segment: Segment; count: number }>();
  for (const segment of segments) {
    const normalized = normalizeSegment(segment);
    const key = segmentKey(normalized);
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(key, { segment: normalized, count: 1 });
    }
  }

  return Array.from(counts.values())
    .filter((entry) => entry.count === 1)
    .map((entry) => entry.segment);
}

function chainSegments(segments: Segment[]): Point2D[][] {
  const unused = [...segments];
  const loops: Point2D[][] = [];

  while (unused.length > 0) {
    const first = unused.shift()!;
    const loop = [first.a, first.b];

    while (unused.length > 0) {
      const current = loop[loop.length - 1];
      if (samePoint(current, loop[0])) {
        break;
      }

      const nextIndex = unused.findIndex((segment) => samePoint(segment.a, current) || samePoint(segment.b, current));
      if (nextIndex < 0) {
        break;
      }

      const [next] = unused.splice(nextIndex, 1);
      loop.push(samePoint(next.a, current) ? next.b : next.a);
    }

    if (samePoint(loop[loop.length - 1], loop[0])) {
      loops.push(closeContour(loop));
    }
  }

  return loops;
}

function normalizeUnfoldGeometry(contour: Point2D[], holes: Point2D[][]): {
  contour: Point2D[];
  holes: Point2D[][];
  width: number;
  height: number;
} {
  const bounds = boundsOf(contour);
  const shift = (point: Point2D): Point2D => ({
    x: roundMm(point.x - bounds.minX, 1000),
    y: roundMm(point.y - bounds.minY, 1000),
  });
  const normalizedContour = closeContour(contour.map(shift));
  const normalizedHoles = holes.map((hole) => closeContour(hole.map(shift))).filter((hole) => hole.length >= 4);
  const normalizedBounds = boundsOf(normalizedContour);

  return {
    contour: normalizedContour,
    holes: normalizedHoles,
    width: normalizedBounds.maxX - normalizedBounds.minX,
    height: normalizedBounds.maxY - normalizedBounds.minY,
  };
}

function removeCollinearPoints(contour: Point2D[]): Point2D[] {
  const open = openContour(contour);
  const cleaned: Point2D[] = [];
  for (let index = 0; index < open.length; index += 1) {
    const previous = open[(index - 1 + open.length) % open.length];
    const current = open[index];
    const next = open[(index + 1) % open.length];
    const cross = cross2D(
      { x: current.x - previous.x, y: current.y - previous.y },
      { x: next.x - current.x, y: next.y - current.y }
    );
    if (distance(previous, current) > GEOMETRY_EPSILON && Math.abs(cross) > COLLINEAR_EPSILON) {
      cleaned.push(current);
    }
  }

  return closeContour(cleaned);
}

function sameLine(left: Segment, right: Segment): boolean {
  const vector = { x: left.b.x - left.a.x, y: left.b.y - left.a.y };
  const length = Math.hypot(vector.x, vector.y);
  if (length <= GEOMETRY_EPSILON) {
    return false;
  }

  const crossA = cross2D(vector, { x: right.a.x - left.a.x, y: right.a.y - left.a.y });
  const crossB = cross2D(vector, { x: right.b.x - left.a.x, y: right.b.y - left.a.y });
  if (Math.abs(crossA) / length > COLLINEAR_EPSILON || Math.abs(crossB) / length > COLLINEAR_EPSILON) {
    return false;
  }

  const a = segmentParameter(left, right.a);
  const b = segmentParameter(left, right.b);
  return Math.max(Math.min(a, b), 0) <= Math.min(Math.max(a, b), 1) + GEOMETRY_EPSILON;
}

function segmentParameter(segment: Segment, point: Point2D): number {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= GEOMETRY_EPSILON) {
    return 0;
  }

  return ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared;
}

function interpolate(segment: Segment, t: number): Point2D {
  return {
    x: roundMm(segment.a.x + (segment.b.x - segment.a.x) * t, 1000),
    y: roundMm(segment.a.y + (segment.b.y - segment.a.y) * t, 1000),
  };
}

function normalizeSegment(segment: Segment): Segment {
  const aKey = pointKey(segment.a);
  const bKey = pointKey(segment.b);
  return aKey <= bKey
    ? { a: roundPoint(segment.a), b: roundPoint(segment.b) }
    : { a: roundPoint(segment.b), b: roundPoint(segment.a) };
}

function segmentKey(segment: Segment): string {
  return `${pointKey(segment.a)}>${pointKey(segment.b)}`;
}

function pointKey(point: Point2D): string {
  return `${Math.round(point.x * POINT_KEY_PRECISION)},${Math.round(point.y * POINT_KEY_PRECISION)}`;
}

function uniqueNumbers(values: number[]): number[] {
  const result: number[] = [];
  for (const value of values) {
    if (!result.some((existing) => Math.abs(existing - value) <= GEOMETRY_EPSILON)) {
      result.push(value);
    }
  }

  return result;
}

function openContour(contour: Point2D[]): Point2D[] {
  const first = contour[0];
  const last = contour[contour.length - 1];
  return first && last && samePoint(first, last) ? contour.slice(0, -1) : contour;
}

function closeContour(points: Point2D[]): Point2D[] {
  if (points.length === 0) {
    return [];
  }
  const closed = points.map(roundPoint);
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (!samePoint(first, last)) {
    closed.push({ ...first });
  }

  return closed;
}

function boundsOf(points: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

function roundPoint(point: Point2D): Point2D {
  return {
    x: roundMm(point.x, 1000),
    y: roundMm(point.y, 1000),
  };
}

function samePoint(left: Point2D, right: Point2D): boolean {
  return pointKey(left) === pointKey(right);
}

function distance(left: Point2D, right: Point2D): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function cross2D(left: Point2D, right: Point2D): number {
  return left.x * right.y - left.y * right.x;
}

function orderFlanges(topology: SheetMetalTopology): { flanges: OrderedFlange[]; bends: OrderedBend[] } | null {
  const adjacency = new Map<number, Array<{ next: number; bend: SheetMetalBend }>>();
  for (const flange of topology.flanges) {
    adjacency.set(flange.id, []);
  }
  for (const bend of topology.bends) {
    adjacency.get(bend.from)?.push({ next: bend.to, bend });
    adjacency.get(bend.to)?.push({ next: bend.from, bend });
  }

  if ([...adjacency.values()].some((edges) => edges.length > 2)) {
    return null;
  }

  const start = selectStartFlange(topology.flanges, adjacency);
  if (!start) {
    return null;
  }

  const byId = new Map(topology.flanges.map((flange) => [flange.id, flange]));
  const ordered: OrderedFlange[] = [];
  const orderedBends: OrderedBend[] = [];
  let previous: number | null = null;
  let incomingBend: SheetMetalBend | null = null;
  let current = start.id;

  while (true) {
    const flange = byId.get(current);
    if (!flange) {
      return null;
    }

    const nextEdge = (adjacency.get(current) ?? []).find((edge) => edge.next !== previous);
    ordered.push({
      flange,
      incomingBend,
      outgoingBend: nextEdge?.bend ?? null,
    });

    if (!nextEdge) {
      break;
    }

    orderedBends.push({ bend: nextEdge.bend, afterFlangeId: current });
    previous = current;
    incomingBend = nextEdge.bend;
    current = nextEdge.next;
  }

  return ordered.length === topology.flanges.length ? { flanges: ordered, bends: orderedBends } : null;
}

function selectStartFlange(
  flanges: SheetMetalFlange[],
  adjacency: Map<number, Array<{ next: number; bend: SheetMetalBend }>>
): SheetMetalFlange | null {
  const endpoints = flanges.filter((flange) => adjacency.get(flange.id)?.length === 1);
  if (endpoints.length === 0) {
    return null;
  }

  return endpoints.sort(
    (left, right) =>
      left.width - right.width ||
      left.length - right.length ||
      compareVec(left.uAxis, right.uAxis) ||
      compareVec(left.vAxis, right.vAxis) ||
      compareVec(left.localOrigin, right.localOrigin) ||
      left.id - right.id
  )[0];
}

function compareVec(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number }
): number {
  return (
    compareNumber(left.x, right.x) ||
    compareNumber(left.y, right.y) ||
    compareNumber(left.z, right.z)
  );
}

function compareNumber(left: number, right: number): number {
  const delta = left - right;
  return Math.abs(delta) <= 1e-6 ? 0 : delta;
}

function shouldFlipFlangeForUnfold(item: OrderedFlange): boolean {
  if (item.incomingBend) {
    const bendY = bendAxisYOnFlange(item.flange, item.incomingBend);
    return bendY !== null && bendY > item.flange.width / 2;
  }

  if (item.outgoingBend) {
    const bendY = bendAxisYOnFlange(item.flange, item.outgoingBend);
    return bendY !== null && bendY < item.flange.width / 2;
  }

  return false;
}

function bendAxisYOnFlange(flange: SheetMetalFlange, bend: SheetMetalBend): number | null {
  const delta = {
    x: bend.axisLocation.x - flange.localOrigin.x,
    y: bend.axisLocation.y - flange.localOrigin.y,
    z: bend.axisLocation.z - flange.localOrigin.z,
  };
  const y = delta.x * flange.vAxis.x + delta.y * flange.vAxis.y + delta.z * flange.vAxis.z;

  return Number.isFinite(y) ? y : null;
}

function bendAllowance(bend: SheetMetalBend, thickness: number, kFactor: number): number {
  return bend.angleRad * (bend.innerRadius + kFactor * thickness);
}

function hasComplementBendAngle(bends: SheetMetalBend[]): boolean {
  return bends.some((bend) => bend.usesComplementAngle);
}

function orientHole(hole: Point2D[], flangeWidth: number, flipY: boolean): Point2D[] {
  if (!flipY) {
    return hole;
  }

  return hole.map((point) => ({
    x: point.x,
    y: flangeWidth - point.y,
  }));
}

function translateHole(hole: Point2D[], offsetY: number): Point2D[] {
  return hole.map((point) => ({
    x: roundMm(point.x, 1000),
    y: roundMm(point.y + offsetY, 1000),
  }));
}

function hasHoleInBendZone(flange: SheetMetalFlange): boolean {
  const guard = Math.max(flange.width * 0.02, 1);

  return flange.holes.some((hole) => {
    const ys = hole.map((point) => point.y);
    if (ys.length === 0) {
      return false;
    }

    return Math.min(...ys) <= guard || Math.max(...ys) >= flange.width - guard;
  });
}

function roundMm(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}
