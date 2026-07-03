import type {
  Bnd_Box,
  BRepAdaptor_Curve,
  BRepAdaptor_Surface,
  BRepTools_WireExplorer,
  GCPnts_TangentialDeflection,
  GProp_GProps,
  gp_Ax3,
  gp_Dir,
  gp_Pnt,
  gp_Pln,
  OpenCascadeInstance,
  TopExp_Explorer,
  TopoDS_Edge,
  TopoDS_Face,
  TopoDS_Shape,
  TopoDS_Wire,
} from 'opencascade.js/dist/node';
import {
  ensureClockwise,
  ensureCounterClockwise,
  polygonArea,
  polygonNetArea,
  signedPolygonArea,
  type Point2D,
} from '../geometry';
import type { Vec3 } from './brep-reader';

export type ExtractedPartContour = {
  contour: Point2D[];
  holes: Point2D[][];
  thickness: number;
  source: 'EXACT_BREP';
  area: number;
  width: number;
  height: number;
};

export type BrepSolidForContour = {
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

type FacePair = {
  a: PlanarFace;
  b: PlanarFace;
  thickness: number;
  coverage: number;
};

const ANGULAR_DEFLECTION_RAD = 0.1;
const LINEAR_DEFLECTION_MM = 0.05;
const MIN_THICKNESS_MM = 0.5;
const MAX_THICKNESS_MM = 50;
const MIN_BBOX_PROJECTION_COVERAGE = 0.6;
const PARALLEL_DOT_TOLERANCE = 0.999;
const COMPETING_MAJOR_FACE_RATIO = 0.6;
const POINT_EPSILON_MM = 0.001;

export function extractPartContour(solid: BrepSolidForContour): ExtractedPartContour | null {
  const faces = collectPlanarFaces(solid);

  try {
    if (faces.length < 2) {
      return null;
    }

    const pair = findSheetFacePair(solid, faces);
    if (!pair) {
      return null;
    }

    const selectedFace = pair.a.area >= pair.b.area ? pair.a : pair.b;
    const loops = extractFaceLoops(solid, selectedFace.face, selectedFace.frame);
    if (!loops.contour || loops.contour.length < 4) {
      return null;
    }

    const normalized = normalizeLoops(loops.contour, loops.holes);
    // DXF convention here: outer contour is clockwise, holes are counter-clockwise.
    const contour = ensureClockwise(normalized.contour);
    const holes = normalized.holes.map(ensureCounterClockwise).filter((hole) => hole.length >= 4);
    const area = polygonNetArea(contour, holes);

    if (area <= 0) {
      return null;
    }

    const bounds = getBounds(contour);
    return {
      contour,
      holes,
      thickness: roundMm(pair.thickness, 100),
      source: 'EXACT_BREP',
      area,
      width: roundMm(bounds.maxX - bounds.minX, 10),
      height: roundMm(bounds.maxY - bounds.minY, 10),
    };
  } finally {
    for (const face of faces) {
      safeDelete(face.face);
    }
  }
}

function collectPlanarFaces(solid: BrepSolidForContour): PlanarFace[] {
  const { oc, shape } = solid;
  const topAbs = oc.TopAbs_ShapeEnum as unknown as {
    TopAbs_FACE: Parameters<TopExp_Explorer['Init']>[1];
    TopAbs_SHAPE: Parameters<TopExp_Explorer['Init']>[2];
  };
  let explorer: TopExp_Explorer | null = null;
  const faces: PlanarFace[] = [];

  try {
    explorer = new oc.TopExp_Explorer_1();
    explorer.Init(shape, topAbs.TopAbs_FACE, topAbs.TopAbs_SHAPE);

    while (explorer.More()) {
      checkDeadline(solid);
      let currentShape: TopoDS_Shape | null = null;
      let face: TopoDS_Face | null = null;
      let adaptor: BRepAdaptor_Surface | null = null;
      let props: GProp_GProps | null = null;

      try {
        currentShape = explorer.Current();
        face = oc.TopoDS.Face_1(currentShape);
        adaptor = new oc.BRepAdaptor_Surface_2(face, true);

        if (adaptor.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
          safeDelete(face);
          face = null;
        } else {
          props = new oc.GProp_GProps_1();
          oc.BRepGProp.SurfaceProperties_1(face, props, false, false);
          faces.push({
            index: faces.length,
            face,
            area: props.Mass(),
            frame: readPlaneFrame(adaptor),
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

  return faces;
}

function findSheetFacePair(solid: BrepSolidForContour, faces: PlanarFace[]): FacePair | null {
  const projectionAreaByFace = new Map<number, number>();
  const candidates: FacePair[] = [];

  for (let i = 0; i < faces.length; i += 1) {
    for (let j = i + 1; j < faces.length; j += 1) {
      const a = faces[i];
      const b = faces[j];
      const dot = Math.abs(dotProduct(a.frame.normal, b.frame.normal));

      if (dot < PARALLEL_DOT_TOLERANCE) {
        continue;
      }

      const thickness = Math.abs(dotProduct(subtract(b.frame.origin, a.frame.origin), a.frame.normal));
      if (thickness < MIN_THICKNESS_MM || thickness > MAX_THICKNESS_MM) {
        continue;
      }

      const projectionArea = projectionAreaByFace.get(a.index) ?? solidBboxProjectionArea(solid, a.frame);
      projectionAreaByFace.set(a.index, projectionArea);
      if (projectionArea <= 0) {
        continue;
      }

      const coverage = Math.min(a.area, b.area) / projectionArea;
      if (coverage < MIN_BBOX_PROJECTION_COVERAGE) {
        continue;
      }

      candidates.push({ a, b, thickness, coverage });
    }
  }

  const sorted = candidates.sort((left, right) => Math.min(right.a.area, right.b.area) - Math.min(left.a.area, left.b.area));
  for (const candidate of sorted) {
    if (!hasCompetingMajorPlane(candidate, faces)) {
      return candidate;
    }
  }

  return null;
}

function hasCompetingMajorPlane(pair: FacePair, faces: PlanarFace[]): boolean {
  const pairArea = Math.min(pair.a.area, pair.b.area);

  return faces.some((face) => {
    if (face.index === pair.a.index || face.index === pair.b.index) {
      return false;
    }

    const parallel = Math.abs(dotProduct(face.frame.normal, pair.a.frame.normal)) >= PARALLEL_DOT_TOLERANCE;
    return !parallel && face.area >= pairArea * COMPETING_MAJOR_FACE_RATIO;
  });
}

function extractFaceLoops(
  solid: BrepSolidForContour,
  face: TopoDS_Face,
  frame: PlaneFrame
): { contour: Point2D[] | null; holes: Point2D[][] } {
  const { oc } = solid;
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
      checkDeadline(solid);
      let currentShape: TopoDS_Shape | null = null;
      let wire: TopoDS_Wire | null = null;

      try {
        currentShape = explorer.Current();
        wire = oc.TopoDS.Wire_1(currentShape);
        const loop = discretizeWire(solid, face, wire, frame);

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
  solid: BrepSolidForContour,
  face: TopoDS_Face,
  wire: TopoDS_Wire,
  frame: PlaneFrame
): Point2D[] {
  const { oc } = solid;
  let explorer: BRepTools_WireExplorer | null = null;
  const points: Point2D[] = [];

  try {
    explorer = new oc.BRepTools_WireExplorer_3(wire, face);

    while (explorer.More()) {
      checkDeadline(solid);
      let edge: TopoDS_Edge | null = null;

      try {
        edge = explorer.Current();
        const edgePoints = discretizeEdge(solid, face, edge, frame);
        appendEdgePoints(points, edgePoints);
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
  solid: BrepSolidForContour,
  face: TopoDS_Face,
  edge: TopoDS_Edge,
  frame: PlaneFrame
): Point2D[] {
  const { oc } = solid;
  let adaptor: BRepAdaptor_Curve | null = null;
  let deflection: GCPnts_TangentialDeflection | null = null;

  try {
    adaptor = new oc.BRepAdaptor_Curve_3(edge, face);
    const first = adaptor.FirstParameter();
    const last = adaptor.LastParameter();
    const curveType = adaptor.GetType();

    if (curveType === oc.GeomAbs_CurveType.GeomAbs_Line) {
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

    return points.length >= 2 ? points : sampleEdgeUniformly(adaptor, first, last, frame);
  } finally {
    safeDelete(deflection);
    safeDelete(adaptor);
  }
}

function sampleEdgeUniformly(
  adaptor: BRepAdaptor_Curve,
  first: number,
  last: number,
  frame: PlaneFrame
): Point2D[] {
  const points: Point2D[] = [];
  const samples = 16;

  for (let index = 0; index <= samples; index += 1) {
    const t = first + ((last - first) * index) / samples;
    points.push(curvePoint(adaptor, t, frame));
  }

  return points;
}

function curvePoint(adaptor: BRepAdaptor_Curve, parameter: number, frame: PlaneFrame): Point2D {
  let point: gp_Pnt | null = null;

  try {
    point = adaptor.Value(parameter);
    return projectPoint(toVec3(point), frame);
  } finally {
    safeDelete(point);
  }
}

function appendEdgePoints(target: Point2D[], edgePoints: Point2D[]): void {
  if (edgePoints.length === 0) {
    return;
  }

  let points = edgePoints;
  const previous = target[target.length - 1];
  if (previous) {
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
    const last = cleaned[cleaned.length - 1];
    const rounded = { x: roundMm(point.x, 1000), y: roundMm(point.y, 1000) };
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

function normalizeLoops(contour: Point2D[], holes: Point2D[][]): { contour: Point2D[]; holes: Point2D[][] } {
  const allPoints = [contour, ...holes].flat();
  const minX = Math.min(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const normalizePoint = (point: Point2D): Point2D => ({
    x: roundMm(point.x - minX, 1000),
    y: roundMm(point.y - minY, 1000),
  });

  return {
    contour: closeAndClean(contour.map(normalizePoint)),
    holes: holes.map((hole) => closeAndClean(hole.map(normalizePoint))).filter((hole) => Math.abs(signedPolygonArea(hole)) > 0),
  };
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

function solidBboxProjectionArea(solid: BrepSolidForContour, frame: PlaneFrame): number {
  const bbox = readBoundingBox(solid.oc, solid.shape);
  const points: Vec3[] = [
    { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z },
    { x: bbox.min.x, y: bbox.min.y, z: bbox.max.z },
    { x: bbox.min.x, y: bbox.max.y, z: bbox.min.z },
    { x: bbox.min.x, y: bbox.max.y, z: bbox.max.z },
    { x: bbox.max.x, y: bbox.min.y, z: bbox.min.z },
    { x: bbox.max.x, y: bbox.min.y, z: bbox.max.z },
    { x: bbox.max.x, y: bbox.max.y, z: bbox.min.z },
    { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z },
  ];
  const projected = points.map((point) => projectPoint(point, frame));
  const bounds = getBounds(projected);

  return (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
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

function projectPoint(point: Vec3, frame: PlaneFrame): Point2D {
  const delta = subtract(point, frame.origin);

  return {
    x: dotProduct(delta, frame.xAxis),
    y: dotProduct(delta, frame.yAxis),
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

function checkDeadline(solid: BrepSolidForContour): void {
  if (solid.deadlineMs && Date.now() > solid.deadlineMs) {
    throw new Error('B-Rep contour extraction timed out');
  }
}

function toVec3(point: { X(): number; Y(): number; Z(): number }): Vec3 {
  return {
    x: point.X(),
    y: point.Y(),
    z: point.Z(),
  };
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (length <= 0) {
    return vector;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function dotProduct(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distance2D(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function roundMm(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}

function safeDelete(value: Deletable | null | undefined): void {
  if (value) {
    value.delete();
  }
}
