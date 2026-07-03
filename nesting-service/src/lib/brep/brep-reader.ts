import { getOCC } from './occ-loader';
import { extractPartContour, type ExtractedPartContour } from './contour-extractor';
import { detectSheetMetalTopology } from './bend-detector';
import { unfoldPart, type UnfoldedPartContour } from './unfolder';
import type {
  Bnd_Box,
  BRepAdaptor_Surface,
  GProp_GProps,
  gp_Ax1,
  gp_Cylinder,
  gp_Dir,
  gp_Pln,
  gp_Pnt,
  Message_ProgressRange,
  OpenCascadeInstance,
  STEPControl_Reader,
  TopExp_Explorer,
  TopoDS_Face,
  TopoDS_Shape,
  TopoDS_Solid,
} from 'opencascade.js/dist/node';

export type Vec3 = { x: number; y: number; z: number };

export interface FaceInfo {
  index: number;
  surfaceType: 'plane' | 'cylinder' | 'cone' | 'torus' | 'bspline' | 'other';
  area: number;
  plane?: {
    normal: Vec3;
    location: Vec3;
  };
  cylinder?: {
    radius: number;
    axisLocation: Vec3;
    axisDirection: Vec3;
    angleSpanRad: number;
    heightSpanV: number;
  };
}

export interface BrepTopology {
  ok: boolean;
  error?: string;
  faceCount: number;
  planeCount: number;
  cylinderCount: number;
  faces: FaceInfo[];
}

export interface SolidInfo {
  index: number;
  volume: number;
  surfaceArea: number;
  bbox: {
    min: Vec3;
    max: Vec3;
    size: Vec3;
  };
  planeCount: number;
  cylinderCount: number;
  thickness: {
    byVolumeArea: number;
    byBendRadii: number[];
  };
}

export interface BrepSolidsReport {
  ok: boolean;
  error?: string;
  isShellFallback?: boolean;
  solidCount: number;
  solids: SolidInfo[];
}

export interface BrepContourResult {
  solidIndex: number;
  contour: BrepPartContour | null;
  fallbackReason: string | null;
  elapsedMs: number;
  kFactor: number | null;
  kFactorDefaulted: boolean;
  warnings: string[];
}

export interface BrepContoursReport {
  ok: boolean;
  error?: string;
  solidCount: number;
  results: BrepContourResult[];
}

export type BrepPartContour = ExtractedPartContour | UnfoldedPartContour;

export type KFactorLookupResult = {
  kFactor: number;
  defaulted: boolean;
  warning?: string;
};

export type KFactorResolver = (input: {
  material: string;
  thickness: number;
  solidIndex: number;
}) => Promise<KFactorLookupResult> | KFactorLookupResult;

type Deletable = {
  delete(): void;
};

type SolidCylinderInfo = {
  radius: number;
  axisLocation: Vec3;
  axisDirection: Vec3;
  angleSpanRad: number;
};

type TopAbsExplorerEnums = {
  TopAbs_FACE: Parameters<TopExp_Explorer['Init']>[1];
  TopAbs_SOLID: Parameters<TopExp_Explorer['Init']>[1];
  TopAbs_SHAPE: Parameters<TopExp_Explorer['Init']>[2];
};

const INPUT_PATH = '/input.step';

export async function readBrepTopology(fileBytes: Uint8Array): Promise<BrepTopology> {
  const oc = await getOCC();
  let reader: STEPControl_Reader | null = null;
  let progress: Message_ProgressRange | null = null;
  let shape: TopoDS_Shape | null = null;
  let explorer: TopExp_Explorer | null = null;
  let fileWritten = false;

  try {
    oc.FS.writeFile(INPUT_PATH, fileBytes);
    fileWritten = true;

    reader = new oc.STEPControl_Reader_1();
    const status = reader.ReadFile(INPUT_PATH);

    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`STEP read failed with status: ${getReturnStatusName(oc, status)}`);
    }

    progress = new oc.Message_ProgressRange_1();
    reader.TransferRoots(progress);
    shape = reader.OneShape();

    explorer = new oc.TopExp_Explorer_1();
    const topAbs = oc.TopAbs_ShapeEnum as unknown as {
      TopAbs_FACE: Parameters<TopExp_Explorer['Init']>[1];
      TopAbs_SHAPE: Parameters<TopExp_Explorer['Init']>[2];
    };
    explorer.Init(shape, topAbs.TopAbs_FACE, topAbs.TopAbs_SHAPE);

    const faces: FaceInfo[] = [];
    let planeCount = 0;
    let cylinderCount = 0;

    while (explorer.More()) {
      const face = readFaceInfo(oc, explorer.Current(), faces.length);
      faces.push(face);

      if (face.surfaceType === 'plane') {
        planeCount += 1;
      } else if (face.surfaceType === 'cylinder') {
        cylinderCount += 1;
      }

      explorer.Next();
    }

    return {
      ok: true,
      faceCount: faces.length,
      planeCount,
      cylinderCount,
      faces,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      faceCount: 0,
      planeCount: 0,
      cylinderCount: 0,
      faces: [],
    };
  } finally {
    safeDelete(explorer);
    safeDelete(shape);
    safeDelete(progress);
    safeDelete(reader);

    if (fileWritten) {
      try {
        oc.FS.unlink(INPUT_PATH);
      } catch {
        // Ignore cleanup errors from the in-memory FS.
      }
    }
  }
}

