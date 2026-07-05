import * as fs from 'node:fs';
import * as path from 'node:path';
import { getOCC } from '../src/lib/brep/occ-loader';
import type {
  BRepBuilderAPI_MakeEdge,
  BRepBuilderAPI_MakeWire,
  BRepAlgoAPI_Cut,
  BRepPrimAPI_MakeCylinder,
  gp_Ax2,
  gp_Circ,
  gp_Dir,
  gp_Pnt,
  gp_Vec,
  Message_ProgressRange,
  OpenCascadeInstance,
  TopoDS_Edge,
  TopoDS_Face,
  TopoDS_Shape,
  TopoDS_Wire,
} from 'opencascade.js/dist/node';

type Deletable = {
  delete(): void;
};

type Point3 = [number, number, number];

const FIXTURE_DIR = path.resolve(__dirname, '../src/lib/__tests__/fixtures');
const FIXED_STEP_TIMESTAMP = '2026-01-01T00:00:00';

async function main(): Promise<void> {
  const oc = await getOCC();
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  writeStep(oc, createPlateWithHoles(oc), path.join(FIXTURE_DIR, 'plate_100x50x3_two_holes.step'));
  writeStep(oc, createRoundedPlate(oc), path.join(FIXTURE_DIR, 'rounded_plate_80x80x2_r15.step'));
  writeStep(oc, createLAngle(oc), path.join(FIXTURE_DIR, 'l_angle_100x40x40x2.step'));
  writeStep(oc, createUChannel(oc), path.join(FIXTURE_DIR, 'u_channel_100x40x40_t2_r3.step'));
  writeStep(oc, createZProfile(oc), path.join(FIXTURE_DIR, 'z_profile_100x40x40_t2_r3.step'));
  writeStep(oc, createRadiusLAngleWithHoles(oc), path.join(FIXTURE_DIR, 'l_angle_100x40x40_t2_r3_holes.step'));
  writeStep(oc, createBoxCycle(oc), path.join(FIXTURE_DIR, 'box_cycle_100x40x40_t2_r3.step'));
  writeStep(oc, createPlateWithHalfEdgeHole(oc), path.join(FIXTURE_DIR, 'plate_100x50x3_half_edge_hole_r6.step'));
  writeStep(oc, createPlateWithSlot(oc), path.join(FIXTURE_DIR, 'plate_100x50x3_slot_30x10.step'));
  writeStep(oc, createPlateWithEdgeFillet(oc), path.join(FIXTURE_DIR, 'plate_100x50x2_edge_fillet_r1.step'));

  console.log(`[fixtures] STEP fixtures written to ${FIXTURE_DIR}`);
}

function createPlateWithHoles(oc: OpenCascadeInstance): TopoDS_Shape {
  const outer = makePolygonWire(oc, [
    [0, 0, 0],
    [100, 0, 0],
    [100, 50, 0],
    [0, 50, 0],
  ]);
  const holes = [
    makeCircleWire(oc, 35, 25, 0, 5),
    makeCircleWire(oc, 65, 25, 0, 5),
  ];

  return extrudeFace(oc, makeFaceWithHoles(oc, outer, holes), [0, 0, 3]);
}

function createRoundedPlate(oc: OpenCascadeInstance): TopoDS_Shape {
  const outer = makeRoundedRectWire(oc, 80, 80, 15);
  return extrudeFace(oc, makeFaceWithHoles(oc, outer, []), [0, 0, 2]);
}

function createPlateWithHalfEdgeHole(oc: OpenCascadeInstance): TopoDS_Shape {
  const outer = makePolygonWire(oc, [
    [0, 0, 0],
    [100, 0, 0],
    [100, 50, 0],
    [0, 50, 0],
  ]);
  const plate = extrudeFace(oc, makeFaceWithHoles(oc, outer, []), [0, 0, 3]);

  return cutCylindricalHoles(oc, plate, [
    { center: [0, 25, -1], direction: [0, 0, 1], radius: 6, depth: 5 },
  ]);
}

function createPlateWithSlot(oc: OpenCascadeInstance): TopoDS_Shape {
  const outer = makePolygonWire(oc, [
    [0, 0, 0],
    [100, 0, 0],
    [100, 50, 0],
    [0, 50, 0],
  ]);
  const slot = makeSlotWire(oc, 50, 25, 30, 10);
  slot.Reverse();

  return extrudeFace(oc, makeFaceWithHoles(oc, outer, [slot]), [0, 0, 3]);
}

