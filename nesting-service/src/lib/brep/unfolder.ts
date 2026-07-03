import {
  ensureClockwise,
  ensureCounterClockwise,
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

const AREA_TOLERANCE = 0.03;

export function unfoldPart(topology: SheetMetalTopology, kFactor: number): UnfoldedPartContour | null {
  const ordered = orderFlanges(topology);
  if (!ordered) {
    return null;
  }

  const length = Math.max(...ordered.flanges.map((item) => item.flange.length));
  let cursorY = 0;
  const holes: Point2D[][] = [];

  for (const item of ordered.flanges) {
    const { flange } = item;
    const hasBend = item.incomingBend !== null || item.outgoingBend !== null;
    if (hasBend && hasHoleInBendZone(flange)) {
      return null;
    }

    const flipY = shouldFlipFlangeForUnfold(item);
    holes.push(...flange.holes.map((hole) => translateHole(orientHole(hole, flange.width, flipY), cursorY)));
    cursorY += flange.width;

    const nextBend = ordered.bends.find((item) => item.afterFlangeId === flange.id);
    if (nextBend) {
      cursorY += bendAllowance(nextBend.bend, topology.thickness, kFactor);
    }
  }

  const width = roundMm(length, 100);
  const height = roundMm(cursorY, 100);
  const contour = ensureClockwise([
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
    { x: 0, y: 0 },
  ]);
  const orientedHoles = holes.map(ensureCounterClockwise);
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

  const start = topology.flanges.find((flange) => adjacency.get(flange.id)?.length === 1);
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