export async function readBrepSolids(fileBytes: Uint8Array): Promise<BrepSolidsReport> {
  const oc = await getOCC();
  let reader: STEPControl_Reader | null = null;
  let progress: Message_ProgressRange | null = null;
  let shape: TopoDS_Shape | null = null;
  let explorer: TopExp_Explorer | null = null;
  let fileWritten = false;

  try {
    oc.FS.writeFile(INPUT_PATH, fileBytes);
    fileWritten = true;

    reader = new oc.STEPControl_Reader_1();
    const status = reader.ReadFile(INPUT_PATH);

    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`STEP read failed with status: ${getReturnStatusName(oc, status)}`);
    }

    progress = new oc.Message_ProgressRange_1();
    reader.TransferRoots(progress);
    shape = reader.OneShape();

    const topAbs = getTopAbsExplorerEnums(oc);
    explorer = new oc.TopExp_Explorer_1();
    explorer.Init(shape, topAbs.TopAbs_SOLID, topAbs.TopAbs_SHAPE);

    const solids: SolidInfo[] = [];

    while (explorer.More()) {
      let currentShape: TopoDS_Shape | null = null;
      let solid: TopoDS_Solid | null = null;

      try {
        currentShape = explorer.Current();
        solid = oc.TopoDS.Solid_1(currentShape);
        solids.push(readSolidInfo(oc, solid, solids.length));
      } finally {
        safeDelete(solid);
        safeDelete(currentShape);
      }

      explorer.Next();
    }

    if (solids.length === 0) {
      return {
        ok: true,
        isShellFallback: true,
        solidCount: 1,
        solids: [readSolidInfo(oc, shape, 0)],
      };
    }

    return {
      ok: true,
      solidCount: solids.length,
      solids,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      solidCount: 0,
      solids: [],
    };
  } finally {
    safeDelete(explorer);
    safeDelete(shape);
    safeDelete(progress);
    safeDelete(reader);

    if (fileWritten) {
      try {
        oc.FS.unlink(INPUT_PATH);
      } catch {
        // Ignore cleanup errors from the in-memory FS.
      }
    }
  }
}

