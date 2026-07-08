import type {
  Bnd_Box,
  BRepAdaptor_Curve,
  BRepAdaptor_Surface,
  BRepTools_WireExplorer,
  GCPnts_TangentialDeflection,
  GProp_GProps,
  gp_Ax1,
  gp_Ax3,
  gp_Cylinder,
  gp_Dir,
  gp_Pln,
  gp_Pnt,
  OpenCascadeInstance,
  TopExp_Explorer,
  TopoDS_Edge,
  TopoDS_Face,
  TopoDS_Shape,
  TopoDS_Wire,
} from 'opencascade.js/dist/node';
import { polygonArea, type Point2D } from '../geometry';
import type { Vec3 } from './brep-reader';

export type BendDirection = 'up' | 'down';

export type SheetMetalFlange = {
  id: number;
  area: number;
  normal: Vec3;
  origin: Vec3;
  localOrigin: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
  length: number;
  width: number;
  contour: Point2D[];
  holes: Point2D[][];
  sourceFaceIndices: [number, number];
};

export type SheetMetalBend = {
  id: number;
  from: number;
  to: number;
  innerRadius: number;
  angleRad: number;
  axis: Vec3;
  axisLocation: Vec3;
  axisStart?: Vec3;
  axisEnd?: Vec3;
  usesComplementAngle: boolean;
  direction: BendDirection;
};

export type SheetMetalTopology = {
  baseFace: SheetMetalFlange;
  flanges: SheetMetalFlange[];
  bends: SheetMetalBend[];
  thickness: number;
  volume: number;
  axis: Vec3;
};

export type SheetMetalTopologyInput = {
  oc: OpenCascadeInstance;
  shape: TopoDS_Shape;
  deadlineMs?: number;
  onReject?: (reason: string) => void;
};

type Deletable = {
  delete(): void;
};

type PlaneFrame = {
  origin: Vec3;
  normal: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
};

type PlanarFace = {
  index: number;
  face: TopoDS_Face;
  area: number;
  frame: PlaneFrame;
};

type CylindricalFace = {
  index: number;
  face: TopoDS_Face;
  area: number;
  radius: number;
  axisLocation: Vec3;
  axisDirection: Vec3;
  firstU: number;
  lastU: number;
  firstV: number;
  lastV: number;
  angleSpanRad: number;
  axisStart: Vec3;
  axisEnd: Vec3;
};

type FlangePair = {
  a: PlanarFace;
  b: PlanarFace;
  thickness: number;
};

type BendCandidate = {
  innerRadius: number;
  angleRad: number;
  usesComplementAngle: boolean;
  axisLocation: Vec3;
  axisDirection: Vec3;
  axisStart: Vec3;
  axisEnd: Vec3;
  innerCylinder: CylindricalFace;
  innerCylinders: CylindricalFace[];
  outerRadius: number;
};

type BendCylinderSet = {
  axis: Vec3;
  thickness: number;
  pairs: BendCylinderPair[];
};

type BendCylinderPair = {
  inner: CylindricalFace;
  outer: CylindricalFace;
  thickness: number;
  innerSegments: CylindricalFace[];
  outerSegments: CylindricalFace[];
};

const ANGULAR_DEFLECTION_RAD = 0.1;
const LINEAR_DEFLECTION_MM = 0.05;
const POINT_EPSILON_MM = 0.001;
const AXIS_TOLERANCE_MM = 0.05;
const PARALLEL_DOT_TOLERANCE = 0.999;
const MIN_THICKNESS_MM = 0.5;
const MAX_THICKNESS_MM = 50;
const THICKNESS_TOLERANCE = 0.05;
const MIN_FLANGE_WIDTH_FACTOR = 3;
const TANGENCY_TOLERANCE_MM = 0.35;
const BEND_ANGLE_TOLERANCE_RAD = 0.2;
const BEND_SECTOR_TOLERANCE_RAD = 0.02;
const MIN_INNER_RADIUS_MM = 0.25;
const MAX_BEND_RADIUS_TO_THICKNESS = 12;
const BEND_FRAGMENT_RADIUS_TOLERANCE_MM = 0.05;
const BEND_FRAGMENT_SECTOR_GAP_TOLERANCE_RAD = 0.02;
const BEND_TOPOLOGY_DEBUG = process.env.BEND_TOPOLOGY_DEBUG === '1';