function createPlateWithEdgeFillet(oc: OpenCascadeInstance): TopoDS_Shape {
  const profile = makeWireFromEdges(oc, [
    makeLineEdge(oc, [0, 0, 0], [0, 50, 0]),
    makeLineEdge(oc, [0, 50, 0], [0, 50, 1]),
    makeArcEdgeYZ(oc, 49, 1, 1, 0, Math.PI / 2),
    makeLineEdge(oc, [0, 49, 2], [0, 0, 2]),
    makeLineEdge(oc, [0, 0, 2], [0, 0, 0]),
  ]);

  return extrudeFace(oc, makeFaceWithHoles(oc, profile, []), [100, 0, 0]);
}

function createLAngle(oc: OpenCascadeInstance): TopoDS_Shape {
  const profile = makePolygonWire(oc, [
    [0, 0, 0],
    [0, 40, 0],
    [0, 40, 2],
    [0, 2, 2],
    [0, 2, 40],
    [0, 0, 40],
  ]);

  return extrudeFace(oc, makeFaceWithHoles(oc, profile, []), [100, 0, 0]);
}

function createRadiusLAngleWithHoles(oc: OpenCascadeInstance): TopoDS_Shape {
  const t = 2;
  const r = 3;
  const leg = 40;
  const length = 100;
  const profile = makeLProfileWireYZ(oc, leg, t, r);
  const bent = extrudeFace(oc, makeFaceWithHoles(oc, profile, []), [length, 0, 0]);

  return cutCylindricalHoles(
    oc,
    bent,
    [
      { center: [30, r + 18, -t - 2], direction: [0, 0, 1], radius: 4, depth: t + 4 },
      { center: [70, r + 18, -t - 2], direction: [0, 0, 1], radius: 4, depth: t + 4 },
    ]
  );
}

function createUChannel(oc: OpenCascadeInstance): TopoDS_Shape {
  const profile = makeUProfileWireYZ(oc, 40, 40, 2, 3);
  return extrudeFace(oc, makeFaceWithHoles(oc, profile, []), [100, 0, 0]);
}

function createZProfile(oc: OpenCascadeInstance): TopoDS_Shape {
  const profile = makeZProfileWireYZ(oc, 40, 40, 40, 2, 3);
  return extrudeFace(oc, makeFaceWithHoles(oc, profile, []), [100, 0, 0]);
}

function createBoxCycle(oc: OpenCascadeInstance): TopoDS_Shape {
  const t = 2;
  const r = 3;
  const width = 40;
  const height = 40;
  const outer = makeRoundedRectWireYZ(oc, width + 2 * t, height + 2 * t, r + t, -t, -t);
  const inner = makeRoundedRectWireYZ(oc, width, height, r, 0, 0);
  inner.Reverse();

  return extrudeFace(oc, makeFaceWithHoles(oc, outer, [inner]), [100, 0, 0]);
}

function makeLProfileWireYZ(oc: OpenCascadeInstance, leg: number, thickness: number, radius: number): TopoDS_Wire {
  return makeWireFromEdges(oc, [
    makeLineEdge(oc, [0, 0, radius + leg], [0, 0, radius]),
    makeArcEdgeYZ(oc, radius, radius, radius, Math.PI, Math.PI * 1.5),
    makeLineEdge(oc, [0, radius, 0], [0, radius + leg, 0]),
    makeLineEdge(oc, [0, radius + leg, 0], [0, radius + leg, -thickness]),
    makeLineEdge(oc, [0, radius + leg, -thickness], [0, radius, -thickness]),
    makeArcEdgeYZReversed(oc, radius, radius, radius + thickness, -Math.PI / 2, -Math.PI),
    makeLineEdge(oc, [0, -thickness, radius], [0, -thickness, radius + leg]),
    makeLineEdge(oc, [0, -thickness, radius + leg], [0, 0, radius + leg]),
  ]);
}