export async function readBrepPartContours(
  fileBytes: Uint8Array,
  options: { timeoutMs?: number; material?: string; resolveKFactor?: KFactorResolver } = {}
): Promise<BrepContoursReport> {
  const oc = await getOCC();
  let reader: STEPControl_Reader | null = null;
  let progress: Message_ProgressRange | null = null;
  let shape: TopoDS_Shape | null = null;
  let explorer: TopExp_Explorer | null = null;
  let fileWritten = false;

  try {
    oc.FS.writeFile(INPUT_PATH, fileBytes);
    fileWritten = true;

    reader = new oc.STEPControl_Reader_1();
    const status = reader.ReadFile(INPUT_PATH);

    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`STEP read failed with status: ${getReturnStatusName(oc, status)}`);
    }

    progress = new oc.Message_ProgressRange_1();
    reader.TransferRoots(progress);
    shape = reader.OneShape();

    const topAbs = getTopAbsExplorerEnums(oc);
    explorer = new oc.TopExp_Explorer_1();
    explorer.Init(shape, topAbs.TopAbs_SOLID, topAbs.TopAbs_SHAPE);

    const results: BrepContourResult[] = [];

    while (explorer.More()) {
      let currentShape: TopoDS_Shape | null = null;
      let solid: TopoDS_Solid | null = null;
      const startTime = Date.now();
      const solidIndex = results.length;

      try {
        currentShape = explorer.Current();
        solid = oc.TopoDS.Solid_1(currentShape);
        const deadlineMs = options.timeoutMs ? startTime + options.timeoutMs : undefined;
        const flatContour = extractPartContour({ oc, shape: solid, deadlineMs });

        if (flatContour) {
          results.push({
            solidIndex,
            contour: flatContour,
            fallbackReason: null,
            elapsedMs: Date.now() - startTime,
            kFactor: null,
            kFactorDefaulted: false,
            warnings: [],
          });
        } else {
          const unfolded = await tryUnfoldSolid({
            oc,
            solid,
            solidIndex,
            deadlineMs,
            material: options.material ?? 'Сталь',
            resolveKFactor: options.resolveKFactor,
          });

          results.push({
            solidIndex,
            contour: unfolded.contour,
            fallbackReason: unfolded.contour ? null : unfolded.reason,
            elapsedMs: Date.now() - startTime,
            kFactor: unfolded.kFactor,
            kFactorDefaulted: unfolded.kFactorDefaulted,
            warnings: unfolded.warnings,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          solidIndex,
          contour: null,
          fallbackReason: message,
          elapsedMs: Date.now() - startTime,
          kFactor: null,
          kFactorDefaulted: false,
          warnings: [],
        });
      } finally {
        safeDelete(solid);
        safeDelete(currentShape);
      }

      explorer.Next();
    }

    return {
      ok: true,
      solidCount: results.length,
      results,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      solidCount: 0,
      results: [],
    };
  } finally {
    safeDelete(explorer);
    safeDelete(shape);
    safeDelete(progress);
    safeDelete(reader);

    if (fileWritten) {
      try {
        oc.FS.unlink(INPUT_PATH);
      } catch {
        // Ignore cleanup errors from the in-memory FS.
      }
    }
  }
}

async function tryUnfoldSolid(input: {
  oc: OpenCascadeInstance;
  solid: TopoDS_Solid;
  solidIndex: number;
  deadlineMs?: number;
  material: string;
  resolveKFactor?: KFactorResolver;
}): Promise<{
  contour: UnfoldedPartContour | null;
  reason: string;
  kFactor: number | null;
  kFactorDefaulted: boolean;
  warnings: string[];
}> {
  const topology = detectSheetMetalTopology({
    oc: input.oc,
    shape: input.solid,
    deadlineMs: input.deadlineMs,
  });

  if (!topology) {
    return {
      contour: null,
      reason: 'not a validated bend topology by B-Rep validation',
      kFactor: null,
      kFactorDefaulted: false,
      warnings: [],
    };
  }

  const lookup = input.resolveKFactor
    ? await input.resolveKFactor({
        material: input.material,
        thickness: topology.thickness,
        solidIndex: input.solidIndex,
      })
    : {
        kFactor: 0.4,
        defaulted: true,
        warning: 'K-factor rule not found, default 0.4 used',
      };
  const unfolded = unfoldPart(topology, lookup.kFactor);
  const warnings = lookup.warning ? [lookup.warning] : [];

  if (!unfolded) {
    return {
      contour: null,
      reason: 'unfold validation failed (bend-zone cutout or area mismatch)',
      kFactor: lookup.kFactor,
      kFactorDefaulted: lookup.defaulted,
      warnings,
    };
  }

  return {
    contour: {
      ...unfolded,
      kFactorDefaulted: lookup.defaulted,
    },
    reason: '',
    kFactor: lookup.kFactor,
    kFactorDefaulted: lookup.defaulted,
    warnings,
  };
}

function readFaceInfo(oc: OpenCascadeInstance, currentShape: TopoDS_Shape, index: number): FaceInfo {
  let face: TopoDS_Face | null = null;
  let adaptor: BRepAdaptor_Surface | null = null;
  let props: GProp_GProps | null = null;

  try {
    face = oc.TopoDS.Face_1(currentShape);
    adaptor = new oc.BRepAdaptor_Surface_2(face, true);
    props = new oc.GProp_GProps_1();

    oc.BRepGProp.SurfaceProperties_1(face, props, false, false);

    const surfaceType = mapSurfaceType(oc, adaptor.GetType());
    const info: FaceInfo = {
      index,
      surfaceType,
      area: props.Mass(),
    };

    if (surfaceType === 'plane') {
      info.plane = readPlaneInfo(adaptor);
    } else if (surfaceType === 'cylinder') {
      info.cylinder = readCylinderInfo(adaptor);
    }

    return info;
  } finally {
    safeDelete(props);
    safeDelete(adaptor);
    safeDelete(face);
    safeDelete(currentShape);
  }
}