export function detectSheetMetalTopology(input: SheetMetalTopologyInput): SheetMetalTopology | null {
  const planarFaces: PlanarFace[] = [];
  const cylindricalFaces: CylindricalFace[] = [];

  try {
    const faces = collectFaces(input);
    planarFaces.push(...faces.planar);
    cylindricalFaces.push(...faces.cylinders);
    debugTopology('faces', {
      planarCount: faces.planar.length,
      cylinderCount: faces.cylinders.length,
      planars: faces.planar.map((face) => ({
        index: face.index,
        area: roundMm(face.area, 1000),
        normal: formatVec3(face.frame.normal),
        origin: formatVec3(face.frame.origin),
      })),
      cylinders: faces.cylinders.map(summarizeCylinder),
    });

    if (faces.cylinders.length === 0 || faces.planar.length < 4) {
      debugTopology('reject', { reason: 'not enough cylinders or planar faces', planarCount: faces.planar.length, cylinderCount: faces.cylinders.length });
      return null;
    }

    const bendCylinderSet = selectBendCylinderSet(faces.cylinders);
    if (!bendCylinderSet) {
      debugTopology('reject', { reason: 'no selected bend cylinder set' });
      return null;
    }
    const { axis: bendAxis, thickness } = bendCylinderSet;
    const bendPairs = mergeFragmentedBendPairs(bendCylinderSet.pairs);
    const singleAxisTopology = allBendPairsParallel(bendPairs);
    debugTopology('selected-cylinder-set', {
      thickness,
      rawPairCount: bendCylinderSet.pairs.length,
      pairCount: bendPairs.length,
      singleAxisTopology,
      axis: formatVec3(bendAxis),
      rawPairs: bendCylinderSet.pairs.map(summarizePair),
      pairs: bendPairs.map(summarizePair),
    });

    const length = singleAxisTopology ? readShapeLengthAlongAxis(input.oc, input.shape, bendAxis) : 0;
    if (singleAxisTopology && length <= 0) {
      debugTopology('reject', { reason: 'non-positive shape length along bend axis', length });
      return null;
    }

    const facePairs = findFlangePairs(
      faces.planar,
      thickness,
      singleAxisTopology ? bendAxis : null,
      singleAxisTopology ? length : null,
      bendPairs
    );
    if (facePairs.length < 2) {
      debugTopology('reject', {
        reason: 'not enough flange face pairs',
        facePairCount: facePairs.length,
        thickness,
        length,
        singleAxisTopology,
        planarAreas: faces.planar.map((face) => ({ index: face.index, area: roundMm(face.area, 1000), normal: formatVec3(face.frame.normal) })),
      });
      return null;
    }

    const flanges = facePairs.map((pair, index) =>
      buildFlange(input, pair, index, singleAxisTopology ? bendAxis : null)
    );
    const bendCandidates = findBendCandidates(bendPairs, thickness);
    debugTopology('flanges-and-candidates', {
      flangeCount: flanges.length,
      flanges: flanges.map((flange) => ({
        id: flange.id,
        area: roundMm(flange.area, 1000),
        length: flange.length,
        width: flange.width,
        normal: formatVec3(flange.normal),
        sourceFaceIndices: flange.sourceFaceIndices,
        contourPoints: flange.contour.length,
      })),
      candidateCount: bendCandidates.length,
      candidates: bendCandidates.map((candidate) => ({
        innerIndex: candidate.innerCylinder.index,
        innerRadius: roundMm(candidate.innerRadius, 1000),
        outerRadius: roundMm(candidate.outerRadius, 1000),
        angleDeg: roundMm(toDegrees(candidate.angleRad), 1000),
        usesComplementAngle: candidate.usesComplementAngle,
        axis: formatVec3(candidate.axisDirection),
      })),
    });
    const facesByIndex = new Map(faces.planar.map((face) => [face.index, face]));
    const bends = connectBends(input.oc, bendCandidates, flanges, facesByIndex, thickness);
    debugTopology('connected-bends', {
      bendCount: bends.length,
      foundBendPairCount: bendPairs.length,
      expectedForTree: flanges.length - 1,
      bends: bends.map((bend) => ({
        id: bend.id,
        from: bend.from,
        to: bend.to,
        innerRadius: bend.innerRadius,
        angleDeg: roundMm(toDegrees(bend.angleRad), 1000),
        direction: bend.direction,
      })),
    });

    // Compare found bend pairs with connected bends, not with the derived tree size.
    // A mismatch means a real bend was lost while wiring flanges.
    // That is a review fallback, not a successful unfold.
    if (bends.length !== bendPairs.length) {
      return rejectTopology(input, `unconnected bend pairs: found=${bendPairs.length}, connected=${bends.length}`, {
        flangeCount: flanges.length,
        bendCount: bends.length,
      });
    }

    if (!isValidTree(flanges.length, bends)) {
      return rejectTopology(input, 'invalid bend tree', { flangeCount: flanges.length, bendCount: bends.length, expectedBends: flanges.length - 1 });
    }

    const volume = readShapeVolume(input.oc, input.shape);
    const baseFace = [...flanges].sort((a, b) => b.area - a.area)[0];
    const orientedBends = orientBendDirections(flanges, bends, baseFace.id);
    return {
      baseFace,
      flanges,
      bends: orientedBends,
      thickness,
      volume,
      axis: bendAxis,
    };
  } finally {
    for (const face of planarFaces) {
      safeDelete(face.face);
    }
    for (const face of cylindricalFaces) {
      safeDelete(face.face);
    }
  }
}

function rejectTopology(input: SheetMetalTopologyInput, reason: string, details: Record<string, unknown> = {}): null {
  debugTopology('reject', { reason, ...details });
  input.onReject?.(reason);
  return null;
}

function collectFaces(input: SheetMetalTopologyInput): { planar: PlanarFace[]; cylinders: CylindricalFace[] } {
  const { oc, shape } = input;
  const topAbs = oc.TopAbs_ShapeEnum as unknown as {
    TopAbs_FACE: Parameters<TopExp_Explorer['Init']>[1];
    TopAbs_SHAPE: Parameters<TopExp_Explorer['Init']>[2];
  };
  let explorer: TopExp_Explorer | null = null;
  const planar: PlanarFace[] = [];
  const cylinders: CylindricalFace[] = [];

  try {
    explorer = new oc.TopExp_Explorer_1();
    explorer.Init(shape, topAbs.TopAbs_FACE, topAbs.TopAbs_SHAPE);

    while (explorer.More()) {
      checkDeadline(input);
      let currentShape: TopoDS_Shape | null = null;
      let face: TopoDS_Face | null = null;
      let adaptor: BRepAdaptor_Surface | null = null;
      let props: GProp_GProps | null = null;

      try {
        currentShape = explorer.Current();
        face = oc.TopoDS.Face_1(currentShape);
        adaptor = new oc.BRepAdaptor_Surface_2(face, true);
        props = new oc.GProp_GProps_1();
        oc.BRepGProp.SurfaceProperties_1(face, props, false, false);

        if (adaptor.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
          planar.push({
            index: planar.length,
            face,
            area: props.Mass(),
            frame: readPlaneFrame(adaptor),
          });
          face = null;
        } else if (adaptor.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
          cylinders.push({
            index: cylinders.length,
            face,
            area: props.Mass(),
            ...readCylinder(adaptor),
          });
          face = null;
        }
      } finally {
        safeDelete(props);
        safeDelete(adaptor);
        safeDelete(face);
        safeDelete(currentShape);
      }

      explorer.Next();
    }
  } finally {
    safeDelete(explorer);
  }

  return { planar, cylinders };
}

function selectBendCylinderSet(cylinders: CylindricalFace[]): BendCylinderSet | null {
  const groups = groupCylindersByAxis(cylinders);
  const eligibleGroups: Array<{ group: CylindricalFace[]; pairs: BendCylinderPair[] }> = [];
  const candidates: number[] = [];

  for (const group of groups) {
    const pairs = findBendCylinderPairs(group);
    const paired = new Set(pairs.flatMap((pair) => [pair.inner.index, pair.outer.index]));
    debugTopology('axis-group', {
      cylinderCount: group.length,
      pairCount: pairs.length,
      singleCount: group.filter((cylinder) => !paired.has(cylinder.index)).length,
      axis: formatVec3(canonicalDirection(normalize(group[0].axisDirection))),
      cylinders: group.map(summarizeCylinder),
      pairs: pairs.map(summarizePair),
      singles: group.filter((cylinder) => !paired.has(cylinder.index)).map(summarizeCylinder),
    });
    if (pairs.length > 0) {
      candidates.push(...pairs.map((pair) => pair.thickness));
      eligibleGroups.push({ group, pairs });
    }
  }

  if (eligibleGroups.length === 0 || candidates.length === 0) {
    return null;
  }

  const eligiblePairs = eligibleGroups.flatMap((group) => group.pairs);
  if (eligiblePairs.length === 0) {
    return null;
  }

  candidates.sort((a, b) => a - b);
  const thickness = roundMm(candidates[Math.floor(candidates.length / 2)], 100);
  const selectedPairs = eligiblePairs.filter((pair) =>
    relativeDelta(pair.thickness, thickness) <= THICKNESS_TOLERANCE
  );
  debugTopology('selected-pairs', {
    candidateThicknesses: candidates.map((candidate) => roundMm(candidate, 1000)),
    selectedThickness: thickness,
    eligiblePairCount: eligiblePairs.length,
    selectedPairCount: selectedPairs.length,
    selectedPairs: selectedPairs.map(summarizePair),
  });
  if (selectedPairs.length === 0) {
    return null;
  }

  return {
    axis: canonicalDirection(normalize(selectedPairs[0].inner.axisDirection)),
    thickness,
    pairs: selectedPairs,
  };
}