function makeUProfileWireYZ(
  oc: OpenCascadeInstance,
  baseWidth: number,
  flangeHeight: number,
  thickness: number,
  radius: number
): TopoDS_Wire {
  return makeWireFromEdges(oc, [
    makeLineEdge(oc, [0, 0, radius + flangeHeight], [0, 0, radius]),
    makeArcEdgeYZ(oc, radius, radius, radius, Math.PI, Math.PI * 1.5),
    makeLineEdge(oc, [0, radius, 0], [0, baseWidth - radius, 0]),
    makeArcEdgeYZ(oc, baseWidth - radius, radius, radius, Math.PI * 1.5, Math.PI * 2),
    makeLineEdge(oc, [0, baseWidth, radius], [0, baseWidth, radius + flangeHeight]),
    makeLineEdge(oc, [0, baseWidth, radius + flangeHeight], [0, baseWidth + thickness, radius + flangeHeight]),
    makeLineEdge(oc, [0, baseWidth + thickness, radius + flangeHeight], [0, baseWidth + thickness, radius]),
    makeArcEdgeYZReversed(oc, baseWidth - radius, radius, radius + thickness, 0, -Math.PI / 2),
    makeLineEdge(oc, [0, baseWidth - radius, -thickness], [0, radius, -thickness]),
    makeArcEdgeYZReversed(oc, radius, radius, radius + thickness, -Math.PI / 2, -Math.PI),
    makeLineEdge(oc, [0, -thickness, radius], [0, -thickness, radius + flangeHeight]),
    makeLineEdge(oc, [0, -thickness, radius + flangeHeight], [0, 0, radius + flangeHeight]),
  ]);
}

function makeZProfileWireYZ(
  oc: OpenCascadeInstance,
  lowerFlange: number,
  webHeight: number,
  upperFlange: number,
  thickness: number,
  radius: number
): TopoDS_Wire {
  return makeWireFromEdges(oc, [
    makeLineEdge(oc, [0, lowerFlange - upperFlange, webHeight], [0, lowerFlange, webHeight]),
    makeArcEdgeYZ(oc, lowerFlange, webHeight - radius, radius, Math.PI / 2, 0),
    makeLineEdge(oc, [0, lowerFlange + radius, webHeight - radius], [0, lowerFlange + radius, radius]),
    makeArcEdgeYZ(oc, lowerFlange, radius, radius, 0, -Math.PI / 2),
    makeLineEdge(oc, [0, lowerFlange, 0], [0, 0, 0]),
    makeLineEdge(oc, [0, 0, 0], [0, 0, -thickness]),
    makeLineEdge(oc, [0, 0, -thickness], [0, lowerFlange, -thickness]),
    makeArcEdgeYZ(oc, lowerFlange, radius, radius + thickness, -Math.PI / 2, 0),
    makeLineEdge(oc, [0, lowerFlange + radius + thickness, radius], [0, lowerFlange + radius + thickness, webHeight - radius]),
    makeArcEdgeYZ(oc, lowerFlange, webHeight - radius, radius + thickness, 0, Math.PI / 2),
    makeLineEdge(oc, [0, lowerFlange, webHeight + thickness], [0, lowerFlange - upperFlange, webHeight + thickness]),
    makeLineEdge(oc, [0, lowerFlange - upperFlange, webHeight + thickness], [0, lowerFlange - upperFlange, webHeight]),
  ]);
}

function makePolygonWire(oc: OpenCascadeInstance, points: Point3[]): TopoDS_Wire {
  let builder: import('opencascade.js/dist/node').BRepBuilderAPI_MakePolygon | null = null;
  const occPoints: gp_Pnt[] = [];

  try {
    builder = new oc.BRepBuilderAPI_MakePolygon_1();
    for (const [x, y, z] of points) {
      const point = new oc.gp_Pnt_3(x, y, z);
      occPoints.push(point);
      builder.Add_1(point);
    }
    builder.Close();

    if (!builder.IsDone()) {
      throw new Error('Failed to create polygon wire');
    }

    return builder.Wire();
  } finally {
    for (const point of occPoints) {
      safeDelete(point);
    }
    safeDelete(builder);
  }
}