function readSolidInfo(oc: OpenCascadeInstance, solidShape: TopoDS_Shape, index: number): SolidInfo {
  let volumeProps: GProp_GProps | null = null;
  let surfaceProps: GProp_GProps | null = null;

  try {
    volumeProps = new oc.GProp_GProps_1();
    surfaceProps = new oc.GProp_GProps_1();

    oc.BRepGProp.VolumeProperties_1(solidShape, volumeProps, false, false, false);
    oc.BRepGProp.SurfaceProperties_1(solidShape, surfaceProps, false, false);

    const volume = volumeProps.Mass();
    const surfaceArea = surfaceProps.Mass();
    const faceStats = readSolidFaceStats(oc, solidShape);

    return {
      index,
      volume,
      surfaceArea,
      bbox: readBoundingBox(oc, solidShape),
      planeCount: faceStats.planeCount,
      cylinderCount: faceStats.cylinderCount,
      thickness: {
        byVolumeArea: surfaceArea === 0 ? 0 : volume / (surfaceArea / 2),
        byBendRadii: getBendRadiusThicknessCandidates(faceStats.cylinders),
      },
    };
  } finally {
    safeDelete(surfaceProps);
    safeDelete(volumeProps);
  }
}

function readSolidFaceStats(
  oc: OpenCascadeInstance,
  solidShape: TopoDS_Shape
): { planeCount: number; cylinderCount: number; cylinders: SolidCylinderInfo[] } {
  let explorer: TopExp_Explorer | null = null;

  try {
    const topAbs = getTopAbsExplorerEnums(oc);
    explorer = new oc.TopExp_Explorer_1();
    explorer.Init(solidShape, topAbs.TopAbs_FACE, topAbs.TopAbs_SHAPE);

    const cylinders: SolidCylinderInfo[] = [];
    let planeCount = 0;
    let cylinderCount = 0;

    while (explorer.More()) {
      let currentShape: TopoDS_Shape | null = null;
      let face: TopoDS_Face | null = null;
      let adaptor: BRepAdaptor_Surface | null = null;

      try {
        currentShape = explorer.Current();
        face = oc.TopoDS.Face_1(currentShape);
        adaptor = new oc.BRepAdaptor_Surface_2(face, true);

        const surfaceType = mapSurfaceType(oc, adaptor.GetType());

        if (surfaceType === 'plane') {
          planeCount += 1;
        } else if (surfaceType === 'cylinder') {
          cylinderCount += 1;
          const cylinder = readCylinderInfo(adaptor);
          cylinders.push({
            radius: cylinder.radius,
            axisLocation: cylinder.axisLocation,
            axisDirection: cylinder.axisDirection,
            angleSpanRad: cylinder.angleSpanRad,
          });
        }
      } finally {
        safeDelete(adaptor);
        safeDelete(face);
        safeDelete(currentShape);
      }

      explorer.Next();
    }

    return { planeCount, cylinderCount, cylinders };
  } finally {
    safeDelete(explorer);
  }
}

function readBoundingBox(oc: OpenCascadeInstance, shape: TopoDS_Shape): SolidInfo['bbox'] {
  let box: Bnd_Box | null = null;
  let minPoint: gp_Pnt | null = null;
  let maxPoint: gp_Pnt | null = null;

  try {
    box = new oc.Bnd_Box_1();
    oc.BRepBndLib.Add(shape, box, false);
    minPoint = box.CornerMin();
    maxPoint = box.CornerMax();

    const min = toVec3(minPoint);
    const max = toVec3(maxPoint);

    return {
      min,
      max,
      size: {
        x: max.x - min.x,
        y: max.y - min.y,
        z: max.z - min.z,
      },
    };
  } finally {
    safeDelete(maxPoint);
    safeDelete(minPoint);
    safeDelete(box);
  }
}

function readPlaneInfo(adaptor: BRepAdaptor_Surface): NonNullable<FaceInfo['plane']> {
  let plane: gp_Pln | null = null;
  let axis: gp_Ax1 | null = null;
  let normal: gp_Dir | null = null;
  let location: gp_Pnt | null = null;

  try {
    plane = adaptor.Plane();
    axis = plane.Axis();
    normal = axis.Direction();
    location = plane.Location();

    return {
      normal: toVec3(normal),
      location: toVec3(location),
    };
  } finally {
    safeDelete(location);
    safeDelete(normal);
    safeDelete(axis);
    safeDelete(plane);
  }
}