function findFlangePairs(
  faces: PlanarFace[],
  thickness: number,
  bendAxis: Vec3 | null,
  length: number | null,
  bendPairs: BendCylinderPair[] = []
): FlangePair[] {
  const pairs: FlangePair[] = [];
  const used = new Set<number>();
  const maxArea = Math.max(...faces.map((face) => face.area), 0);
  const minBendAxisLength = bendPairs.length > 0
    ? Math.min(...bendPairs.map((pair) => vectorLength(subtract(pair.inner.axisStart, pair.inner.axisEnd))))
    : 0;
  // Short flanges are judged against the local adjacent bend-line length.
  // Using maxArea drops real short flanges; using zero admits CAD noise/facets.
  // The lower bound stays tied to thickness so micro-faces do not become flanges.
  const minArea = bendAxis && length
    ? length * thickness * MIN_FLANGE_WIDTH_FACTOR
    : Math.max(
        thickness * thickness * MIN_FLANGE_WIDTH_FACTOR,
        minBendAxisLength > 0 ? minBendAxisLength * thickness * MIN_FLANGE_WIDTH_FACTOR : maxArea * 0.01
      );
  const orderedFaces = [...faces].sort((a, b) => b.area - a.area);

  for (let i = 0; i < orderedFaces.length; i += 1) {
    const left = orderedFaces[i];
    if (
      used.has(left.index) ||
      left.area < minArea ||
      (bendAxis && Math.abs(dotProduct(left.frame.normal, bendAxis)) > 0.05)
    ) {
      continue;
    }

    let best: { pair: FlangePair; score: number } | null = null;
    for (let j = i + 1; j < orderedFaces.length; j += 1) {
      const right = orderedFaces[j];
      if (
        used.has(right.index) ||
        right.area < minArea ||
        (bendAxis && Math.abs(dotProduct(right.frame.normal, bendAxis)) > 0.05)
      ) {
        continue;
      }

      const dot = Math.abs(dotProduct(left.frame.normal, right.frame.normal));
      if (dot < PARALLEL_DOT_TOLERANCE) {
        continue;
      }

      const distance = Math.abs(dotProduct(subtract(right.frame.origin, left.frame.origin), left.frame.normal));
      if (relativeDelta(distance, thickness) > THICKNESS_TOLERANCE) {
        continue;
      }

      const areaDelta = relativeDelta(left.area, right.area);
      if (areaDelta > 0.1) {
        continue;
      }

      const score = areaDelta + Math.abs(distance - thickness);
      if (!best || score < best.score) {
        best = { pair: { a: left, b: right, thickness: distance }, score };
      }
    }

    if (best) {
      used.add(best.pair.a.index);
      used.add(best.pair.b.index);
      pairs.push(best.pair);
    }
  }

  return pairs;
}

function buildFlange(input: SheetMetalTopologyInput, pair: FlangePair, id: number, preferredAxis: Vec3 | null): SheetMetalFlange {
  const face = pair.a.area >= pair.b.area ? pair.a : pair.b;
  const normal = canonicalDirection(normalize(face.frame.normal));
  const uAxis = preferredAxis && Math.abs(dotProduct(preferredAxis, normal)) <= 0.05
    ? preferredAxis
    : canonicalDirection(normalize(face.frame.xAxis));
  const vAxis = canonicalDirection(normalize(crossProduct(uAxis, normal)));
  const frame = { origin: face.frame.origin, uAxis, vAxis };
  const loops = extractFaceLoops(input, face.face, frame);
  const contour = loops.contour ?? [];
  const allPoints = [contour, ...loops.holes].flat();
  const bounds = getBounds(allPoints.length ? allPoints : [{ x: 0, y: 0 }]);
  const normalizePoint = (point: Point2D): Point2D => ({
    x: roundMm(point.x - bounds.minX, 1000),
    y: roundMm(point.y - bounds.minY, 1000),
  });
  const normalizedContour = closeAndClean(contour.map(normalizePoint));
  const normalizedHoles = loops.holes.map((hole) => closeAndClean(hole.map(normalizePoint))).filter((hole) => hole.length >= 4);
  const normalizedBounds = getBounds(normalizedContour);

  return {
    id,
    area: Math.max(pair.a.area, pair.b.area),
    normal,
    origin: midpoint(pair.a.frame.origin, pair.b.frame.origin),
    localOrigin: add(add(face.frame.origin, scale(uAxis, bounds.minX)), scale(vAxis, bounds.minY)),
    uAxis,
    vAxis,
    length: roundMm(normalizedBounds.maxX - normalizedBounds.minX, 100),
    width: roundMm(normalizedBounds.maxY - normalizedBounds.minY, 100),
    contour: normalizedContour,
    holes: normalizedHoles,
    sourceFaceIndices: [pair.a.index, pair.b.index],
  };
}

function findBendCandidates(pairs: BendCylinderPair[], thickness: number): BendCandidate[] {
  const candidates: BendCandidate[] = [];

  for (const pair of pairs) {
    const innerRadius = pair.inner.radius;
    const outerRadius = pair.outer.radius;
    if (
      relativeDelta(outerRadius - innerRadius, thickness) > THICKNESS_TOLERANCE ||
      !isReasonableBendRadii(innerRadius, outerRadius, thickness)
    ) {
      continue;
    }

    const angle = normalizeBendAngleSpan(pair.inner.angleSpanRad);
    candidates.push({
      innerRadius,
      angleRad: angle.value,
      usesComplementAngle: angle.usesComplement,
      axisLocation: pair.inner.axisLocation,
      axisDirection: canonicalDirection(normalize(pair.inner.axisDirection)),
      axisStart: pair.inner.axisStart,
      axisEnd: pair.inner.axisEnd,
      innerCylinder: pair.inner,
      innerCylinders: pair.innerSegments,
      outerRadius,
    });
  }

  return candidates;
}

function mergeFragmentedBendPairs(pairs: BendCylinderPair[]): BendCylinderPair[] {
  const remaining = [...pairs];
  const merged: BendCylinderPair[] = [];

  while (remaining.length > 0) {
    let current = remaining.shift()!;
    let changed = true;

    while (changed) {
      changed = false;
      const nextIndex = remaining.findIndex((candidate) => canMergeBendPairFragments(current, candidate));
      if (nextIndex >= 0) {
        const [next] = remaining.splice(nextIndex, 1);
        current = mergeBendPairFragments(current, next);
        changed = true;
      }
    }

    merged.push(current);
  }

  debugTopology('merged-fragmented-pairs', {
    rawPairCount: pairs.length,
    mergedPairCount: merged.length,
    mergedPairs: merged.map(summarizePair),
  });
  return merged;
}