function makeRoundedRectWire(oc: OpenCascadeInstance, width: number, height: number, radius: number): TopoDS_Wire {
  let wireBuilder: BRepBuilderAPI_MakeWire | null = null;
  const edges: TopoDS_Edge[] = [];

  try {
    wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
    edges.push(
      makeLineEdge(oc, [radius, 0, 0], [width - radius, 0, 0]),
      makeArcEdge(oc, width - radius, radius, 0, radius, -Math.PI / 2, 0),
      makeLineEdge(oc, [width, radius, 0], [width, height - radius, 0]),
      makeArcEdge(oc, width - radius, height - radius, 0, radius, 0, Math.PI / 2),
      makeLineEdge(oc, [width - radius, height, 0], [radius, height, 0]),
      makeArcEdge(oc, radius, height - radius, 0, radius, Math.PI / 2, Math.PI),
      makeLineEdge(oc, [0, height - radius, 0], [0, radius, 0]),
      makeArcEdge(oc, radius, radius, 0, radius, Math.PI, Math.PI * 1.5)
    );

    for (const edge of edges) {
      wireBuilder.Add_1(edge);
    }

    if (!wireBuilder.IsDone()) {
      throw new Error('Failed to create rounded rectangle wire');
    }

    return wireBuilder.Wire();
  } finally {
    for (const edge of edges) {
      safeDelete(edge);
    }
    safeDelete(wireBuilder);
  }
}

function makeSlotWire(
  oc: OpenCascadeInstance,
  centerX: number,
  centerY: number,
  length: number,
  width: number
): TopoDS_Wire {
  const radius = width / 2;
  const straight = length - width;
  const leftX = centerX - straight / 2;
  const rightX = centerX + straight / 2;

  return makeWireFromEdges(oc, [
    makeLineEdge(oc, [leftX, centerY + radius, 0], [rightX, centerY + radius, 0]),
    makeArcEdge(oc, rightX, centerY, 0, radius, Math.PI / 2, -Math.PI / 2),
    makeLineEdge(oc, [rightX, centerY - radius, 0], [leftX, centerY - radius, 0]),
    makeArcEdge(oc, leftX, centerY, 0, radius, -Math.PI / 2, Math.PI / 2),
  ]);
}

function makeRoundedRectWireYZ(
  oc: OpenCascadeInstance,
  width: number,
  height: number,
  radius: number,
  offsetY: number,
  offsetZ: number
): TopoDS_Wire {
  return makeWireFromEdges(oc, [
    makeLineEdge(oc, [0, offsetY + radius, offsetZ], [0, offsetY + width - radius, offsetZ]),
    makeArcEdgeYZ(oc, offsetY + width - radius, offsetZ + radius, radius, -Math.PI / 2, 0),
    makeLineEdge(oc, [0, offsetY + width, offsetZ + radius], [0, offsetY + width, offsetZ + height - radius]),
    makeArcEdgeYZ(oc, offsetY + width - radius, offsetZ + height - radius, radius, 0, Math.PI / 2),
    makeLineEdge(oc, [0, offsetY + width - radius, offsetZ + height], [0, offsetY + radius, offsetZ + height]),
    makeArcEdgeYZ(oc, offsetY + radius, offsetZ + height - radius, radius, Math.PI / 2, Math.PI),
    makeLineEdge(oc, [0, offsetY, offsetZ + height - radius], [0, offsetY, offsetZ + radius]),
    makeArcEdgeYZ(oc, offsetY + radius, offsetZ + radius, radius, Math.PI, Math.PI * 1.5),
  ]);
}

function makeWireFromEdges(oc: OpenCascadeInstance, edges: TopoDS_Edge[]): TopoDS_Wire {
  let wireBuilder: BRepBuilderAPI_MakeWire | null = null;

  try {
    wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
    for (const edge of edges) {
      wireBuilder.Add_1(edge);
    }

    if (!wireBuilder.IsDone()) {
      throw new Error('Failed to create wire from edges');
    }

    return wireBuilder.Wire();
  } finally {
    for (const edge of edges) {
      safeDelete(edge);
    }
    safeDelete(wireBuilder);
  }
}

function makeLineEdge(oc: OpenCascadeInstance, from: Point3, to: Point3): TopoDS_Edge {
  let p1: gp_Pnt | null = null;
  let p2: gp_Pnt | null = null;
  let edgeBuilder: BRepBuilderAPI_MakeEdge | null = null;

  try {
    p1 = new oc.gp_Pnt_3(...from);
    p2 = new oc.gp_Pnt_3(...to);
    edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);

    if (!edgeBuilder.IsDone()) {
      throw new Error('Failed to create line edge');
    }

    return edgeBuilder.Edge();
  } finally {
    safeDelete(edgeBuilder);
    safeDelete(p2);
    safeDelete(p1);
  }
}

