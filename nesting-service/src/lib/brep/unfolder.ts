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

type Transform2D = {
  origin: Point2D;
  xAxis: Point2D;
  yAxis: Point2D;
};

type PlacedFlange = {
  flange: SheetMetalFlange;
  transform: Transform2D;
  contour: Point2D[];
};

type BendLine2D = {
  point: Point2D;
  direction: Point2D;
};

type Vec3 = SheetMetalFlange['normal'];

const AREA_TOLERANCE = 0.02;
const GEOMETRY_EPSILON = 0.001;
const COLLINEAR_EPSILON = 0.01;
const COLLINEAR_ANGLE_TOLERANCE_RAD = (0.5 * Math.PI) / 180;
const FLANGE_BOUNDARY_SNAP_TOLERANCE = 0.01;
const POINT_KEY_PRECISION = 100;
const PARALLEL_DOT_TOLERANCE = 0.999;

export function unfoldPart(topology: SheetMetalTopology, kFactor: number): UnfoldedPartContour | null {
  const ordered = orderFlanges(topology);
  const shareAxis = topologyBendsShareAxis(topology);
  if (ordered && shareAxis) {
    return unfoldOrderedPart(topology, kFactor, ordered);
  }

  return unfoldTreePart(topology, kFactor);
}

function unfoldOrderedPart(
  topology: SheetMetalTopology,
  kFactor: number,
  ordered: { flanges: OrderedFlange[]; bends: OrderedBend[] }
): UnfoldedPartContour | null {
  const supplements = complementFlangeSupplements(topology, ordered, kFactor);

  let cursorY = 0;
  const holes: Point2D[][] = [];
  const pieces: Point2D[][] = [];

  for (let index = 0; index < ordered.flanges.length; index += 1) {
    const item = ordered.flanges[index];
    const { flange } = item;
    const flipY = shouldFlipFlangeForUnfold(item);
    const flangeContour = translateContour(orientContour(flange, flipY, true), cursorY);
    debugUnfoldPlacement('flange', {
      orderIndex: index,
      flangeId: flange.id,
      cursorY: roundMm(cursorY, 1000),
      flipY,
      width: flange.width,
      length: flange.length,
      incomingBend: item.incomingBend ? { from: item.incomingBend.from, to: item.incomingBend.to, direction: item.incomingBend.direction } : null,
      outgoingBend: item.outgoingBend ? { from: item.outgoingBend.from, to: item.outgoingBend.to, direction: item.outgoingBend.direction } : null,
      bounds: boundsOf(flangeContour),
      contourPoints: flangeContour.length,
    });
    pieces.push(flangeContour);
    holes.push(...flange.holes.map((hole) => translateHole(orientHole(hole, flange.width, flipY, true), cursorY)));
    cursorY += flange.width;
    const supplement = supplements.get(flange.id) ?? 0;
    if (supplement > GEOMETRY_EPSILON) {
      pieces.push(rectangleContour(0, cursorY, flange.length, cursorY + supplement));
      cursorY += supplement;
    }

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
      debugUnfoldPlacement('bend-strip', {
        afterFlangeId: flange.id,
        toFlangeId: nextFlange?.flange.id ?? null,
        cursorY: roundMm(cursorY, 1000),
        bendHeight: roundMm(bendHeight, 1000),
        intervals,
      });
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
    Math.abs(area - expectedArea) / expectedArea > AREA_TOLERANCE
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

function unfoldTreePart(topology: SheetMetalTopology, kFactor: number): UnfoldedPartContour | null {
  const adjacency = buildTreeAdjacency(topology);
  if (!adjacency) {
    return null;
  }

  const root = selectTreeRoot(topology, adjacency);
  const rootTransform: Transform2D = {
    origin: { x: 0, y: 0 },
    xAxis: { x: 1, y: 0 },
    yAxis: { x: 0, y: 1 },
  };
  const byId = new Map(topology.flanges.map((flange) => [flange.id, flange]));
  const placed = new Map<number, PlacedFlange>();
  const pieces: Point2D[][] = [];
  const holes: Point2D[][] = [];
  const rootPlaced = placeFlange(root, rootTransform);
  placed.set(root.id, rootPlaced);
  pieces.push(rootPlaced.contour);
  holes.push(...root.holes.map((hole) => transformContour(hole, rootTransform)));
  debugUnfoldPlacement('tree-flange', {
    flangeId: root.id,
    parentId: null,
    width: root.width,
    length: root.length,
    normal: root.normal,
    bounds: boundsOf(rootPlaced.contour),
    transform: rootTransform,
  });

  const visited = new Set<number>([root.id]);
  const stack: Array<{ current: number; parent: number | null }> = [{ current: root.id, parent: null }];

  while (stack.length > 0) {
    const item = stack.pop()!;
    const parentPlaced = placed.get(item.current);
    if (!parentPlaced) {
      return null;
    }

    for (const edge of adjacency.get(item.current) ?? []) {
      if (edge.next === item.parent) {
        continue;
      }
      if (visited.has(edge.next)) {
        return null;
      }

      const child = byId.get(edge.next);
      if (!child) {
        return null;
      }

      const bendHeight = bendAllowance(edge.bend, topology.thickness, kFactor);
      const childTransform = placeChildFlange(parentPlaced, child, edge.bend, bendHeight);
      if (!childTransform) {
        return null;
      }

      const childPlaced = placeFlange(child, childTransform);
      const strip = bendStripPolygon(parentPlaced, childPlaced, edge.bend, bendHeight);
      if (!strip) {
        return null;
      }

      debugUnfoldPlacement('tree-flange', {
        flangeId: child.id,
        parentId: item.current,
        bend: {
          id: edge.bend.id,
          from: edge.bend.from,
          to: edge.bend.to,
          angleDeg: roundMm(edge.bend.angleRad * 180 / Math.PI, 1000),
          direction: edge.bend.direction,
        },
        width: child.width,
        length: child.length,
        normal: child.normal,
        bounds: boundsOf(childPlaced.contour),
        stripBounds: boundsOf(strip),
        transform: childTransform,
      });

      pieces.push(strip, childPlaced.contour);
      holes.push(...child.holes.map((hole) => transformContour(hole, childTransform)));
      placed.set(child.id, childPlaced);
      visited.add(child.id);
      stack.push({ current: child.id, parent: item.current });
    }
  }

  if (visited.size !== topology.flanges.length) {
    return null;
  }

  const stitched = stitchOuterContour(pieces);
  if (!stitched) {
    return null;
  }
  const normalized = normalizeUnfoldGeometry(stitched, holes);
  const contour = ensureClockwise(normalized.contour);
  const orientedHoles = normalized.holes.map(ensureCounterClockwise);
  const area = polygonNetArea(contour, orientedHoles);
  const expectedArea = topology.volume / topology.thickness;

  if (
    expectedArea > 0 &&
    Math.abs(area - expectedArea) / expectedArea > AREA_TOLERANCE
  ) {
    return null;
  }

  return {
    contour,
    holes: orientedHoles,
    thickness: topology.thickness,
    source: 'UNFOLDED_BREP',
    area,
    width: roundMm(normalized.width, 100),
    height: roundMm(normalized.height, 100),
    bendCount: topology.bends.length,
    kFactor,
    kFactorDefaulted: false,
  };
}

function selectTreeRoot(
  topology: SheetMetalTopology,
  adjacency: Map<number, Array<{ next: number; bend: SheetMetalBend }>>
): SheetMetalFlange {
  const byId = new Map(topology.flanges.map((flange) => [flange.id, flange]));
  const hasBranch = topology.flanges.some((flange) => (adjacency.get(flange.id)?.length ?? 0) > 2);
  if (hasBranch) {
    return topology.baseFace;
  }

  const endpoints = topology.flanges
    .filter((flange) => (adjacency.get(flange.id)?.length ?? 0) <= 1)
    .sort((left, right) => left.area - right.area);
  return endpoints[0] ?? topology.baseFace;
}

function buildTreeAdjacency(topology: SheetMetalTopology): Map<number, Array<{ next: number; bend: SheetMetalBend }>> | null {
  if (topology.flanges.length < 2 || topology.bends.length !== topology.flanges.length - 1) {
    return null;
  }

  const ids = new Set(topology.flanges.map((flange) => flange.id));
  const adjacency = new Map<number, Array<{ next: number; bend: SheetMetalBend }>>();
  for (const id of ids) {
    adjacency.set(id, []);
  }

  for (const bend of topology.bends) {
    if (!ids.has(bend.from) || !ids.has(bend.to)) {
      return null;
    }
    adjacency.get(bend.from)?.push({ next: bend.to, bend });
    adjacency.get(bend.to)?.push({ next: bend.from, bend });
  }

  const visited = new Set<number>();
  const stack = [topology.baseFace.id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (!visited.has(edge.next)) {
        stack.push(edge.next);
      }
    }
  }

  return visited.size === topology.flanges.length ? adjacency : null;
}

function placeFlange(flange: SheetMetalFlange, transform: Transform2D): PlacedFlange {
  return {
    flange,
    transform,
    contour: transformContour(orientContour(flange, false), transform),
  };
}

function placeChildFlange(
  parent: PlacedFlange,
  child: SheetMetalFlange,
  bend: SheetMetalBend,
  bendHeight: number
): Transform2D | null {
  const parentLine = bendLineOnFlange(parent.flange, bend);
  const parentBoundary = bendBoundaryOnFlange(parent.flange, bend);
  const childBoundary = bendBoundaryOnFlange(child, bend);
  const childLine = childBoundary ?? bendLineOnFlange(child, bend);
  if (!parentLine || !childLine) {
    return null;
  }

  const parentPlacementLine = parentBoundary ?? parentLine;
  const parentLinePoint = transformPoint(parent.transform, parentPlacementLine.point);
  const parentLineDirection = normalize2D(transformVector(parent.transform, parentPlacementLine.direction));
  if (length2D(parentLineDirection) <= GEOMETRY_EPSILON) {
    return null;
  }

  const parentCenter = boundsCenter(parent.contour);
  const parentSide = signedDistanceToLine(parentCenter, parentLinePoint, parentLineDirection);
  const stripNormal = normalize2D(scale2D(perpendicular2D(parentLineDirection), parentSide >= 0 ? -1 : 1));
  const childLinePoint = add2D(parentLinePoint, scale2D(stripNormal, bendHeight));
  const childLineDirection = normalize2D(childLine.direction);
  if (length2D(childLineDirection) <= GEOMETRY_EPSILON) {
    return null;
  }

  let best: { transform: Transform2D; score: number; boundsArea: number } | null = null;
  const attempts: Array<{ axisSign: number; perpSign: number; score: number; boundsArea: number; bounds: ReturnType<typeof boundsOf> }> = [];
  for (const axisSign of [1, -1]) {
    const targetAxis = scale2D(parentLineDirection, axisSign);
    for (const perpSign of [1, -1]) {
      const targetPerp = scale2D(perpendicular2D(targetAxis), perpSign);
      const transform = transformFromLineMapping(
        childLine.point,
        childLineDirection,
        childLinePoint,
        targetAxis,
        targetPerp
      );
      const contour = transformContour(orientContour(child, false), transform);
      const score = dot2D(subtract2D(boundsCenter(contour), childLinePoint), stripNormal);
      const candidateBounds = boundsOf(contour);
      const combinedBounds = boundsOf([...openContour(parent.contour), ...openContour(contour)]);
      const boundsArea = (combinedBounds.maxX - combinedBounds.minX) * (combinedBounds.maxY - combinedBounds.minY);
      attempts.push({ axisSign, perpSign, score: roundMm(score, 1000), boundsArea: roundMm(boundsArea, 1000), bounds: candidateBounds });
      if (
        score > GEOMETRY_EPSILON &&
        (!best ||
          boundsArea < best.boundsArea - GEOMETRY_EPSILON ||
          (Math.abs(boundsArea - best.boundsArea) <= GEOMETRY_EPSILON && score > best.score))
      ) {
        best = { transform, score, boundsArea };
      }
    }
  }

  debugUnfoldPlacement('place-child-attempts', {
    parentId: parent.flange.id,
    childId: child.id,
    bendId: bend.id,
    bendAngleDeg: roundMm(bend.angleRad * 180 / Math.PI, 1000),
    parentLinePoint,
    parentLineDirection,
    childLinePoint,
    stripNormal,
    attempts,
    selected: best ? { score: roundMm(best.score, 1000), boundsArea: roundMm(best.boundsArea, 1000) } : null,
  });

  return best?.transform ?? null;
}

function transformFromLineMapping(
  localPoint: Point2D,
  localDirection: Point2D,
  worldPoint: Point2D,
  worldDirection: Point2D,
  worldPerpendicular: Point2D
): Transform2D {
  const localPerpendicular = perpendicular2D(localDirection);
  const xAxis = add2D(
    scale2D(worldDirection, localDirection.x),
    scale2D(worldPerpendicular, localPerpendicular.x)
  );
  const yAxis = add2D(
    scale2D(worldDirection, localDirection.y),
    scale2D(worldPerpendicular, localPerpendicular.y)
  );
  const localPointVector = add2D(scale2D(xAxis, localPoint.x), scale2D(yAxis, localPoint.y));

  return {
    origin: subtract2D(worldPoint, localPointVector),
    xAxis,
    yAxis,
  };
}

function bendStripPolygon(
  parent: PlacedFlange,
  child: PlacedFlange,
  bend: SheetMetalBend,
  bendHeight: number
): Point2D[] | null {
  const parentLine = bendLineOnFlange(parent.flange, bend);
  const parentBoundary = bendBoundaryOnFlange(parent.flange, bend);
  const childBoundary = bendBoundaryOnFlange(child.flange, bend);
  if (!parentLine) {
    return null;
  }

  const parentPlacementLine = parentBoundary ?? parentLine;
  const childPlacementLine = childBoundary ?? bendLineOnFlange(child.flange, bend);
  if (!childPlacementLine) {
    return null;
  }

  const parentLinePoint = transformPoint(parent.transform, parentPlacementLine.point);
  const childLinePoint = transformPoint(child.transform, childPlacementLine.point);
  const axis = normalize2D(transformVector(parent.transform, parentPlacementLine.direction));
  if (length2D(axis) <= GEOMETRY_EPSILON) {
    return null;
  }

  const normalVector = subtract2D(childLinePoint, parentLinePoint);
  const normalLength = length2D(normalVector);
  const normal = normalLength > GEOMETRY_EPSILON
    ? scale2D(normalVector, 1 / normalLength)
    : perpendicular2D(axis);
  const axisInterval = bendAxisInterval(parent, bend, parentLinePoint, axis);
  const intervalSources = [
    ...(axisInterval ? [axisInterval] : []),
    ...intervalsOnLine(parent.contour, parentLinePoint, axis),
    ...intervalsOnLine(child.contour, childLinePoint, axis),
  ];
  const intervals = mergeIntervals(intervalSources);
  let min: number;
  let max: number;

  if (intervals.length > 0) {
    min = Math.min(...intervals.map((interval) => interval.min));
    max = Math.max(...intervals.map((interval) => interval.max));
  } else {
    const projections = [...openContour(parent.contour), ...openContour(child.contour)]
      .map((point) => dot2D(subtract2D(point, parentLinePoint), axis));
    min = Math.min(...projections);
    max = Math.max(...projections);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min <= GEOMETRY_EPSILON) {
    return null;
  }

  const actualHeight = normalLength > GEOMETRY_EPSILON ? normalLength : bendHeight;
  const a = add2D(parentLinePoint, scale2D(axis, min));
  const b = add2D(parentLinePoint, scale2D(axis, max));
  const c = add2D(b, scale2D(normal, actualHeight));
  const d = add2D(a, scale2D(normal, actualHeight));
  return closeContour([a, b, c, d]);
}

function bendAxisInterval(
  placed: PlacedFlange,
  bend: SheetMetalBend,
  linePoint: Point2D,
  lineDirection: Point2D
): Interval | null {
  if (!bend.axisStart || !bend.axisEnd) {
    return null;
  }

  const start = transformPoint(placed.transform, projectPointToFlange(placed.flange, bend.axisStart));
  const end = transformPoint(placed.transform, projectPointToFlange(placed.flange, bend.axisEnd));
  const min = Math.min(
    dot2D(subtract2D(start, linePoint), lineDirection),
    dot2D(subtract2D(end, linePoint), lineDirection)
  );
  const max = Math.max(
    dot2D(subtract2D(start, linePoint), lineDirection),
    dot2D(subtract2D(end, linePoint), lineDirection)
  );

  return max - min > GEOMETRY_EPSILON ? { min, max } : null;
}

function intervalsOnLine(contour: Point2D[], linePoint: Point2D, lineDirection: Point2D): Interval[] {
  const intervals: Interval[] = [];
  const open = openContour(contour);
  for (let index = 0; index < open.length; index += 1) {
    const a = open[index];
    const b = open[(index + 1) % open.length];
    if (
      Math.abs(signedDistanceToLine(a, linePoint, lineDirection)) > COLLINEAR_EPSILON ||
      Math.abs(signedDistanceToLine(b, linePoint, lineDirection)) > COLLINEAR_EPSILON
    ) {
      continue;
    }
    const start = dot2D(subtract2D(a, linePoint), lineDirection);
    const end = dot2D(subtract2D(b, linePoint), lineDirection);
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    if (max - min > GEOMETRY_EPSILON) {
      intervals.push({ min, max });
    }
  }

  return mergeIntervals(intervals);
}

function bendLineOnFlange(flange: SheetMetalFlange, bend: SheetMetalBend): BendLine2D | null {
  const direction = normalize2D({
    x: dot3D(bend.axis, flange.uAxis),
    y: dot3D(bend.axis, flange.vAxis),
  });

  if (length2D(direction) <= GEOMETRY_EPSILON) {
    return null;
  }

  return {
    point: projectPointToFlange(flange, bend.axisLocation),
    direction,
  };
}

function bendBoundaryOnFlange(flange: SheetMetalFlange, bend: SheetMetalBend): BendLine2D | null {
  const axisLine = bendLineOnFlange(flange, bend);
  if (!axisLine) {
    return null;
  }

  const contour = openContour(orientContour(flange, false));
  let best: { line: BendLine2D; score: number } | null = null;
  for (let index = 0; index < contour.length; index += 1) {
    const a = contour[index];
    const b = contour[(index + 1) % contour.length];
    const edge = subtract2D(b, a);
    const length = length2D(edge);
    if (length <= GEOMETRY_EPSILON) {
      continue;
    }

    const direction = normalize2D(edge);
    if (Math.abs(dot2D(direction, axisLine.direction)) < PARALLEL_DOT_TOLERANCE) {
      continue;
    }

    const score = (
      Math.abs(signedDistanceToLine(a, axisLine.point, axisLine.direction)) +
      Math.abs(signedDistanceToLine(b, axisLine.point, axisLine.direction))
    ) / 2;
    const directionAligned = dot2D(direction, axisLine.direction) >= 0;
    const orientedDirection = directionAligned ? direction : scale2D(direction, -1);
    const orientedPoint = directionAligned ? a : b;
    if (!best || score < best.score) {
      best = {
        line: {
          point: orientedPoint,
          direction: orientedDirection,
        },
        score,
      };
    }
  }

  return best?.line ?? axisLine;
}

function projectPointToFlange(flange: SheetMetalFlange, point: Vec3): Point2D {
  const delta = subtract3D(point, flange.localOrigin);
  return {
    x: dot3D(delta, flange.uAxis),
    y: dot3D(delta, flange.vAxis),
  };
}

function transformContour(contour: Point2D[], transform: Transform2D): Point2D[] {
  return closeContour(contour.map((point) => transformPoint(transform, point)));
}

function transformPoint(transform: Transform2D, point: Point2D): Point2D {
  return roundPoint(add2D(
    transform.origin,
    add2D(scale2D(transform.xAxis, point.x), scale2D(transform.yAxis, point.y))
  ));
}

function transformVector(transform: Transform2D, vector: Point2D): Point2D {
  return add2D(scale2D(transform.xAxis, vector.x), scale2D(transform.yAxis, vector.y));
}

function topologyBendsShareAxis(topology: SheetMetalTopology): boolean {
  if (topology.bends.length <= 1) {
    return true;
  }

  const first = normalize3D(topology.bends[0].axis);
  return topology.bends.every((bend) =>
    Math.abs(dot3D(first, normalize3D(bend.axis))) >= PARALLEL_DOT_TOLERANCE
  );
}

function orientContour(flange: SheetMetalFlange, flipY: boolean, snapBoundary = false): Point2D[] {
  const cleanedContour = cleanBacktrackingContour(flange.contour);
  const contour = cleanedContour.length >= 4
    ? cleanedContour
    : rectangleContour(0, 0, flange.length, flange.width);

  if (!flipY) {
    return closeContour(contour.map((point) => ({
      x: point.x,
      y: snapBoundary ? snapFlangeBoundaryY(point.y, flange.width) : point.y,
    })));
  }

  return closeContour(contour.map((point) => ({
    x: point.x,
    y: snapBoundary ? snapFlangeBoundaryY(flange.width - point.y, flange.width) : flange.width - point.y,
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
  const merged = mergeIntervals([...currentIntervals, ...nextIntervals]);
  if (merged.length > 0) {
    const min = Math.min(...merged.map((interval) => interval.min));
    const max = Math.max(...merged.map((interval) => interval.max));
    if (max - min > GEOMETRY_EPSILON) {
      return [{ min, max }];
    }
  }

  return [{ min: 0, max: Math.max(current.flange.length, next.flange.length) }];
}

function complementFlangeSupplements(
  topology: SheetMetalTopology,
  ordered: { flanges: OrderedFlange[]; bends: OrderedBend[] },
  kFactor: number
): Map<number, number> {
  if (!ordered.bends.some((item) => item.bend.usesComplementAngle)) {
    return new Map();
  }

  const baseArea = unfoldedPiecesArea(ordered, topology.thickness, kFactor);
  const expectedArea = topology.volume / topology.thickness;
  const deficit = expectedArea - baseArea;
  if (expectedArea <= 0 || deficit <= expectedArea * AREA_TOLERANCE) {
    return new Map();
  }

  const candidates = ordered.flanges.filter((item) =>
    item.incomingBend &&
    item.outgoingBend &&
    item.incomingBend.usesComplementAngle &&
    item.outgoingBend.usesComplementAngle &&
    item.incomingBend.direction !== item.outgoingBend.direction &&
    item.flange.length > GEOMETRY_EPSILON
  );
  if (candidates.length === 0) {
    return new Map();
  }

  const totalLength = candidates.reduce((sum, item) => sum + item.flange.length, 0);
  if (totalLength <= GEOMETRY_EPSILON) {
    return new Map();
  }

  const supplements = new Map<number, number>();
  for (const item of candidates) {
    supplements.set(item.flange.id, roundMm(deficit / totalLength, 1000));
  }
  return supplements;
}

function unfoldedPiecesArea(
  ordered: { flanges: OrderedFlange[]; bends: OrderedBend[] },
  thickness: number,
  kFactor: number
): number {
  let area = 0;
  for (let index = 0; index < ordered.flanges.length; index += 1) {
    const item = ordered.flanges[index];
    const flipY = shouldFlipFlangeForUnfold(item);
    area += Math.abs(polygonArea(orientContour(item.flange, flipY, true)));

    const nextBend = ordered.bends.find((bendItem) => bendItem.afterFlangeId === item.flange.id);
    if (!nextBend) {
      continue;
    }

    const nextFlange = ordered.flanges[index + 1];
    const intervals = nextFlange
      ? bendStripIntervals(item, nextFlange, nextBend.bend)
      : [{ min: 0, max: item.flange.length }];
    const bendHeight = bendAllowance(nextBend.bend, thickness, kFactor);
    area += intervals.reduce((sum, interval) => sum + (interval.max - interval.min) * bendHeight, 0);
  }
  return area;
}

function bendSideIntervals(flange: SheetMetalFlange, bend: SheetMetalBend, flipY: boolean): Interval[] {
  const bendY = bendAxisYOnFlange(flange, bend);
  if (bendY === null) {
    return [{ min: 0, max: flange.length }];
  }

  const sideY = bendY < flange.width / 2 ? 0 : flange.width;
  const orientedY = flipY ? flange.width - sideY : sideY;
  const intervals = intervalsAtY(orientContour(flange, flipY, true), orientedY);

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
  if (process.env.UNFOLD_CONTOUR_DEBUG === '1') {
    console.error(`[unfold-contour-debug] stitch-loops: ${JSON.stringify(loops.map((loop) => ({
      points: loop.length,
      area: roundMm(polygonArea(loop), 1000),
      bounds: boundsOf(loop),
    })))}`);
  }
  const outer = loops
    .filter((loop) => loop.length >= 4)
    .sort((left, right) => polygonArea(right) - polygonArea(left))[0];

  if (!outer) {
    return null;
  }

  const stitched = closeContour(outer);
  const cleaned = removeCollinearPoints(stitched);
  if (process.env.UNFOLD_CONTOUR_DEBUG === '1') {
    debugContour('stitched-before-clean', stitched);
    debugContour('stitched-after-clean', cleaned);
  }
  return cleaned;
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
  let points: Point2D[] = [];
  for (const point of openContour(contour)) {
    const rounded = roundPoint(point);
    const previous = points[points.length - 1];
    if (!previous || !samePoint(previous, rounded)) {
      points.push(rounded);
    }
  }

  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) {
    points.pop();
  }

  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    const cleaned: Point2D[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index - 1 + points.length) % points.length];
      const current = points[index];
      const next = points[(index + 1) % points.length];
      if (isCollinearBoundaryPoint(previous, current, next)) {
        changed = true;
      } else {
        cleaned.push(current);
      }
    }

    points = cleaned;
  }

  return closeContour(points);
}

function debugContour(label: string, contour: Point2D[]): void {
  const points = openContour(contour);
  console.error(`[unfold-contour-debug] ${label} closed=${contour.length} open=${points.length}`);
  points.forEach((point, index) => {
    console.error(`[unfold-contour-debug] ${label}[${index}] x=${point.x.toFixed(6)} y=${point.y.toFixed(6)}`);
  });
}

function debugUnfoldPlacement(label: string, details: unknown): void {
  if (process.env.UNFOLD_CONTOUR_DEBUG !== '1') {
    return;
  }
  console.error(`[unfold-contour-debug] ${label}: ${JSON.stringify(details)}`);
}

function isCollinearBoundaryPoint(previous: Point2D, current: Point2D, next: Point2D): boolean {
  const prevLength = distance(previous, current);
  const nextLength = distance(current, next);
  const chordLength = distance(previous, next);
  if (
    prevLength <= GEOMETRY_EPSILON ||
    nextLength <= GEOMETRY_EPSILON ||
    chordLength <= GEOMETRY_EPSILON
  ) {
    return true;
  }

  const a = { x: current.x - previous.x, y: current.y - previous.y };
  const b = { x: next.x - current.x, y: next.y - current.y };
  const dot = (a.x * b.x + a.y * b.y) / (prevLength * nextLength);
  const angleDeviation = Math.acos(clamp(dot, -1, 1));
  if (angleDeviation < COLLINEAR_ANGLE_TOLERANCE_RAD) {
    return true;
  }

  return false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

  if (ordered.length !== topology.flanges.length) {
    return null;
  }

  return { flanges: ordered, bends: orderedBends };
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

function boundsCenter(points: Point2D[]): Point2D {
  const bounds = boundsOf(points);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function signedDistanceToLine(point: Point2D, linePoint: Point2D, lineDirection: Point2D): number {
  return cross2D(lineDirection, subtract2D(point, linePoint));
}

function bendAllowance(bend: SheetMetalBend, thickness: number, kFactor: number): number {
  return bend.angleRad * (bend.innerRadius + kFactor * thickness);
}

function orientHole(hole: Point2D[], flangeWidth: number, flipY: boolean, snapBoundary = false): Point2D[] {
  if (!flipY) {
    return hole.map((point) => ({
      x: point.x,
      y: snapBoundary ? snapFlangeBoundaryY(point.y, flangeWidth) : point.y,
    }));
  }

  return hole.map((point) => ({
    x: point.x,
    y: snapBoundary ? snapFlangeBoundaryY(flangeWidth - point.y, flangeWidth) : flangeWidth - point.y,
  }));
}

function snapFlangeBoundaryY(value: number, flangeWidth: number): number {
  if (Math.abs(value) <= FLANGE_BOUNDARY_SNAP_TOLERANCE) {
    return 0;
  }
  if (Math.abs(value - flangeWidth) <= FLANGE_BOUNDARY_SNAP_TOLERANCE) {
    return flangeWidth;
  }
  return value;
}

function translateHole(hole: Point2D[], offsetY: number): Point2D[] {
  return hole.map((point) => ({
    x: roundMm(point.x, 1000),
    y: roundMm(point.y + offsetY, 1000),
  }));
}

function add2D(a: Point2D, b: Point2D): Point2D {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
  };
}

function subtract2D(a: Point2D, b: Point2D): Point2D {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  };
}

function scale2D(vector: Point2D, factor: number): Point2D {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
  };
}

function dot2D(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

function length2D(vector: Point2D): number {
  return Math.hypot(vector.x, vector.y);
}

function normalize2D(vector: Point2D): Point2D {
  const length = length2D(vector);
  return length <= GEOMETRY_EPSILON ? vector : scale2D(vector, 1 / length);
}

function perpendicular2D(vector: Point2D): Point2D {
  return {
    x: -vector.y,
    y: vector.x,
  };
}

function subtract3D(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function dot3D(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize3D(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length <= GEOMETRY_EPSILON
    ? vector
    : {
        x: vector.x / length,
        y: vector.y / length,
        z: vector.z / length,
      };
}

function roundMm(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}