function getBendRadiusThicknessCandidates(cylinders: SolidCylinderInfo[]): number[] {
  const groups = groupCylindersByAxis(cylinders, 1e-3);
  const candidates = new Set<number>();

  for (const group of groups) {
    const radii = uniqueRounded(group.map((cylinder) => cylinder.radius), 1e-3).sort((a, b) => a - b);

    for (let i = 1; i < radii.length; i += 1) {
      const diff = roundTo(radii[i] - radii[i - 1], 0.1);

      if (diff > 0) {
        candidates.add(diff);
      }
    }
  }

  return [...candidates].sort((a, b) => a - b);
}

function groupCylindersByAxis(cylinders: SolidCylinderInfo[], tolerance: number): SolidCylinderInfo[][] {
  const groups: SolidCylinderInfo[][] = [];

  for (const cylinder of cylinders) {
    const normalized = {
      ...cylinder,
      axisDirection: canonicalDirection(normalize(cylinder.axisDirection)),
    };

    const group = groups.find((existingGroup) => sameAxis(existingGroup[0], normalized, tolerance));

    if (group) {
      group.push(normalized);
    } else {
      groups.push([normalized]);
    }
  }

  return groups;
}

function sameAxis(a: SolidCylinderInfo, b: SolidCylinderInfo, tolerance: number): boolean {
  if (distance(a.axisDirection, b.axisDirection) > tolerance) {
    return false;
  }

  const delta = subtract(b.axisLocation, a.axisLocation);
  const cross = crossProduct(delta, a.axisDirection);

  return vectorLength(cross) <= tolerance;
}

function uniqueRounded(values: number[], tolerance: number): number[] {
  const unique: number[] = [];

  for (const value of values) {
    if (!unique.some((existing) => Math.abs(existing - value) <= tolerance)) {
      unique.push(value);
    }
  }

  return unique;
}

function readCylinderInfo(adaptor: BRepAdaptor_Surface): NonNullable<FaceInfo['cylinder']> {
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
      axisDirection: toVec3(direction),
      angleSpanRad: adaptor.LastUParameter() - adaptor.FirstUParameter(),
      heightSpanV: adaptor.LastVParameter() - adaptor.FirstVParameter(),
    };
  } finally {
    safeDelete(direction);
    safeDelete(location);
    safeDelete(axis);
    safeDelete(cylinder);
  }
}

function getTopAbsExplorerEnums(oc: OpenCascadeInstance): TopAbsExplorerEnums {
  return oc.TopAbs_ShapeEnum as unknown as TopAbsExplorerEnums;
}

function mapSurfaceType(oc: OpenCascadeInstance, surfaceType: unknown): FaceInfo['surfaceType'] {
  if (surfaceType === oc.GeomAbs_SurfaceType.GeomAbs_Plane) return 'plane';
  if (surfaceType === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) return 'cylinder';
  if (surfaceType === oc.GeomAbs_SurfaceType.GeomAbs_Cone) return 'cone';
  if (surfaceType === oc.GeomAbs_SurfaceType.GeomAbs_Torus) return 'torus';
  if (surfaceType === oc.GeomAbs_SurfaceType.GeomAbs_BSplineSurface) return 'bspline';
  return 'other';
}

function getReturnStatusName(oc: OpenCascadeInstance, status: unknown): string {
  for (const [name, value] of Object.entries(oc.IFSelect_ReturnStatus)) {
    if (value === status) {
      return name;
    }
  }

  return 'unknown';
}

function toVec3(point: { X(): number; Y(): number; Z(): number }): Vec3 {
  return {
    x: point.X(),
    y: point.Y(),
    z: point.Z(),
  };
}

function canonicalDirection(direction: Vec3): Vec3 {
  if (
    direction.x < 0 ||
    (direction.x === 0 && direction.y < 0) ||
    (direction.x === 0 && direction.y === 0 && direction.z < 0)
  ) {
    return scale(direction, -1);
  }

  return direction;
}

function normalize(vector: Vec3): Vec3 {
  const length = vectorLength(vector);

  if (length === 0) {
    return vector;
  }

  return scale(vector, 1 / length);
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

function vectorLength(vector: Vec3): number {
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
}

function distance(a: Vec3, b: Vec3): number {
  return vectorLength(subtract(a, b));
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function safeDelete(value: Deletable | null | undefined): void {
  if (value) {
    value.delete();
  }
}