function canMergeBendPairFragments(left: BendCylinderPair, right: BendCylinderPair): boolean {
  return (
    sameAxis(left.inner, right.inner) &&
    Math.abs(left.inner.radius - right.inner.radius) <= BEND_FRAGMENT_RADIUS_TOLERANCE_MM &&
    Math.abs(left.outer.radius - right.outer.radius) <= BEND_FRAGMENT_RADIUS_TOLERANCE_MM &&
    relativeDelta(left.thickness, right.thickness) <= THICKNESS_TOLERANCE &&
    sameAngularDirection(left.inner, right.inner) &&
    sectorsAreAdjacent(left.inner, right.inner) &&
    sectorsAreAdjacent(left.outer, right.outer)
  );
}

function mergeBendPairFragments(left: BendCylinderPair, right: BendCylinderPair): BendCylinderPair {
  const innerSegments = [...left.innerSegments, ...right.innerSegments].sort(compareCylinderSectors);
  const outerSegments = [...left.outerSegments, ...right.outerSegments].sort(compareCylinderSectors);
  const inner = mergeCylinderFragments(innerSegments);
  const outer = mergeCylinderFragments(outerSegments);
  return {
    inner,
    outer,
    thickness: outer.radius - inner.radius,
    innerSegments,
    outerSegments,
  };
}

function mergeCylinderFragments(segments: CylindricalFace[]): CylindricalFace {
  const [first] = segments;
  const positive = segments.every((segment) => segment.lastU >= segment.firstU);
  const totalSpan = segments.reduce((sum, segment) => sum + Math.abs(segment.lastU - segment.firstU), 0);
  return {
    ...first,
    area: segments.reduce((sum, segment) => sum + segment.area, 0),
    firstU: positive ? first.firstU : first.lastU,
    lastU: positive ? first.firstU + totalSpan : first.lastU - totalSpan,
    angleSpanRad: positive ? totalSpan : -totalSpan,
    firstV: Math.min(...segments.map((segment) => segment.firstV)),
    lastV: Math.max(...segments.map((segment) => segment.lastV)),
  };
}

function sameAngularDirection(left: CylindricalFace, right: CylindricalFace): boolean {
  return Math.sign(left.lastU - left.firstU) === Math.sign(right.lastU - right.firstU);
}

function sectorsAreAdjacent(left: CylindricalFace, right: CylindricalFace): boolean {
  if (angularSectorOverlap(left, right) > BEND_FRAGMENT_SECTOR_GAP_TOLERANCE_RAD) {
    return false;
  }
  const leftEndpoints = [normalizeAngle(left.firstU), normalizeAngle(left.lastU)];
  const rightEndpoints = [normalizeAngle(right.firstU), normalizeAngle(right.lastU)];
  return leftEndpoints.some((leftEndpoint) =>
    rightEndpoints.some((rightEndpoint) => angularDistance(leftEndpoint, rightEndpoint) <= BEND_FRAGMENT_SECTOR_GAP_TOLERANCE_RAD)
  );
}

function compareCylinderSectors(left: CylindricalFace, right: CylindricalFace): number {
  return normalizeAngle(left.firstU) - normalizeAngle(right.firstU);
}

function findBendCylinderPairs(group: CylindricalFace[]): BendCylinderPair[] {
  const pairs: BendCylinderPair[] = [];

  for (let left = 0; left < group.length; left += 1) {
    for (let right = left + 1; right < group.length; right += 1) {
      const a = group[left];
      const b = group[right];
      const inner = a.radius <= b.radius ? a : b;
      const outer = a.radius <= b.radius ? b : a;
      const thickness = outer.radius - inner.radius;

      if (
        thickness < MIN_THICKNESS_MM ||
        thickness > MAX_THICKNESS_MM ||
        !isReasonableBendRadii(inner.radius, outer.radius, thickness) ||
        !haveCompatibleBendSector(inner, outer)
      ) {
        continue;
      }

      pairs.push({
        inner,
        outer,
        thickness,
        innerSegments: [inner],
        outerSegments: [outer],
      });
    }
  }

  return pairs;
}

function allBendPairsParallel(pairs: BendCylinderPair[]): boolean {
  if (pairs.length <= 1) {
    return true;
  }

  const firstAxis = canonicalDirection(normalize(pairs[0].inner.axisDirection));
  return pairs.every((pair) =>
    Math.abs(dotProduct(firstAxis, canonicalDirection(normalize(pair.inner.axisDirection)))) >= PARALLEL_DOT_TOLERANCE
  );
}

function haveCompatibleBendSector(inner: CylindricalFace, outer: CylindricalFace): boolean {
  if (angularSectorOverlap(inner, outer) > BEND_SECTOR_TOLERANCE_RAD) {
    return true;
  }

  // OCCT commonly reports inner and outer faces of the same bend as complementary U ranges.
  // After the same-axis and dR checks, matching angular spans are the stable signal.
  return Math.abs(
    normalizeBendAngleSpan(inner.angleSpanRad).value -
    normalizeBendAngleSpan(outer.angleSpanRad).value
  ) <= BEND_SECTOR_TOLERANCE_RAD;
}

