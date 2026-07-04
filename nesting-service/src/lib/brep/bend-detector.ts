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
  angleSpanRad: number;
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
  innerCylinder: CylindricalFace;
  outerRadius: number;
};

type BendCylinderSet = {
  axis: Vec3;
  thickness: number;
  cylinders: CylindricalFace[];
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
const MIN_INNER_RADIUS_MM = 0.25;
const MAX_BEND_RADIUS_TO_THICKNESS = 12;

export function detectSheetMetalTopology(input: SheetMetalTopologyInput): SheetMetalTopology | null {
  const planarFaces: PlanarFace[] = [];
  const cylindricalFaces: CylindricalFace[] = [];

  try {
    const faces = collectFaces(input);
    planarFaces.push(...faces.planar);
    cylindricalFaces.push(...faces.cylinders);

    if (faces.cylinders.length === 0 || faces.planar.length < 4) {
      return null;
    }

    const bendCylinderSet = selectBendCylinderSet(faces.cylinders);
    if (!bendCylinderSet) {
      return null;
    }
    const { axis: bendAxis, thickness } = bendCylinderSet;

    const length = readShapeLengthAlongAxis(input.oc, input.shape, bendAxis);
    if (length <= 0) {
      return null;
    }

    const facePairs = findFlangePairs(faces.planar, thickness, bendAxis, length);
    if (facePairs.length < 2) {
      return null;
    }

    const flanges = facePairs.map((pair, index) => buildFlange(input, pair, index, bendAxis));
    const bendCandidates = findBendCandidates(bendCylinderSet.cylinders, thickness, bendAxis);
    const facesByIndex = new Map(faces.planar.map((face) => [face.index, face]));
    const bends = connectBends(input.oc, bendCandidates, flanges, facesByIndex, thickness);

    if (!isValidTree(flanges.length, bends)) {
      return null;
    }

    const volume = readShapeVolume(input.oc, input.shape);
    const baseFace = [...flanges].sort((a, b) => b.area - a.area)[0];
    return {
      baseFace,
      flanges,
      bends,
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
  const eligibleGroups: CylindricalFace[][] = [];
  const candidates: number[] = [];

  for (const group of groups) {
    const radii = uniqueByTolerance(group.map((cylinder) => cylinder.radius), 0.01).sort((a, b) => a - b);
    let groupHasThickness = false;
    for (let index = 1; index < radii.length; index += 1) {
      const diff = radii[index] - radii[index - 1];
      if (diff >= MIN_THICKNESS_MM && diff <= MAX_THICKNESS_MM) {
        candidates.push(diff);
        groupHasThickness = true;
      }
    }
    if (groupHasThickness) {
      eligibleGroups.push(group);
    }
  }

  if (eligibleGroups.length === 0 || candidates.length === 0) {
    return null;
  }

  const firstAxis = canonicalDirection(normalize(eligibleGroups[0][0].axisDirection));
  if (eligibleGroups.some((group) => Math.abs(dotProduct(firstAxis, canonicalDirection(normalize(group[0].axisDirection)))) < PARALLEL_DOT_TOLERANCE)) {
    return null;
  }

  candidates.sort((a, b) => a - b);
  const thickness = roundMm(candidates[Math.floor(candidates.length / 2)], 100);

  return {
    axis: firstAxis,
    thickness,
    cylinders: eligibleGroups.flat(),
  };
}

function findFlangePairs(faces: PlanarFace[], thickness: number, bendAxis: Vec3, length: number): FlangePair[] {
  const pairs: FlangePair[] = [];
  const used = new Set<number>();
  const minArea = length * thickness * MIN_FLANGE_WIDTH_FACTOR;

  for (let i = 0; i < faces.length; i += 1) {
    if (used.has(i) || faces[i].area < minArea || Math.abs(dotProduct(faces[i].frame.normal, bendAxis)) > 0.05) {
      continue;
    }

    let best: { pair: FlangePair; score: number } | null = null;
    for (let j = i + 1; j < faces.length; j += 1) {
      if (used.has(j) || faces[j].area < minArea || Math.abs(dotProduct(faces[j].frame.normal, bendAxis)) > 0.05) {
        continue;
      }

      const dot = Math.abs(dotProduct(faces[i].frame.normal, faces[j].frame.normal));
      if (dot < PARALLEL_DOT_TOLERANCE) {
        continue;
      }

      const distance = Math.abs(dotProduct(subtract(faces[j].frame.origin, faces[i].frame.origin), faces[i].frame.normal));
      if (relativeDelta(distance, thickness) > THICKNESS_TOLERANCE) {
        continue;
      }

      const areaDelta = relativeDelta(faces[i].area, faces[j].area);
      if (areaDelta > 0.1) {
        continue;
      }

      const score = areaDelta + Math.abs(distance - thickness);
      if (!best || score < best.score) {
        best = { pair: { a: faces[i], b: faces[j], thickness: distance }, score };
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

function buildFlange(input: SheetMetalTopologyInput, pair: FlangePair, id: number, bendAxis: Vec3): SheetMetalFlange {
  const face = pair.a.area >= pair.b.area ? pair.a : pair.b;
  const normal = canonicalDirection(normalize(face.frame.normal));
  const uAxis = bendAxis;
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

function findBendCandidates(cylinders: CylindricalFace[], thickness: number, bendAxis: Vec3): BendCandidate[] {
  const groups = groupCylindersByAxis(cylinders);
  const candidates: BendCandidate[] = [];

  for (const group of groups) {
    const radii = uniqueByTolerance(group.map((cylinder) => cylinder.radius), 0.01).sort((a, b) => a - b);
    if (radii.length < 2) {
      continue;
    }

    for (let index = 1; index < radii.length; index += 1) {
      const innerRadius = radii[index - 1];
      const outerRadius = radii[index];
      if (
        relativeDelta(outerRadius - innerRadius, thickness) <= THICKNESS_TOLERANCE &&
        isReasonableBendRadii(innerRadius, outerRadius, thickness)
      ) {
        const inner = group.find((cylinder) => Math.abs(cylinder.radius - innerRadius) <= 0.01);
        if (!inner) {
          continue;
        }
        const angle = normalizeBendAngleSpan(inner.angleSpanRad);
        candidates.push({
          innerRadius,
          angleRad: angle.value,
          usesComplementAngle: angle.usesComplement,
          axisLocation: inner.axisLocation,
          axisDirection: bendAxis,
          innerCylinder: inner,
          outerRadius,
        });
      }
    }
  }

  return candidates;
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
    for (let i = 0; i < tangentFlanges.length; i += 1) {
      for (let j = i + 1; j < tangentFlanges.length; j += 1) {
        const a = tangentFlanges[i];
        const b = tangentFlanges[j];
        const angle = Math.acos(clamp(Math.abs(dotProduct(a.flange.normal, b.flange.normal)), -1, 1));
        const score = Math.abs(angle - candidate.angleRad) + a.tangentError + b.tangentError;

        if (
          Math.abs(angle - candidate.angleRad) <= BEND_ANGLE_TOLERANCE_RAD &&
          cylinderConnectsFlanges(oc, candidate, a.flange, b.flange, facesByIndex) &&
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
        usesComplementAngle: candidate.usesComplementAngle,
        direction,
      });
    }
  }

  return bends;
}

function isReasonableBendRadii(innerRadius: number, outerRadius: number, thickness: number): boolean {
  if (innerRadius < MIN_INNER_RADIUS_MM || outerRadius <= innerRadius || thickness <= 0) {
    return false;
  }

  return innerRadius / thickness <= MAX_BEND_RADIUS_TO_THICKNESS;
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
    cylinderSharesEdgeWithFlange(oc, candidate.innerCylinder.face, a, facesByIndex) &&
    cylinderSharesEdgeWithFlange(oc, candidate.innerCylinder.face, b, facesByIndex)
  );
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
  const points: Point2D[] = [];

  try {
    explorer = new oc.BRepTools_WireExplorer_3(wire, face);
    while (explorer.More()) {
      checkDeadline(input);
      let edge: TopoDS_Edge | null = null;
      try {
        edge = explorer.Current();
        appendEdgePoints(points, discretizeEdge(input, face, edge, frame));
      } finally {
        safeDelete(edge);
      }
      explorer.Next();
    }
  } finally {
    safeDelete(explorer);
  }

  return closeAndClean(points);
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

function appendEdgePoints(target: Point2D[], edgePoints: Point2D[]): void {
  let points = edgePoints;
  const previous = target[target.length - 1];
  if (previous && points.length > 1) {
    const firstDistance = distance2D(previous, points[0]);
    const lastDistance = distance2D(previous, points[points.length - 1]);
    if (lastDistance < firstDistance) {
      points = [...points].reverse();
    }
  }

  for (const point of points) {
    const last = target[target.length - 1];
    if (!last || distance2D(last, point) > POINT_EPSILON_MM) {
      target.push(point);
    }
  }
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
    return {
      radius: cylinder.Radius(),
      axisLocation: toVec3(location),
      axisDirection: normalize(toVec3(direction)),
      angleSpanRad: adaptor.LastUParameter() - adaptor.FirstUParameter(),
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