function makeArcEdge(
  oc: OpenCascadeInstance,
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
  startAngle: number,
  endAngle: number
): TopoDS_Edge {
  let center: gp_Pnt | null = null;
  let normal: gp_Dir | null = null;
  let xDirection: gp_Dir | null = null;
  let axis: gp_Ax2 | null = null;
  let circle: gp_Circ | null = null;
  let edgeBuilder: BRepBuilderAPI_MakeEdge | null = null;

  try {
    center = new oc.gp_Pnt_3(centerX, centerY, centerZ);
    normal = new oc.gp_Dir_4(0, 0, 1);
    xDirection = new oc.gp_Dir_4(1, 0, 0);
    axis = new oc.gp_Ax2_2(center, normal, xDirection);
    circle = new oc.gp_Circ_2(axis, radius);
    edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_9(circle, startAngle, endAngle);

    if (!edgeBuilder.IsDone()) {
      throw new Error('Failed to create arc edge');
    }

    return edgeBuilder.Edge();
  } finally {
    safeDelete(edgeBuilder);
    safeDelete(circle);
    safeDelete(axis);
    safeDelete(xDirection);
    safeDelete(normal);
    safeDelete(center);
  }
}

function makeArcEdgeYZ(
  oc: OpenCascadeInstance,
  centerY: number,
  centerZ: number,
  radius: number,
  startAngle: number,
  endAngle: number
): TopoDS_Edge {
  let center: gp_Pnt | null = null;
  let normal: gp_Dir | null = null;
  let xDirection: gp_Dir | null = null;
  let axis: gp_Ax2 | null = null;
  let circle: gp_Circ | null = null;
  let edgeBuilder: BRepBuilderAPI_MakeEdge | null = null;

  try {
    center = new oc.gp_Pnt_3(0, centerY, centerZ);
    normal = new oc.gp_Dir_4(1, 0, 0);
    xDirection = new oc.gp_Dir_4(0, 1, 0);
    axis = new oc.gp_Ax2_2(center, normal, xDirection);
    circle = new oc.gp_Circ_2(axis, radius);
    edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_9(circle, startAngle, endAngle);

    if (!edgeBuilder.IsDone()) {
      throw new Error('Failed to create YZ arc edge');
    }

    return edgeBuilder.Edge();
  } finally {
    safeDelete(edgeBuilder);
    safeDelete(circle);
    safeDelete(axis);
    safeDelete(xDirection);
    safeDelete(normal);
    safeDelete(center);
  }
}

function makeArcEdgeYZReversed(
  oc: OpenCascadeInstance,
  centerY: number,
  centerZ: number,
  radius: number,
  startAngle: number,
  endAngle: number
): TopoDS_Edge {
  const edge = makeArcEdgeYZ(oc, centerY, centerZ, radius, endAngle, startAngle);
  edge.Reverse();
  return edge;
}

function cutCylindricalHoles(
  oc: OpenCascadeInstance,
  shape: TopoDS_Shape,
  holes: Array<{ center: Point3; direction: Point3; radius: number; depth: number }>
): TopoDS_Shape {
  let result = shape;

  for (const hole of holes) {
    let cutter: TopoDS_Shape | null = null;
    let progress: Message_ProgressRange | null = null;
    let cut: BRepAlgoAPI_Cut | null = null;

    try {
      cutter = makeCylinder(oc, hole.center, hole.direction, hole.radius, hole.depth);
      progress = new oc.Message_ProgressRange_1();
      cut = new oc.BRepAlgoAPI_Cut_3(result, cutter, progress);
      result = cut.Shape();
    } finally {
      safeDelete(cut);
      safeDelete(progress);
      safeDelete(cutter);
    }
  }

  return result;
}

function makeCylinder(
  oc: OpenCascadeInstance,
  center: Point3,
  direction: Point3,
  radius: number,
  depth: number
): TopoDS_Shape {
  let origin: gp_Pnt | null = null;
  let normal: gp_Dir | null = null;
  let xDirection: gp_Dir | null = null;
  let axis: gp_Ax2 | null = null;
  let cylinder: BRepPrimAPI_MakeCylinder | null = null;

  try {
    origin = new oc.gp_Pnt_3(...center);
    normal = new oc.gp_Dir_4(...direction);
    xDirection = new oc.gp_Dir_4(1, 0, 0);
    axis = new oc.gp_Ax2_2(origin, normal, xDirection);
    cylinder = new oc.BRepPrimAPI_MakeCylinder_3(axis, radius, depth);
    return cylinder.Shape();
  } finally {
    safeDelete(cylinder);
    safeDelete(axis);
    safeDelete(xDirection);
    safeDelete(normal);
    safeDelete(origin);
  }
}