function connectBends(
  oc: OpenCascadeInstance,
  candidates: BendCandidate[],
  flanges: SheetMetalFlange[],
  facesByIndex: Map<number, PlanarFace>,
  thickness: number
): SheetMetalBend[] {
  const bends: SheetMetalBend[] = [];

  for (const candidate of candidates) {
    const radiusToCenter = candidate.innerRadius + thickness / 2;
    const tangentFlanges = flanges
      .map((flange) => ({
        flange,
        tangentError: Math.abs(distanceAxisToPlane(candidate.axisLocation, candidate.axisDirection, flange.origin, flange.normal) - radiusToCenter),
      }))
      .filter((item) => item.tangentError <= TANGENCY_TOLERANCE_MM);

    let best: { a: SheetMetalFlange; b: SheetMetalFlange; score: number } | null = null;
    const attempts: Array<{
      flanges: [number, number];
      angleDeg: number;
      angleErrorDeg: number;
      tangentErrors: [number, number];
      sharesEdges: boolean;
    }> = [];
    for (let i = 0; i < tangentFlanges.length; i += 1) {
      for (let j = i + 1; j < tangentFlanges.length; j += 1) {
        const a = tangentFlanges[i];
        const b = tangentFlanges[j];
        const angle = Math.acos(clamp(Math.abs(dotProduct(a.flange.normal, b.flange.normal)), -1, 1));
        const score = Math.abs(angle - candidate.angleRad) + a.tangentError + b.tangentError;
        const angleMatches = Math.abs(angle - candidate.angleRad) <= BEND_ANGLE_TOLERANCE_RAD;
        const sharesEdges = angleMatches
          ? cylinderConnectsFlanges(oc, candidate, a.flange, b.flange, facesByIndex)
          : false;
        attempts.push({
          flanges: [a.flange.id, b.flange.id],
          angleDeg: roundMm(toDegrees(angle), 1000),
          angleErrorDeg: roundMm(toDegrees(Math.abs(angle - candidate.angleRad)), 1000),
          tangentErrors: [roundMm(a.tangentError, 1000), roundMm(b.tangentError, 1000)],
          sharesEdges,
        });

        if (
          angleMatches &&
          sharesEdges &&
          (!best || score < best.score)
        ) {
          best = { a: a.flange, b: b.flange, score };
        }
      }
    }

    if (best && !bends.some((bend) => sameEdge(bend, best!.a.id, best!.b.id))) {
      const direction = dotProduct(crossProduct(best.a.normal, best.b.normal), candidate.axisDirection) >= 0 ? 'up' : 'down';
      bends.push({
        id: bends.length,
        from: best.a.id,
        to: best.b.id,
        innerRadius: roundMm(candidate.innerRadius, 100),
        angleRad: candidate.angleRad,
        axis: candidate.axisDirection,
        axisLocation: candidate.axisLocation,
        axisStart: candidate.axisStart,
        axisEnd: candidate.axisEnd,
        usesComplementAngle: candidate.usesComplementAngle,
        direction,
      });
    }
    debugTopology('connect-candidate', {
      innerIndex: candidate.innerCylinder.index,
      innerRadius: roundMm(candidate.innerRadius, 1000),
      outerRadius: roundMm(candidate.outerRadius, 1000),
      angleDeg: roundMm(toDegrees(candidate.angleRad), 1000),
      tangentFlangeCount: tangentFlanges.length,
      tangentFlanges: tangentFlanges.map((item) => ({ id: item.flange.id, tangentError: roundMm(item.tangentError, 1000) })),
      attempts,
      selected: best ? { from: best.a.id, to: best.b.id, score: roundMm(best.score, 1000) } : null,
      adjacentPlanarFaces: best
        ? undefined
        : findAdjacentPlanarFaces(oc, candidate, facesByIndex).map((face) => ({
            index: face.index,
            area: roundMm(face.area, 1000),
            normal: formatVec3(face.frame.normal),
          })),
    });
  }

  return bends;
}

function isReasonableBendRadii(innerRadius: number, outerRadius: number, thickness: number): boolean {
  if (innerRadius < MIN_INNER_RADIUS_MM || outerRadius <= innerRadius || thickness <= 0) {
    return false;
  }

  return innerRadius / thickness <= MAX_BEND_RADIUS_TO_THICKNESS;
}

function orientBendDirections(
  flanges: SheetMetalFlange[],
  bends: SheetMetalBend[],
  fallbackRootId: number
): SheetMetalBend[] {
  const byId = new Map(flanges.map((flange) => [flange.id, flange]));
  const adjacency = new Map<number, Array<{ next: number; bend: SheetMetalBend }>>();
  for (const flange of flanges) {
    adjacency.set(flange.id, []);
  }
  for (const bend of bends) {
    adjacency.get(bend.from)?.push({ next: bend.to, bend });
    adjacency.get(bend.to)?.push({ next: bend.from, bend });
  }

  const root = [...flanges].sort((left, right) => {
    const degreeDelta = (adjacency.get(right.id)?.length ?? 0) - (adjacency.get(left.id)?.length ?? 0);
    return degreeDelta || right.area - left.area || (left.id === fallbackRootId ? -1 : right.id === fallbackRootId ? 1 : left.id - right.id);
  })[0];
  if (!root) {
    return bends;
  }

  const oriented = new Map<number, SheetMetalBend>();
  const visited = new Set<number>([root.id]);
  const stack = [root.id];

  while (stack.length > 0) {
    const parentId = stack.pop()!;
    const parent = byId.get(parentId);
    if (!parent) {
      continue;
    }

    for (const edge of adjacency.get(parentId) ?? []) {
      if (visited.has(edge.next)) {
        continue;
      }

      const child = byId.get(edge.next);
      if (!child) {
        continue;
      }

      const direction = bendDirectionFromParent(parent, child, edge.bend);
      oriented.set(edge.bend.id, {
        ...edge.bend,
        from: parent.id,
        to: child.id,
        direction,
      });
      visited.add(child.id);
      stack.push(child.id);
    }
  }

  if (oriented.size !== bends.length) {
    return bends;
  }

  const result = bends.map((bend) => oriented.get(bend.id) ?? bend);
  const allSameSide = result.every((bend) => bend.direction === result[0]?.direction);
  const allOriginalSameDirection = bends.every((bend) => bend.direction === bends[0]?.direction);
  if (allSameSide && allOriginalSameDirection && bends[0]) {
    return result.map((bend) => ({
      ...bend,
      direction: bends[0].direction,
    }));
  }

  return result;
}

function bendDirectionFromParent(
  parent: SheetMetalFlange,
  child: SheetMetalFlange,
  bend: SheetMetalBend
): BendDirection {
  if (bend.usesComplementAngle) {
    const axisY = dotProduct(subtract(bend.axisLocation, parent.localOrigin), parent.vAxis);
    if (Number.isFinite(axisY) && parent.width > POINT_EPSILON_MM) {
      return axisY >= parent.width / 2 ? 'up' : 'down';
    }
  }

  const side = dotProduct(subtract(child.origin, parent.origin), parent.normal);
  return side >= 0 ? 'up' : 'down';
}

function cylinderConnectsFlanges(
  oc: OpenCascadeInstance,
  candidate: BendCandidate,
  a: SheetMetalFlange,
  b: SheetMetalFlange,
  facesByIndex: Map<number, PlanarFace>
): boolean {
  if (Math.abs(dotProduct(a.normal, b.normal)) >= PARALLEL_DOT_TOLERANCE) {
    return false;
  }

  return (
    candidate.innerCylinders.some((cylinder) => cylinderSharesEdgeWithFlange(oc, cylinder.face, a, facesByIndex)) &&
    candidate.innerCylinders.some((cylinder) => cylinderSharesEdgeWithFlange(oc, cylinder.face, b, facesByIndex))
  );
}

function findAdjacentPlanarFaces(
  oc: OpenCascadeInstance,
  candidate: BendCandidate,
  facesByIndex: Map<number, PlanarFace>
): PlanarFace[] {
  const adjacent: PlanarFace[] = [];
  for (const face of facesByIndex.values()) {
    if (candidate.innerCylinders.some((cylinder) => facesShareEdge(oc, cylinder.face, face.face))) {
      adjacent.push(face);
    }
  }
  return adjacent;
}

