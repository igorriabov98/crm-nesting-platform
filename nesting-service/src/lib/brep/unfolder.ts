import {
  ensureClockwise,
  ensureCounterClockwise,
  polygonArea,
  polygonNetArea,
  type Point2D,
} from '../geometry';
import { intersection as polygonIntersection, union as polygonUnion, type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping';
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

export type UnfoldPartDetailedResult = {
  contour: UnfoldedPartContour | null;
  failureReason: string | null;
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

type UnfoldPieceDebug = {
  label: string;
  contour: Point2D[];
};

export type PolygonUnionResult = {
  contour: Point2D[] | null;
  holes: Point2D[][];
  failureReason: string | null;
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

type ChildFlangePlacementResult = {
  transform: Transform2D | null;
  failureReason: string | null;
};

type BendLine2D = {
  point: Point2D;
  direction: Point2D;
  start?: Point2D;
  end?: Point2D;
};

type Vec3 = SheetMetalFlange['normal'];
type BendDirection = SheetMetalBend['direction'];

const AREA_TOLERANCE = 0.02;
const GEOMETRY_EPSILON = 0.001;
const COLLINEAR_EPSILON = 0.01;
const COLLINEAR_ANGLE_TOLERANCE_RAD = (0.5 * Math.PI) / 180;
const FLANGE_BOUNDARY_SNAP_TOLERANCE = 0.01;
const ENDPOINT_CORRESPONDENCE_TOLERANCE = 0.5;
const COMPONENT_OVERLAP_TOLERANCE = 0.5;
const BEND_STRIP_UNION_OVERLAP = 0.001;
const POINT_KEY_PRECISION = 100;
const PARALLEL_DOT_TOLERANCE = 0.999;
const UNFOLD_VALIDATION_FAILURE_REASON = 'unfold validation failed (bend-zone cutout or area mismatch)';
const SEGMENT_INTERSECTION_EPSILON = 1e-6;

export function unfoldPart(topology: SheetMetalTopology, kFactor: number): UnfoldedPartContour | null {
  return unfoldPartDetailed(topology, kFactor).contour;
}

export function unfoldPartDetailed(topology: SheetMetalTopology, kFactor: number): UnfoldPartDetailedResult {
  const ordered = orderFlanges(topology);
  const shareAxis = topologyBendsShareAxis(topology);
  if (ordered && shareAxis) {
    return unfoldOrderedPart(topology, kFactor, ordered);
  }

  return unfoldTreePart(topology, kFactor);
}

/**
 * Shape invariant for the final cut contour: the outer loop must be a simple polygon.
 * Area and bbox can look plausible on a self-crossing outline, so this runs before area validation.
 * The same check remains after polygon-union as a guard against unexpected topology output.
 */
export function validateSimpleUnfoldContour(contour: Point2D[]): string | null {
  const intersection = findContourSelfIntersection(contour);
  if (!intersection) {
    return null;
  }

  return `self-intersecting unfold contour: edges [${intersection.edgeA},${intersection.edgeB}] at (${intersection.point.x.toFixed(3)},${intersection.point.y.toFixed(3)})`;
}

export function findContourSelfIntersection(contour: Point2D[]): {
  edgeA: number;
  edgeB: number;
  point: Point2D;
} | null {
  const points = openContour(contour);
  if (points.length < 4) {
    return null;
  }

  const edgeCount = points.length;
  for (let left = 0; left < edgeCount; left += 1) {
    const a = points[left];
    const b = points[(left + 1) % edgeCount];
    for (let right = left + 1; right < edgeCount; right += 1) {
      const isAdjacent = right === left + 1 || (left === 0 && right === edgeCount - 1);
      if (isAdjacent) {
        continue;
      }

      const c = points[right];
      const d = points[(right + 1) % edgeCount];
      const point = segmentIntersectionPoint(a, b, c, d);
      if (point) {
        return {
          edgeA: left,
          edgeB: right,
          point: roundPoint(point),
        };
      }
    }
  }

  return null;
}

function acceptUnfold(contour: UnfoldedPartContour): UnfoldPartDetailedResult {
  return { contour, failureReason: null };
}

function rejectUnfold(failureReason = UNFOLD_VALIDATION_FAILURE_REASON): UnfoldPartDetailedResult {
  return { contour: null, failureReason };
}

function unfoldOrderedPart(
  topology: SheetMetalTopology,
  kFactor: number,
  ordered: { flanges: OrderedFlange[]; bends: OrderedBend[] }
): UnfoldPartDetailedResult {
  const supplements = complementFlangeSupplements(topology, ordered, kFactor);

  let cursorY = 0;
  const holes: Point2D[][] = [];
  const pieces: Point2D[][] = [];
  const pieceDebug: UnfoldPieceDebug[] = [];

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
    pieceDebug.push({ label: `flange:${flange.id}`, contour: flangeContour });
    holes.push(...flange.holes.map((hole) => translateHole(orientHole(hole, flange.width, flipY, true), cursorY)));
    cursorY += flange.width;
    const supplement = supplements.get(flange.id) ?? 0;
    if (supplement > GEOMETRY_EPSILON) {
      const supplementContour = rectangleContour(0, cursorY, flange.length, cursorY + supplement);
      pieces.push(supplementContour);
      pieceDebug.push({ label: `supplement:${flange.id}`, contour: supplementContour });
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
        const stripContour = rectangleContour(interval.min, cursorY, interval.max, cursorY + bendHeight);
        pieces.push(stripContour);
        pieceDebug.push({ label: `bend-strip:${nextBend.bend.id}:${flange.id}->${nextFlange?.flange.id ?? 'n/a'}`, contour: stripContour });
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

  debugUnfoldPieces('ordered-pieces-before-union', pieceDebug);
  const unioned = unionUnfoldPolygons(pieces);
  if (!unioned.contour) {
    return rejectUnfold(unioned.failureReason ?? UNFOLD_VALIDATION_FAILURE_REASON);
  }
  const normalized = normalizeUnfoldGeometry(unioned.contour, [...holes, ...unioned.holes]);
  const width = roundMm(normalized.width, 100);
  const height = roundMm(normalized.height, 100);
  const contour = ensureClockwise(normalized.contour);
  const orientedHoles = normalized.holes.map(ensureCounterClockwise);
  const contourFailure = validateSimpleUnfoldContour(contour);
  if (contourFailure) {
    return rejectUnfold(contourFailure);
  }
  // Shape invariant: validate the final union contour that will be cut into DXF,
  // not the pre-union material-piece sum or bbox. Otherwise overlapped flanges
  // can hide a bad shape behind plausible material dimensions.
  const area = polygonNetArea(contour, orientedHoles);
  const expectedArea = topology.volume / topology.thickness;

  if (
    expectedArea > 0 &&
    Math.abs(area - expectedArea) / expectedArea > AREA_TOLERANCE
  ) {
    return rejectUnfold();
  }

  return acceptUnfold({
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
  });
}

function unfoldTreePart(topology: SheetMetalTopology, kFactor: number): UnfoldPartDetailedResult {
  const adjacency = buildTreeAdjacency(topology);
  if (!adjacency) {
    return rejectUnfold();
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
  const pieceDebug: UnfoldPieceDebug[] = [];
  const holes: Point2D[][] = [];
  const rootPlaced = placeFlange(root, rootTransform);
  placed.set(root.id, rootPlaced);
  pieces.push(rootPlaced.contour);
  pieceDebug.push({ label: `flange:${root.id}`, contour: rootPlaced.contour });
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
      return rejectUnfold();
    }

    for (const edge of adjacency.get(item.current) ?? []) {
      if (edge.next === item.parent) {
        continue;
      }
      if (visited.has(edge.next)) {
        return rejectUnfold();
      }

      const child = byId.get(edge.next);
      if (!child) {
        return rejectUnfold();
      }

      const bendHeight = bendAllowance(edge.bend, topology.thickness, kFactor);
      const childIsLeaf = (adjacency.get(child.id)?.length ?? 0) <= 1;
      const existingFlangeContours = [...placed.values()].map((placedFlange) => placedFlange.contour);
      const childPlacement = placeChildFlange(parentPlaced, child, edge.bend, bendHeight, childIsLeaf, existingFlangeContours);
      if (!childPlacement.transform) {
        return rejectUnfold(childPlacement.failureReason ?? UNFOLD_VALIDATION_FAILURE_REASON);
      }

      const childTransform = childPlacement.transform;
      const childPlaced = placeFlange(child, childTransform);
      const strip = bendStripPolygon(parentPlaced, childPlaced, edge.bend, bendHeight);
      if (!strip) {
        return rejectUnfold();
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
      pieceDebug.push({ label: `bend-strip:${edge.bend.id}:${item.current}->${child.id}`, contour: strip });
      pieceDebug.push({ label: `flange:${child.id}`, contour: childPlaced.contour });
      holes.push(...child.holes.map((hole) => transformContour(hole, childTransform)));
      placed.set(child.id, childPlaced);
      visited.add(child.id);
      stack.push({ current: child.id, parent: item.current });
    }
  }

  if (visited.size !== topology.flanges.length) {
    return rejectUnfold();
  }

  debugUnfoldPieces('tree-pieces-before-union', pieceDebug);
  const unioned = unionUnfoldPolygons(pieces);
  if (!unioned.contour) {
    return rejectUnfold(unioned.failureReason ?? UNFOLD_VALIDATION_FAILURE_REASON);
  }
  const normalized = normalizeUnfoldGeometry(unioned.contour, [...holes, ...unioned.holes]);
  const contour = ensureClockwise(normalized.contour);
  const orientedHoles = normalized.holes.map(ensureCounterClockwise);
  const contourFailure = validateSimpleUnfoldContour(contour);
  if (contourFailure) {
    return rejectUnfold(contourFailure);
  }
  // Shape invariant: validate the final union contour that will be cut into DXF,
  // not the pre-union material-piece sum or bbox. Otherwise overlapped flanges
  // can hide a bad shape behind plausible material dimensions.
  const area = polygonNetArea(contour, orientedHoles);
  const expectedArea = topology.volume / topology.thickness;

  if (
    expectedArea > 0 &&
    Math.abs(area - expectedArea) / expectedArea > AREA_TOLERANCE
  ) {
    return rejectUnfold();
  }

  return acceptUnfold({
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
  });
}

function selectTreeRoot(
  topology: SheetMetalTopology,
  adjacency: Map<number, Array<{ next: number; bend: SheetMetalBend }>>
): SheetMetalFlange {
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

/**
 * Place a child flange by physical bend facts, not compactness heuristics.
 * perpSign follows bend direction relative to the parent flange; axisSign follows endpoint correspondence of the shared bend line.
 * boundsArea is only a diagnostic/tie-breaker when geometry is genuinely ambiguous, and overlap candidates are rejected.
 */
function placeChildFlange(
  parent: PlacedFlange,
  child: SheetMetalFlange,
  bend: SheetMetalBend,
  bendHeight: number,
  childIsLeaf: boolean,
  existingFlangeContours: Point2D[][]
): ChildFlangePlacementResult {
  const parentLine = bendLineOnFlange(parent.flange, bend);
  const parentBoundary = bendBoundaryOnFlange(parent.flange, bend);
  const childBoundary = bendBoundaryOnFlange(child, bend);
  const childLine = childBoundary ?? bendLineOnFlange(child, bend);
  if (!parentLine || !childLine) {
    return rejectChildPlacement(`unable to place child flange: bend ${bend.id} has no shared bend line`);
  }

  const parentPlacementLine = parentBoundary ?? parentLine;
  const parentLinePoint = transformPoint(parent.transform, parentPlacementLine.point);
  const parentLineDirection = normalize2D(transformVector(parent.transform, parentPlacementLine.direction));
  if (length2D(parentLineDirection) <= GEOMETRY_EPSILON) {
    return rejectChildPlacement(`unable to place child flange: bend ${bend.id} parent line is degenerate`);
  }

  const parentCenter = boundsCenter(parent.contour);
  const parentSide = signedDistanceToLine(parentCenter, parentLinePoint, parentLineDirection);
  const stripNormal = normalize2D(scale2D(perpendicular2D(parentLineDirection), parentSide >= 0 ? -1 : 1));
  const childLinePoint = add2D(parentLinePoint, scale2D(stripNormal, bendHeight));
  const childLineDirection = normalize2D(childLine.direction);
  if (length2D(childLineDirection) <= GEOMETRY_EPSILON) {
    return rejectChildPlacement(`unable to place child flange: bend ${bend.id} child line is degenerate`);
  }

  const placementDirection = bendDirectionForPlacement(parent.flange, child, bend, childIsLeaf);
  if (!placementDirection) {
    return rejectChildPlacement(`unable to place child flange: bend ${bend.id} is not connected to parent flange ${parent.flange.id}`);
  }

  let best: { transform: Transform2D; score: number; directionScore: number; boundsArea: number; endpointError: number; axisSign: number; perpSign: number; directionOverride: boolean } | null = null;
  const requiredScoreSign = placementDirection === 'up' ? 1 : -1;
  const attempts: Array<{
    axisSign: number;
    perpSign: number;
    score: number;
    directionScore: number;
    endpointError: number | null;
    reverseEndpointError: number | null;
    parentOverlapArea: number;
    existingOverlapArea: number;
    directionSatisfied: boolean;
    overlapFree: boolean;
    eligible: boolean;
    boundsArea: number;
    bounds: ReturnType<typeof boundsOf>;
  }> = [];
  const candidates: Array<{ transform: Transform2D; score: number; directionScore: number; boundsArea: number; endpointError: number; existingOverlapArea: number; directionSatisfied: boolean; axisSign: number; perpSign: number }> = [];
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
      const directionScore = score * requiredScoreSign;
      const candidateBounds = boundsOf(contour);
      const combinedBounds = boundsOf([...openContour(parent.contour), ...openContour(contour)]);
      const boundsArea = (combinedBounds.maxX - combinedBounds.minX) * (combinedBounds.maxY - combinedBounds.minY);
      const parentOverlapArea = polygonOverlapArea(parent.contour, contour);
      const existingOverlapArea = existingFlangeContours.reduce((sum, existingContour) => sum + polygonOverlapArea(existingContour, contour), 0);
      const endpointCorrespondence = bendEndpointCorrespondenceError(
        parent.flange,
        parent.transform,
        parentPlacementLine,
        child,
        transform,
        childLine,
        bend,
        stripNormal,
        bendHeight
      );
      const directionSatisfied = directionScore > GEOMETRY_EPSILON;
      const overlapFree = existingOverlapArea <= COMPONENT_OVERLAP_TOLERANCE;
      const eligible = directionSatisfied && overlapFree;
      attempts.push({
        axisSign,
        perpSign,
        score: roundMm(score, 1000),
        directionScore: roundMm(directionScore, 1000),
        endpointError: endpointCorrespondence ? roundMm(endpointCorrespondence.forward, 1000) : null,
        reverseEndpointError: endpointCorrespondence ? roundMm(endpointCorrespondence.reverse, 1000) : null,
        parentOverlapArea: roundMm(parentOverlapArea, 1000),
        existingOverlapArea: roundMm(existingOverlapArea, 1000),
        directionSatisfied,
        overlapFree,
        eligible,
        boundsArea: roundMm(boundsArea, 1000),
        bounds: candidateBounds,
      });
      if (endpointCorrespondence) {
        candidates.push({
          transform,
          score,
          directionScore,
          boundsArea,
          endpointError: endpointCorrespondence.forward,
          existingOverlapArea,
          directionSatisfied,
          axisSign,
          perpSign,
        });
      }
    }
  }

  // axisSign is fixed by physical endpoint correspondence of the shared bend
  // edge, never by bbox compactness. boundsArea remains diagnostic/tie-breaker
  // only when physics is ambiguous, and component-overlap candidates are banned.
  const strictCandidates = candidates.filter((candidate) =>
    candidate.directionSatisfied && candidate.existingOverlapArea <= COMPONENT_OVERLAP_TOLERANCE
  );
  if (strictCandidates.length > 0) {
    strictCandidates.sort((left, right) => left.endpointError - right.endpointError);
    const [first, second] = strictCandidates;
    if (!second || second.endpointError - first.endpointError > ENDPOINT_CORRESPONDENCE_TOLERANCE) {
      best = { ...first, directionOverride: false };
    }
  } else {
    const overlapFreeCandidates = candidates.filter((candidate) =>
      candidate.existingOverlapArea <= COMPONENT_OVERLAP_TOLERANCE
    );
    overlapFreeCandidates.sort((left, right) => left.endpointError - right.endpointError);
    const [first, second] = overlapFreeCandidates;
    if (first && (!second || second.endpointError - first.endpointError > ENDPOINT_CORRESPONDENCE_TOLERANCE)) {
      best = { ...first, directionOverride: true };
    }
  }

  debugUnfoldPlacement('place-child-attempts', {
    parentId: parent.flange.id,
    childId: child.id,
    bendId: bend.id,
    bendAngleDeg: roundMm(bend.angleRad * 180 / Math.PI, 1000),
    bendDirection: bend.direction,
    placementDirection,
    childIsLeaf,
    requiredScoreSign,
    parentLinePoint,
    parentLineDirection,
    childLinePoint,
    stripNormal,
    attempts,
    selected: best
      ? {
          axisSign: best.axisSign,
          perpSign: best.perpSign,
          score: roundMm(best.score, 1000),
          directionScore: roundMm(best.directionScore, 1000),
          endpointError: roundMm(best.endpointError, 1000),
          directionOverride: best.directionOverride,
          boundsArea: roundMm(best.boundsArea, 1000),
        }
      : null,
  });

  if (candidates.length === 0) {
    return rejectChildPlacement(`unable to place child flange: bend ${bend.id} has no physical endpoint correspondence`);
  }

  if (!best) {
    return rejectChildPlacement(`unable to place child flange: bend ${bend.id} endpoint correspondence is ambiguous`);
  }

  return acceptChildPlacement(best.transform);
}

function bendDirectionForPlacement(
  parent: SheetMetalFlange,
  child: SheetMetalFlange,
  bend: SheetMetalBend,
  childIsLeaf = true
): BendDirection | null {
  if (bend.from === parent.id && bend.to === child.id) {
    if (bend.direction === 'down' && !childIsLeaf) {
      return 'up';
    }
    return bend.direction;
  }

  if (bend.to === parent.id && bend.from === child.id) {
    return 'up';
  }

  return null;
}

function acceptChildPlacement(transform: Transform2D): ChildFlangePlacementResult {
  return { transform, failureReason: null };
}

function rejectChildPlacement(failureReason: string): ChildFlangePlacementResult {
  return { transform: null, failureReason };
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

function bendEndpointCorrespondenceError(
  parentFlange: SheetMetalFlange,
  parentTransform: Transform2D,
  parentLine: BendLine2D,
  childFlange: SheetMetalFlange,
  childTransform: Transform2D,
  childLine: BendLine2D,
  bend: SheetMetalBend,
  stripNormal: Point2D,
  bendHeight: number
): { forward: number; reverse: number } | null {
  const boundaryOrder = bendBoundaryEndpointOrder(parentFlange, parentLine, childFlange, childLine);
  if (boundaryOrder && parentLine.start && parentLine.end && childLine.start && childLine.end) {
    const parentStart = transformPoint(parentTransform, parentLine.start);
    const parentEnd = transformPoint(parentTransform, parentLine.end);
    const childStart = transformPoint(childTransform, childLine.start);
    const childEnd = transformPoint(childTransform, childLine.end);
    const expectedChildStart = add2D(
      boundaryOrder === 'forward' ? parentStart : parentEnd,
      scale2D(stripNormal, bendHeight)
    );
    const expectedChildEnd = add2D(
      boundaryOrder === 'forward' ? parentEnd : parentStart,
      scale2D(stripNormal, bendHeight)
    );

    return {
      forward: distance(childStart, expectedChildStart) + distance(childEnd, expectedChildEnd),
      reverse: distance(childStart, expectedChildEnd) + distance(childEnd, expectedChildStart),
    };
  }

  if (!bend.axisStart || !bend.axisEnd) {
    return null;
  }

  const parentStart = bendEndpointOnLine(parentFlange, parentTransform, parentLine, bend.axisStart);
  const parentEnd = bendEndpointOnLine(parentFlange, parentTransform, parentLine, bend.axisEnd);
  const childStart = bendEndpointOnLine(childFlange, childTransform, childLine, bend.axisStart);
  const childEnd = bendEndpointOnLine(childFlange, childTransform, childLine, bend.axisEnd);
  const expectedChildStart = add2D(parentStart, scale2D(stripNormal, bendHeight));
  const expectedChildEnd = add2D(parentEnd, scale2D(stripNormal, bendHeight));

  return {
    forward: distance(childStart, expectedChildStart) + distance(childEnd, expectedChildEnd),
    reverse: distance(childStart, expectedChildEnd) + distance(childEnd, expectedChildStart),
  };
}

function bendBoundaryEndpointOrder(
  parentFlange: SheetMetalFlange,
  parentLine: BendLine2D,
  childFlange: SheetMetalFlange,
  childLine: BendLine2D
): 'forward' | 'reverse' | null {
  if (!parentLine.start || !parentLine.end || !childLine.start || !childLine.end) {
    return null;
  }

  const parentStart = localPointTo3D(parentFlange, parentLine.start);
  const parentEnd = localPointTo3D(parentFlange, parentLine.end);
  const childStart = localPointTo3D(childFlange, childLine.start);
  const childEnd = localPointTo3D(childFlange, childLine.end);
  const forward = distance3D(parentStart, childStart) + distance3D(parentEnd, childEnd);
  const reverse = distance3D(parentStart, childEnd) + distance3D(parentEnd, childStart);
  if (Math.abs(forward - reverse) <= ENDPOINT_CORRESPONDENCE_TOLERANCE) {
    return null;
  }

  return forward < reverse ? 'forward' : 'reverse';
}

function bendEndpointOnLine(
  flange: SheetMetalFlange,
  transform: Transform2D,
  line: BendLine2D,
  axisPoint: Vec3
): Point2D {
  const localPoint = projectPointToFlange(flange, axisPoint);
  const lineDirection = normalize2D(line.direction);
  const parameter = dot2D(subtract2D(localPoint, line.point), lineDirection);
  return transformPoint(transform, add2D(line.point, scale2D(lineDirection, parameter)));
}

function localPointTo3D(flange: SheetMetalFlange, point: Point2D): Vec3 {
  return {
    x: flange.localOrigin.x + flange.uAxis.x * point.x + flange.vAxis.x * point.y,
    y: flange.localOrigin.y + flange.uAxis.y * point.x + flange.vAxis.y * point.y,
    z: flange.localOrigin.z + flange.uAxis.z * point.x + flange.vAxis.z * point.y,
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
  const overlap = Math.min(BEND_STRIP_UNION_OVERLAP, actualHeight / 4);
  const a = add2D(add2D(parentLinePoint, scale2D(axis, min)), scale2D(normal, -overlap));
  const b = add2D(add2D(parentLinePoint, scale2D(axis, max)), scale2D(normal, -overlap));
  const c = add2D(b, scale2D(normal, actualHeight + overlap * 2));
  const d = add2D(a, scale2D(normal, actualHeight + overlap * 2));
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
          start: directionAligned ? a : b,
          end: directionAligned ? b : a,
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

export function unionUnfoldPolygons(polygons: Point2D[][]): PolygonUnionResult {
  const clippingPolygons = polygons
    .map(toClippingPolygon)
    .filter((polygon): polygon is Polygon => Boolean(polygon));
  if (clippingPolygons.length === 0) {
    return {
      contour: null,
      holes: [],
      failureReason: 'unfold polygon union failed: no valid input polygons',
    };
  }

  let unioned: MultiPolygon;
  try {
    unioned = polygonUnion(clippingPolygons[0], ...clippingPolygons.slice(1));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      contour: null,
      holes: [],
      failureReason: `unfold polygon union failed: ${message}`,
    };
  }

  if (process.env.UNFOLD_CONTOUR_DEBUG === '1') {
    console.error(`[unfold-contour-debug] polygon-union: ${JSON.stringify(unioned.map((polygon) => ({
      rings: polygon.length,
      outerPoints: polygon[0]?.length ?? 0,
      area: polygon[0] ? roundMm(Math.abs(polygonArea(pointsFromRing(polygon[0]))), 1000) : 0,
      bounds: polygon[0] ? boundsOf(pointsFromRing(polygon[0])) : null,
    })))}`);
  }

  if (unioned.length !== 1) {
    return {
      contour: null,
      holes: [],
      failureReason: `unfold polygon union returned ${unioned.length} disconnected polygons`,
    };
  }

  const [outerRing, ...holeRings] = unioned[0];
  if (!outerRing) {
    return {
      contour: null,
      holes: [],
      failureReason: 'unfold polygon union returned no outer contour',
    };
  }

  const contour = removeCollinearPoints(pointsFromRing(outerRing));
  const holes = holeRings
    .map(pointsFromRing)
    .map(removeCollinearPoints)
    .filter((hole) => openContour(hole).length >= 3);

  if (openContour(contour).length < 3) {
    return {
      contour: null,
      holes: [],
      failureReason: 'unfold polygon union returned degenerate outer contour',
    };
  }

  if (process.env.UNFOLD_CONTOUR_DEBUG === '1') {
    debugContour('union-outer-after-clean', contour);
    holes.forEach((hole, index) => debugContour(`union-hole-${index}-after-clean`, hole));
  }

  return {
    contour,
    holes,
    failureReason: null,
  };
}

function polygonOverlapArea(left: Point2D[], right: Point2D[]): number {
  const leftPolygon = toClippingPolygon(left);
  const rightPolygon = toClippingPolygon(right);
  if (!leftPolygon || !rightPolygon) {
    return 0;
  }

  let intersected: MultiPolygon;
  try {
    intersected = polygonIntersection(leftPolygon, rightPolygon);
  } catch {
    return Number.POSITIVE_INFINITY;
  }

  return clippingMultiPolygonArea(intersected);
}

function clippingMultiPolygonArea(multiPolygon: MultiPolygon): number {
  return multiPolygon.reduce((sum, polygon) => {
    const [outerRing, ...holeRings] = polygon;
    if (!outerRing) {
      return sum;
    }

    const outerArea = Math.abs(polygonArea(pointsFromRing(outerRing)));
    const holesArea = holeRings.reduce((holeSum, ring) => holeSum + Math.abs(polygonArea(pointsFromRing(ring))), 0);
    return sum + Math.max(0, outerArea - holesArea);
  }, 0);
}

function toClippingPolygon(contour: Point2D[]): Polygon | null {
  const ring = ringFromPoints(openContour(contour));
  if (!ring) {
    return null;
  }

  return [ring];
}

function ringFromPoints(points: Point2D[]): Ring | null {
  const ring: Ring = [];
  for (const point of points) {
    const rounded = roundPoint(point);
    const previous = ring[ring.length - 1];
    if (previous && samePoint({ x: previous[0], y: previous[1] }, rounded)) {
      continue;
    }
    ring.push([rounded.x, rounded.y]);
  }

  if (ring.length < 3) {
    return null;
  }

  const contour = closeContour(ring.map(([x, y]) => ({ x, y })));
  if (Math.abs(polygonArea(contour)) <= GEOMETRY_EPSILON) {
    return null;
  }

  return ring;
}

function pointsFromRing(ring: Ring): Point2D[] {
  return closeContour(ring.map(([x, y]) => ({ x, y })));
}

function stitchOuterContour(polygons: Point2D[][]): Point2D[] | null {
  const rawSegments = polygons.flatMap((polygon) => contourSegments(polygon));
  if (rawSegments.length === 0) {
    return null;
  }

  const splitSegments = splitIntersectingSegments(splitCollinearSegments(rawSegments));
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

function splitIntersectingSegments(segments: Segment[]): Segment[] {
  const result: Segment[] = [];

  for (const segment of segments) {
    const splits = [0, 1];
    for (const other of segments) {
      if (segment === other || sameLine(segment, other)) {
        continue;
      }

      const point = segmentIntersectionPoint(segment.a, segment.b, other.a, other.b);
      if (!point) {
        continue;
      }

      const t = segmentParameter(segment, point);
      if (t > GEOMETRY_EPSILON && t < 1 - GEOMETRY_EPSILON) {
        splits.push(t);
      }
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
  const nodes = new Map<string, { point: Point2D; neighbors: Set<string> }>();
  for (const segment of segments) {
    const aKey = pointKey(segment.a);
    const bKey = pointKey(segment.b);
    if (aKey === bKey) {
      continue;
    }

    if (!nodes.has(aKey)) nodes.set(aKey, { point: roundPoint(segment.a), neighbors: new Set() });
    if (!nodes.has(bKey)) nodes.set(bKey, { point: roundPoint(segment.b), neighbors: new Set() });
    nodes.get(aKey)?.neighbors.add(bKey);
    nodes.get(bKey)?.neighbors.add(aKey);
  }

  const directedEdges = new Set<string>();
  for (const [key, node] of nodes) {
    for (const neighbor of node.neighbors) {
      directedEdges.add(`${key}>${neighbor}`);
    }
  }

  const visited = new Set<string>();
  const loops: Point2D[][] = [];

  for (const edge of directedEdges) {
    if (visited.has(edge)) {
      continue;
    }

    const [start, second] = edge.split('>');
    const loopKeys = [start];
    let previous = start;
    let current = second;

    for (let steps = 0; steps <= directedEdges.size; steps += 1) {
      visited.add(`${previous}>${current}`);
      loopKeys.push(current);

      if (current === start) {
        break;
      }

      const next = nextBoundaryNeighbor(previous, current, nodes);
      if (!next) {
        break;
      }

      previous = current;
      current = next;
    }

    if (loopKeys.length >= 4 && loopKeys[loopKeys.length - 1] === start) {
      const loop = loopKeys.map((key) => nodes.get(key)?.point).filter((point): point is Point2D => Boolean(point));
      loops.push(closeContour(loop));
    }
  }

  return loops;
}

function nextBoundaryNeighbor(
  previousKey: string,
  currentKey: string,
  nodes: Map<string, { point: Point2D; neighbors: Set<string> }>
): string | null {
  const previous = nodes.get(previousKey)?.point;
  const current = nodes.get(currentKey)?.point;
  const currentNode = nodes.get(currentKey);
  if (!previous || !current || !currentNode) {
    return null;
  }

  const incomingAngle = Math.atan2(current.y - previous.y, current.x - previous.x);
  const candidates = [...currentNode.neighbors].filter((neighbor) => neighbor !== previousKey);
  if (candidates.length === 0) {
    return previousKey;
  }

  return candidates
    .map((neighbor) => {
      const point = nodes.get(neighbor)?.point;
      if (!point) {
        return null;
      }

      const outgoingAngle = Math.atan2(point.y - current.y, point.x - current.x);
      return {
        neighbor,
        turn: normalizeAngle(outgoingAngle - incomingAngle),
      };
    })
    .filter((item): item is { neighbor: string; turn: number } => Boolean(item))
    .sort((left, right) => left.turn - right.turn)[0]?.neighbor ?? null;
}

function normalizeAngle(value: number): number {
  const twoPi = 2 * Math.PI;
  return ((value % twoPi) + twoPi) % twoPi;
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

function debugUnfoldPieces(label: string, pieces: UnfoldPieceDebug[]): void {
  if (process.env.UNFOLD_CONTOUR_DEBUG !== '1') {
    return;
  }

  console.error(`[unfold-contour-debug] ${label}: ${JSON.stringify(pieces.map((piece, index) => ({
    index,
    label: piece.label,
    area: roundMm(Math.abs(polygonArea(piece.contour)), 1000),
    signedArea: roundMm(polygonArea(piece.contour), 1000),
    bounds: boundsOf(piece.contour),
    points: openContour(piece.contour),
  })))}`);
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

function segmentIntersectionPoint(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const r = subtract2D(b, a);
  const s = subtract2D(d, c);
  const denominator = cross2D(r, s);
  const delta = subtract2D(c, a);

  if (Math.abs(denominator) <= SEGMENT_INTERSECTION_EPSILON) {
    if (Math.abs(cross2D(delta, r)) > SEGMENT_INTERSECTION_EPSILON) {
      return null;
    }

    const rLengthSquared = dot2D(r, r);
    if (rLengthSquared <= SEGMENT_INTERSECTION_EPSILON) {
      return null;
    }

    const start = dot2D(delta, r) / rLengthSquared;
    const end = dot2D(subtract2D(d, a), r) / rLengthSquared;
    const overlapStart = Math.max(0, Math.min(start, end));
    const overlapEnd = Math.min(1, Math.max(start, end));
    if (overlapEnd < overlapStart - SEGMENT_INTERSECTION_EPSILON) {
      return null;
    }

    return add2D(a, scale2D(r, clamp((overlapStart + overlapEnd) / 2, 0, 1)));
  }

  const t = cross2D(delta, s) / denominator;
  const u = cross2D(delta, r) / denominator;
  if (
    t < -SEGMENT_INTERSECTION_EPSILON ||
    t > 1 + SEGMENT_INTERSECTION_EPSILON ||
    u < -SEGMENT_INTERSECTION_EPSILON ||
    u > 1 + SEGMENT_INTERSECTION_EPSILON
  ) {
    return null;
  }

  return add2D(a, scale2D(r, clamp(t, 0, 1)));
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

function distance3D(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
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