function makeCircleWire(
  oc: OpenCascadeInstance,
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number
): TopoDS_Wire {
  let center: gp_Pnt | null = null;
  let normal: gp_Dir | null = null;
  let xDirection: gp_Dir | null = null;
  let axis: gp_Ax2 | null = null;
  let circle: gp_Circ | null = null;
  let edgeBuilder: BRepBuilderAPI_MakeEdge | null = null;
  let wireBuilder: BRepBuilderAPI_MakeWire | null = null;

  try {
    center = new oc.gp_Pnt_3(centerX, centerY, centerZ);
    normal = new oc.gp_Dir_4(0, 0, 1);
    xDirection = new oc.gp_Dir_4(1, 0, 0);
    axis = new oc.gp_Ax2_2(center, normal, xDirection);
    circle = new oc.gp_Circ_2(axis, radius);
    edgeBuilder = new oc.BRepBuilderAPI_MakeEdge_8(circle);
    wireBuilder = new oc.BRepBuilderAPI_MakeWire_2(edgeBuilder.Edge());
    const wire = wireBuilder.Wire();
    wire.Reverse();
    return wire;
  } finally {
    safeDelete(wireBuilder);
    safeDelete(edgeBuilder);
    safeDelete(circle);
    safeDelete(axis);
    safeDelete(xDirection);
    safeDelete(normal);
    safeDelete(center);
  }
}

function makeFaceWithHoles(oc: OpenCascadeInstance, outer: TopoDS_Wire, holes: TopoDS_Wire[]): TopoDS_Face {
  let faceBuilder: import('opencascade.js/dist/node').BRepBuilderAPI_MakeFace | null = null;

  try {
    faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(outer, true);
    for (const hole of holes) {
      faceBuilder.Add(hole);
    }

    if (!faceBuilder.IsDone()) {
      throw new Error('Failed to create face');
    }

    return faceBuilder.Face();
  } finally {
    safeDelete(faceBuilder);
    safeDelete(outer);
    for (const hole of holes) {
      safeDelete(hole);
    }
  }
}

function extrudeFace(oc: OpenCascadeInstance, face: TopoDS_Face, vector: Point3): TopoDS_Shape {
  let vec: gp_Vec | null = null;
  let prism: import('opencascade.js/dist/node').BRepPrimAPI_MakePrism | null = null;

  try {
    vec = new oc.gp_Vec_4(...vector);
    prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true);
    return prism.Shape();
  } finally {
    safeDelete(prism);
    safeDelete(vec);
    safeDelete(face);
  }
}

function writeStep(oc: OpenCascadeInstance, shape: TopoDS_Shape, outputPath: string): void {
  const internalPath = `/phase1-${path.basename(outputPath)}`;
  let writer: import('opencascade.js/dist/node').STEPControl_Writer | null = null;
  let progress: Message_ProgressRange | null = null;

  try {
    writer = new oc.STEPControl_Writer_1();
    progress = new oc.Message_ProgressRange_1();
    const transferStatus = writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress);

    if (transferStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`STEP transfer failed for ${outputPath}`);
    }

    const writeStatus = writer.Write(internalPath);
    if (writeStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`STEP write failed for ${outputPath}`);
    }

    const bytes = oc.FS.readFile(internalPath) as Uint8Array;
    const content = normalizeStepFixture(Buffer.from(bytes).toString('utf8'));
    fs.writeFileSync(outputPath, content, 'utf8');
    oc.FS.unlink(internalPath);
  } finally {
    safeDelete(progress);
    safeDelete(writer);
    safeDelete(shape);
  }
}

function normalizeStepFixture(content: string): string {
  return content
    .replace(/FILE_NAME\(([^,]+),'[^']*'/, `FILE_NAME($1,'${FIXED_STEP_TIMESTAMP}'`)
    .replace(/[ \t]+$/gm, '');
}

function safeDelete(value: Deletable | null | undefined): void {
  if (value) {
    value.delete();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