function cylinderSharesEdgeWithFlange(
  oc: OpenCascadeInstance,
  cylinderFace: TopoDS_Face,
  flange: SheetMetalFlange,
  facesByIndex: Map<number, PlanarFace>
): boolean {
  return flange.sourceFaceIndices.some((index) => {
    const face = facesByIndex.get(index);
    return face ? facesShareEdge(oc, cylinderFace, face.face) : false;
  });
}

function facesShareEdge(oc: OpenCascadeInstance, a: TopoDS_Face, b: TopoDS_Face): boolean {
  const aEdges = collectFaceEdges(oc, a);

  try {
    const bEdges = collectFaceEdges(oc, b);
    try {
      return aEdges.some((aEdge) => bEdges.some((bEdge) => aEdge.IsSame(bEdge)));
    } finally {
      for (const edge of bEdges) {
        safeDelete(edge);
      }
    }
  } finally {
    for (const edge of aEdges) {
      safeDelete(edge);
    }
  }
}

function collectFaceEdges(oc: OpenCascadeInstance, face: TopoDS_Face): TopoDS_Edge[] {
  const topAbs = oc.TopAbs_ShapeEnum as unknown as {
    TopAbs_EDGE: Parameters<TopExp_Explorer['Init']>[1];
    TopAbs_SHAPE: Parameters<TopExp_Explorer['Init']>[2];
  };
  const edges: TopoDS_Edge[] = [];
  let explorer: TopExp_Explorer | null = null;

  try {
    explorer = new oc.TopExp_Explorer_1();
    explorer.Init(face, topAbs.TopAbs_EDGE, topAbs.TopAbs_SHAPE);

    while (explorer.More()) {
      let currentShape: TopoDS_Shape | null = null;
      try {
        currentShape = explorer.Current();
        edges.push(oc.TopoDS.Edge_1(currentShape));
      } finally {
        safeDelete(currentShape);
      }
      explorer.Next();
    }
  } finally {
    safeDelete(explorer);
  }

  return edges;
}

function isValidTree(nodeCount: number, bends: SheetMetalBend[]): boolean {
  if (nodeCount < 2 || bends.length !== nodeCount - 1) {
    return false;
  }

  const adjacency = new Map<number, number[]>();
  for (let index = 0; index < nodeCount; index += 1) {
    adjacency.set(index, []);
  }
  for (const bend of bends) {
    adjacency.get(bend.from)?.push(bend.to);
    adjacency.get(bend.to)?.push(bend.from);
  }

  const visited = new Set<number>();
  const stack = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visited.has(node)) {
      continue;
    }
    visited.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }

  return visited.size === nodeCount;
}

function extractFaceLoops(
  input: SheetMetalTopologyInput,
  face: TopoDS_Face,
  frame: { origin: Vec3; uAxis: Vec3; vAxis: Vec3 }
): { contour: Point2D[] | null; holes: Point2D[][] } {
  const { oc } = input;
  const topAbs = oc.TopAbs_ShapeEnum as unknown as {
    TopAbs_WIRE: Parameters<TopExp_Explorer['Init']>[1];
    TopAbs_SHAPE: Parameters<TopExp_Explorer['Init']>[2];
  };
  let outerWire: TopoDS_Wire | null = null;
  let explorer: TopExp_Explorer | null = null;
  const candidates: Point2D[][] = [];
  const holes: Point2D[][] = [];
  let contour: Point2D[] | null = null;

  try {
    outerWire = oc.BRepTools.OuterWire(face);
    explorer = new oc.TopExp_Explorer_1();
    explorer.Init(face, topAbs.TopAbs_WIRE, topAbs.TopAbs_SHAPE);

    while (explorer.More()) {
      checkDeadline(input);
      let currentShape: TopoDS_Shape | null = null;
      let wire: TopoDS_Wire | null = null;

      try {
        currentShape = explorer.Current();
        wire = oc.TopoDS.Wire_1(currentShape);
        const loop = discretizeWire(input, face, wire, frame);

        if (loop.length >= 4) {
          if (outerWire && wire.IsSame(outerWire)) {
            contour = loop;
          } else {
            holes.push(loop);
          }
          candidates.push(loop);
        }
      } finally {
        safeDelete(wire);
        safeDelete(currentShape);
      }

      explorer.Next();
    }
  } finally {
    safeDelete(explorer);
    safeDelete(outerWire);
  }

  if (contour) {
    return { contour, holes };
  }

  const [largest, ...rest] = candidates.sort((left, right) => polygonArea(right) - polygonArea(left));
  return { contour: largest ?? null, holes: rest };
}

function discretizeWire(
  input: SheetMetalTopologyInput,
  face: TopoDS_Face,
  wire: TopoDS_Wire,
  frame: { origin: Vec3; uAxis: Vec3; vAxis: Vec3 }
): Point2D[] {
  const { oc } = input;
  let explorer: BRepTools_WireExplorer | null = null;
  const edges: Point2D[][] = [];

  try {
    explorer = new oc.BRepTools_WireExplorer_3(wire, face);
    while (explorer.More()) {
      checkDeadline(input);
      let edge: TopoDS_Edge | null = null;
      try {
        edge = explorer.Current();
        const points = discretizeEdge(input, face, edge, frame);
        if (points.length >= 2) {
          edges.push(points);
        }
      } finally {
        safeDelete(edge);
      }
      explorer.Next();
    }
  } finally {
    safeDelete(explorer);
  }

  return closeAndClean(chainWireEdges(edges));
}

function discretizeEdge(
  input: SheetMetalTopologyInput,
  face: TopoDS_Face,
  edge: TopoDS_Edge,
  frame: { origin: Vec3; uAxis: Vec3; vAxis: Vec3 }
): Point2D[] {
  const { oc } = input;
  let adaptor: BRepAdaptor_Curve | null = null;
  let deflection: GCPnts_TangentialDeflection | null = null;

  try {
    adaptor = new oc.BRepAdaptor_Curve_3(edge, face);
    const first = adaptor.FirstParameter();
    const last = adaptor.LastParameter();

    if (adaptor.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line) {
      return [curvePoint(adaptor, first, frame), curvePoint(adaptor, last, frame)];
    }

    deflection = new oc.GCPnts_TangentialDeflection_3(
      adaptor,
      first,
      last,
      ANGULAR_DEFLECTION_RAD,
      LINEAR_DEFLECTION_MM,
      2,
      1e-7,
      1e-7
    );

    const points: Point2D[] = [];
    for (let index = 1; index <= deflection.NbPoints(); index += 1) {
      let point: gp_Pnt | null = null;
      try {
        point = deflection.Value(index);
        points.push(projectPoint(toVec3(point), frame));
      } finally {
        safeDelete(point);
      }
    }

    return points;
  } finally {
    safeDelete(deflection);
    safeDelete(adaptor);
  }
}

function curvePoint(
  adaptor: BRepAdaptor_Curve,
  parameter: number,
  frame: { origin: Vec3; uAxis: Vec3; vAxis: Vec3 }
): Point2D {
  let point: gp_Pnt | null = null;
  try {
    point = adaptor.Value(parameter);
    return projectPoint(toVec3(point), frame);
  } finally {
    safeDelete(point);
  }
}

function chainWireEdges(edges: Point2D[][]): Point2D[] {
  if (edges.length === 0) {
    return [];
  }

  const unused = edges.map((edge) => edge.map((point) => ({ ...point })));
  const points = [...unused.shift()!];

  while (unused.length > 0) {
    const current = points[points.length - 1];
    const nextIndex = unused.findIndex((edge) =>
      distance2D(edge[0], current) <= POINT_EPSILON_MM ||
      distance2D(edge[edge.length - 1], current) <= POINT_EPSILON_MM
    );

    if (nextIndex < 0) {
      break;
    }

    let next = unused.splice(nextIndex, 1)[0];
    if (distance2D(next[next.length - 1], current) <= POINT_EPSILON_MM) {
      next = next.reverse();
    }

    for (const point of next.slice(1)) {
      const last = points[points.length - 1];
      if (!last || distance2D(last, point) > POINT_EPSILON_MM) {
        points.push(point);
      }
    }
  }

  return points;
}

function closeAndClean(points: Point2D[]): Point2D[] {
  if (points.length < 3) {
    return [];
  }

  const cleaned: Point2D[] = [];
  for (const point of points) {
    const rounded = { x: roundMm(point.x, 1000), y: roundMm(point.y, 1000) };
    const last = cleaned[cleaned.length - 1];
    if (!last || distance2D(last, rounded) > POINT_EPSILON_MM) {
      cleaned.push(rounded);
    }
  }

  if (cleaned.length < 3) {
    return [];
  }

  if (distance2D(cleaned[0], cleaned[cleaned.length - 1]) > POINT_EPSILON_MM) {
    cleaned.push({ ...cleaned[0] });
  }

  return cleaned;
}

function groupCylindersByAxis(cylinders: CylindricalFace[]): CylindricalFace[][] {
  const groups: CylindricalFace[][] = [];

  for (const cylinder of cylinders) {
    const normalized = {
      ...cylinder,
      axisDirection: canonicalDirection(normalize(cylinder.axisDirection)),
    };
    const group = groups.find((existing) => sameAxis(existing[0], normalized));
    if (group) {
      group.push(normalized);
    } else {
      groups.push([normalized]);
    }
  }

  return groups;
}

function sameAxis(a: CylindricalFace, b: CylindricalFace): boolean {
  if (Math.abs(dotProduct(a.axisDirection, b.axisDirection)) < PARALLEL_DOT_TOLERANCE) {
    return false;
  }

  return vectorLength(crossProduct(subtract(b.axisLocation, a.axisLocation), a.axisDirection)) <= AXIS_TOLERANCE_MM;
}

function angularSectorOverlap(a: CylindricalFace, b: CylindricalFace): number {
  const aIntervals = normalizedAngularIntervals(a.firstU, a.lastU);
  const bIntervals = normalizedAngularIntervals(b.firstU, b.lastU);
  let overlap = 0;

  for (const left of aIntervals) {
    for (const right of bIntervals) {
      overlap += Math.max(0, Math.min(left.max, right.max) - Math.max(left.min, right.min));
    }
  }

  return overlap;
}

function normalizedAngularIntervals(first: number, last: number): Array<{ min: number; max: number }> {
  const fullTurn = Math.PI * 2;
  const rawSpan = Math.abs(last - first);
  if (rawSpan >= fullTurn - BEND_SECTOR_TOLERANCE_RAD) {
    return [{ min: 0, max: fullTurn }];
  }

  const start = normalizeAngle(first);
  const end = normalizeAngle(last);
  if (end >= start) {
    return [{ min: start, max: end }];
  }

  return [
    { min: start, max: fullTurn },
    { min: 0, max: end },
  ];
}

function sameEdge(bend: SheetMetalBend, a: number, b: number): boolean {
  return (bend.from === a && bend.to === b) || (bend.from === b && bend.to === a);
}

function readPlaneFrame(adaptor: BRepAdaptor_Surface): PlaneFrame {
  let plane: gp_Pln | null = null;
  let position: gp_Ax3 | null = null;
  let origin: gp_Pnt | null = null;
  let normal: gp_Dir | null = null;
  let xAxis: gp_Dir | null = null;
  let yAxis: gp_Dir | null = null;

  try {
    plane = adaptor.Plane();
    position = plane.Position();
    origin = position.Location();
    normal = position.Direction();
    xAxis = position.XDirection();
    yAxis = position.YDirection();
    return {
      origin: toVec3(origin),
      normal: normalize(toVec3(normal)),
      xAxis: normalize(toVec3(xAxis)),
      yAxis: normalize(toVec3(yAxis)),
    };
  } finally {
    safeDelete(yAxis);
    safeDelete(xAxis);
    safeDelete(normal);
    safeDelete(origin);
    safeDelete(position);
    safeDelete(plane);
  }
}

function readCylinder(adaptor: BRepAdaptor_Surface): Omit<CylindricalFace, 'index' | 'face' | 'area'> {
  let cylinder: gp_Cylinder | null = null;
  let axis: gp_Ax1 | null = null;
  let location: gp_Pnt | null = null;
  let direction: gp_Dir | null = null;

  try {
    cylinder = adaptor.Cylinder();
    axis = cylinder.Axis();
    location = axis.Location();
    direction = axis.Direction();
    const firstU = adaptor.FirstUParameter();
    const lastU = adaptor.LastUParameter();
    const firstV = adaptor.FirstVParameter();
    const lastV = adaptor.LastVParameter();
    const axisLocation = toVec3(location);
    const axisDirection = normalize(toVec3(direction));
    return {
      radius: cylinder.Radius(),
      axisLocation,
      axisDirection,
      firstU,
      lastU,
      firstV,
      lastV,
      angleSpanRad: lastU - firstU,
      axisStart: add(axisLocation, scale(axisDirection, firstV)),
      axisEnd: add(axisLocation, scale(axisDirection, lastV)),
    };
  } finally {
    safeDelete(direction);
    safeDelete(location);
    safeDelete(axis);
    safeDelete(cylinder);
  }
}

function readShapeLengthAlongAxis(oc: OpenCascadeInstance, shape: TopoDS_Shape, axis: Vec3): number {
  const bbox = readBoundingBox(oc, shape);
  const corners = [
    { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z },
    { x: bbox.min.x, y: bbox.min.y, z: bbox.max.z },
    { x: bbox.min.x, y: bbox.max.y, z: bbox.min.z },
    { x: bbox.min.x, y: bbox.max.y, z: bbox.max.z },
    { x: bbox.max.x, y: bbox.min.y, z: bbox.min.z },
    { x: bbox.max.x, y: bbox.min.y, z: bbox.max.z },
    { x: bbox.max.x, y: bbox.max.y, z: bbox.min.z },
    { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z },
  ];
  const values = corners.map((corner) => dotProduct(corner, axis));
  return Math.max(...values) - Math.min(...values);
}

function readBoundingBox(oc: OpenCascadeInstance, shape: TopoDS_Shape): { min: Vec3; max: Vec3 } {
  let box: Bnd_Box | null = null;
  let minPoint: gp_Pnt | null = null;
  let maxPoint: gp_Pnt | null = null;

  try {
    box = new oc.Bnd_Box_1();
    oc.BRepBndLib.Add(shape, box, false);
    minPoint = box.CornerMin();
    maxPoint = box.CornerMax();
    return {
      min: toVec3(minPoint),
      max: toVec3(maxPoint),
    };
  } finally {
    safeDelete(maxPoint);
    safeDelete(minPoint);
    safeDelete(box);
  }
}

function readShapeVolume(oc: OpenCascadeInstance, shape: TopoDS_Shape): number {
  let props: GProp_GProps | null = null;

  try {
    props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
    return props.Mass();
  } finally {
    safeDelete(props);
  }
}

function distanceAxisToPlane(axisLocation: Vec3, axisDirection: Vec3, planeOrigin: Vec3, planeNormal: Vec3): number {
  const axisDot = Math.abs(dotProduct(axisDirection, planeNormal));
  if (axisDot > 0.05) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(dotProduct(subtract(axisLocation, planeOrigin), planeNormal));
}

function projectPoint(point: Vec3, frame: { origin: Vec3; uAxis: Vec3; vAxis: Vec3 }): Point2D {
  const delta = subtract(point, frame.origin);
  return {
    x: dotProduct(delta, frame.uAxis),
    y: dotProduct(delta, frame.vAxis),
  };
}

function getBounds(points: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: points[0]?.x ?? 0, minY: points[0]?.y ?? 0, maxX: points[0]?.x ?? 0, maxY: points[0]?.y ?? 0 }
  );
}

function uniqueByTolerance(values: number[], tolerance: number): number[] {
  const unique: number[] = [];
  for (const value of values) {
    if (!unique.some((existing) => Math.abs(existing - value) <= tolerance)) {
      unique.push(value);
    }
  }
  return unique;
}

function relativeDelta(a: number, b: number): number {
  const denominator = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / denominator;
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function normalizeBendAngleSpan(span: number): { value: number; usesComplement: boolean } {
  const fullTurn = Math.PI * 2;
  const positive = Math.abs(span) % fullTurn;
  return positive > Math.PI
    ? { value: fullTurn - positive, usesComplement: true }
    : { value: positive, usesComplement: false };
}

function normalizeAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function canonicalDirection(direction: Vec3): Vec3 {
  if (
    direction.x < -1e-9 ||
    (Math.abs(direction.x) <= 1e-9 && direction.y < -1e-9) ||
    (Math.abs(direction.x) <= 1e-9 && Math.abs(direction.y) <= 1e-9 && direction.z < -1e-9)
  ) {
    return scale(direction, -1);
  }
  return direction;
}

function normalize(vector: Vec3): Vec3 {
  const length = vectorLength(vector);
  return length <= 0 ? vector : scale(vector, 1 / length);
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function scale(vector: Vec3, factor: number): Vec3 {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
    z: vector.z * factor,
  };
}

function crossProduct(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dotProduct(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vectorLength(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function distance2D(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function debugTopology(label: string, details: unknown): void {
  if (!BEND_TOPOLOGY_DEBUG) {
    return;
  }
  console.error(`[bend-topology-debug] ${label}: ${JSON.stringify(details)}`);
}

function summarizeCylinder(cylinder: CylindricalFace): unknown {
  return {
    index: cylinder.index,
    radius: roundMm(cylinder.radius, 1000),
    area: roundMm(cylinder.area, 1000),
    angleDeg: roundMm(toDegrees(normalizeBendAngleSpan(cylinder.angleSpanRad).value), 1000),
    usesComplementAngle: normalizeBendAngleSpan(cylinder.angleSpanRad).usesComplement,
    axisLength: roundMm(vectorLength(subtract(cylinder.axisEnd, cylinder.axisStart)), 1000),
    axis: formatVec3(canonicalDirection(normalize(cylinder.axisDirection))),
    location: formatVec3(cylinder.axisLocation),
    firstU: roundMm(cylinder.firstU, 1000),
    lastU: roundMm(cylinder.lastU, 1000),
    firstV: roundMm(cylinder.firstV, 1000),
    lastV: roundMm(cylinder.lastV, 1000),
  };
}

function summarizePair(pair: BendCylinderPair): unknown {
  return {
    innerIndex: pair.inner.index,
    outerIndex: pair.outer.index,
    innerSegments: pair.innerSegments.map((segment) => segment.index),
    outerSegments: pair.outerSegments.map((segment) => segment.index),
    innerRadius: roundMm(pair.inner.radius, 1000),
    outerRadius: roundMm(pair.outer.radius, 1000),
    thickness: roundMm(pair.thickness, 1000),
    angleDeg: roundMm(toDegrees(normalizeBendAngleSpan(pair.inner.angleSpanRad).value), 1000),
    axisLength: roundMm(vectorLength(subtract(pair.inner.axisEnd, pair.inner.axisStart)), 1000),
    axis: formatVec3(canonicalDirection(normalize(pair.inner.axisDirection))),
  };
}

function formatVec3(vector: Vec3): { x: number; y: number; z: number } {
  return {
    x: roundMm(vector.x, 1000),
    y: roundMm(vector.y, 1000),
    z: roundMm(vector.z, 1000),
  };
}

function toDegrees(angleRad: number): number {
  return (angleRad * 180) / Math.PI;
}

function angularDistance(left: number, right: number): number {
  const fullTurn = Math.PI * 2;
  const direct = Math.abs(normalizeAngle(left) - normalizeAngle(right));
  return Math.min(direct, fullTurn - direct);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundMm(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}

function checkDeadline(input: SheetMetalTopologyInput): void {
  if (input.deadlineMs && Date.now() > input.deadlineMs) {
    throw new Error('B-Rep bend detection timed out');
  }
}

function toVec3(point: { X(): number; Y(): number; Z(): number }): Vec3 {
  return {
    x: point.X(),
    y: point.Y(),
    z: point.Z(),
  };
}

function safeDelete(value: Deletable | null | undefined): void {
  if (value) {
    value.delete();
  }
}
