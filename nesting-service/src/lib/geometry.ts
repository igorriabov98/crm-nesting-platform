export interface BBox3D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface SheetMetalInfo {
  isSheetMetal: boolean;
  thickness: number;
  projectionAxis: 'x' | 'y' | 'z';
  confidence: number;
}

export type ClassificationMethod = 'bbox' | 'normals' | 'volume_area' | 'heuristic';

export interface TriangleNormal {
  nx: number;
  ny: number;
  nz: number;
  area: number;
}

export interface NormalCluster {
  nx: number;
  ny: number;
  nz: number;
  totalArea: number;
  count: number;
}

export interface SheetMetalInfoV2 extends SheetMetalInfo {
  method: ClassificationMethod;
  hasBends: boolean;
  warnings: string[];
  developedBlank?: DevelopedBlankInfo;
}

export interface DevelopedBlankInfo {
  width: number;
  height: number;
  contour: Point2D[];
}

type ThinWallPlaneGroup = {
  projection: number;
  area: number;
};

type ThinWallOrientation = {
  normal: [number, number, number];
  totalArea: number;
  planes: ThinWallPlaneGroup[];
  candidateGaps: number[];
};

type ThinWallProfileInfo = {
  candidateThicknesses: number[];
  uniform: boolean;
  minThickness: number | null;
  maxThickness: number | null;
  closedTube: boolean;
};

type Axis = 'x' | 'y' | 'z';

const POINT_EPSILON = 0.01;
const CHAIN_EPSILON = 0.02;
const RDP_EPSILON = 1e-9;
const THIN_WALL_MIN_MM = 0.5;
const THIN_WALL_MAX_MM = 12;
const THIN_WALL_UNIFORM_TOLERANCE = 0.05;
const THIN_WALL_NORMAL_COS = Math.cos(10 * Math.PI / 180);
const THIN_WALL_PLANE_TOLERANCE_MM = 0.15;
const THIN_WALL_MIN_PLANE_AREA_RATIO = 0.01;
const STANDARD_THICKNESSES = [
  0.5, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30,
];

export function computeBoundingBox(positions: Float32Array): BBox3D {
  if (positions.length === 0) {
    throw new Error('Position array is empty.');
  }

  if (positions.length % 3 !== 0) {
    throw new Error('Position array length must be divisible by 3.');
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let validVertices = 0;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    validVertices += 1;
  }

  if (validVertices === 0) {
    throw new Error('Position array contains no valid vertices.');
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    sizeX: maxX - minX,
    sizeY: maxY - minY,
    sizeZ: maxZ - minZ,
  };
}

export function classifySheetMetal(bbox: BBox3D, threshold = 0.15): SheetMetalInfo {
  const dimensions: Array<{ axis: Axis; size: number }> = [
    { axis: 'x', size: bbox.sizeX },
    { axis: 'y', size: bbox.sizeY },
    { axis: 'z', size: bbox.sizeZ },
  ];

  dimensions.sort((a, b) => a.size - b.size);

  const minDim = dimensions[0];
  const maxDim = dimensions[2];

  if (minDim.size <= 0 || maxDim.size <= 0) {
    return {
      isSheetMetal: false,
      thickness: Math.max(minDim.size, 0),
      projectionAxis: minDim.axis,
      confidence: 0,
    };
  }

  const ratio = minDim.size / maxDim.size;
  let confidence = 0.3;

  if (ratio < 0.05) {
    confidence = 0.95;
  } else if (ratio < 0.1) {
    confidence = 0.85;
  } else if (ratio < threshold) {
    confidence = 0.7;
  }

  return {
    isSheetMetal: ratio < threshold,
    thickness: roundToStandardThickness(minDim.size),
    projectionAxis: minDim.axis,
    confidence,
  };
}

export function extractTriangleNormals(positions: Float32Array, indices: Uint32Array): TriangleNormal[] {
  const normals: TriangleNormal[] = [];

  for (let i = 0; i < indices.length; i += 3) {
    const [i0, i1, i2] = [indices[i], indices[i + 1], indices[i + 2]];
    if (!isValidTriangleIndex(positions, i0) || !isValidTriangleIndex(positions, i1) || !isValidTriangleIndex(positions, i2)) {
      continue;
    }

    const ax = positions[i0 * 3];
    const ay = positions[i0 * 3 + 1];
    const az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3];
    const by = positions[i1 * 3 + 1];
    const bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3];
    const cy = positions[i2 * 3 + 1];
    const cz = positions[i2 * 3 + 2];

    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;

    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);

    if (len < 1e-10) {
      continue;
    }

    nx /= len;
    ny /= len;
    nz /= len;
    normals.push({ nx, ny, nz, area: len / 2 });
  }

  return normals;
}

export function clusterNormals(normals: TriangleNormal[], angleTolerance = 15): NormalCluster[] {
  const cosThreshold = Math.cos(angleTolerance * Math.PI / 180);
  const clusters: NormalCluster[] = [];

  for (const normal of normals) {
    let cluster = clusters.find((candidate) =>
      normal.nx * candidate.nx + normal.ny * candidate.ny + normal.nz * candidate.nz > cosThreshold
    );

    if (!cluster) {
      clusters.push({
        nx: normal.nx,
        ny: normal.ny,
        nz: normal.nz,
        totalArea: normal.area,
        count: 1,
      });
      continue;
    }

    const nextArea = cluster.totalArea + normal.area;
    cluster.nx = (cluster.nx * cluster.totalArea + normal.nx * normal.area) / nextArea;
    cluster.ny = (cluster.ny * cluster.totalArea + normal.ny * normal.area) / nextArea;
    cluster.nz = (cluster.nz * cluster.totalArea + normal.nz * normal.area) / nextArea;

    const len = Math.hypot(cluster.nx, cluster.ny, cluster.nz);
    if (len > 1e-10) {
      cluster.nx /= len;
      cluster.ny /= len;
      cluster.nz /= len;
    }

    cluster.totalArea = nextArea;
    cluster.count += 1;
  }

  return clusters.sort((a, b) => b.totalArea - a.totalArea);
}

export function findDominantPlanePair(
  normals: TriangleNormal[],
  positions: Float32Array,
  angleTolerance = 15
): { found: boolean; axis: Axis; thickness: number; coverage: number } {
  const clusters = clusterNormals(normals, angleTolerance);
  const totalArea = normals.reduce((sum, normal) => sum + normal.area, 0);

  if (clusters.length < 2 || totalArea <= 0) {
    return { found: false, axis: 'z', thickness: 0, coverage: 0 };
  }

  for (let i = 0; i < Math.min(clusters.length, 3); i += 1) {
    for (let j = i + 1; j < Math.min(clusters.length, 5); j += 1) {
      const a = clusters[i];
      const b = clusters[j];
      const dot = a.nx * b.nx + a.ny * b.ny + a.nz * b.nz;

      if (dot > -0.85) {
        continue;
      }

      const coverage = (a.totalArea + b.totalArea) / totalArea;
      if (coverage < 0.3) {
        continue;
      }

      const axis = dominantAxis(a);
      let minProjection = Infinity;
      let maxProjection = -Infinity;

      for (let k = 0; k < positions.length; k += 3) {
        const x = positions[k];
        const y = positions[k + 1];
        const z = positions[k + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          continue;
        }

        const projection = x * a.nx + y * a.ny + z * a.nz;
        minProjection = Math.min(minProjection, projection);
        maxProjection = Math.max(maxProjection, projection);
      }

      if (!Number.isFinite(minProjection) || !Number.isFinite(maxProjection)) {
        continue;
      }

      return {
        found: true,
        axis,
        thickness: maxProjection - minProjection,
        coverage,
      };
    }
  }

  return { found: false, axis: 'z', thickness: 0, coverage: 0 };
}

export function computeMeshArea(positions: Float32Array, indices: Uint32Array): number {
  return extractTriangleNormals(positions, indices).reduce((sum, normal) => sum + normal.area, 0);
}

export function computeMeshVolume(positions: Float32Array, indices: Uint32Array): number {
  const triangles: Array<[number, number, number]> = [];
  const edgeMap = new Map<string, Array<{ triangleIndex: number; direction: 1 | -1 }>>();

  for (let i = 0; i < indices.length; i += 3) {
    const [i0, i1, i2] = [indices[i], indices[i + 1], indices[i + 2]];
    if (!isValidTriangleIndex(positions, i0) || !isValidTriangleIndex(positions, i1) || !isValidTriangleIndex(positions, i2)) {
      continue;
    }

    const triangleIndex = triangles.length;
    triangles.push([i0, i1, i2]);
    for (const [from, to] of triangleEdges(i0, i1, i2)) {
      const key = edgeKey(from, to);
      const direction: 1 | -1 = from < to ? 1 : -1;
      const entries = edgeMap.get(key) ?? [];
      entries.push({ triangleIndex, direction });
      edgeMap.set(key, entries);
    }
  }

  if (triangles.length === 0) {
    return 0;
  }

  const flipped: Array<boolean | undefined> = new Array(triangles.length);
  const componentIds = new Array<number>(triangles.length).fill(-1);
  const componentRefs: Array<[number, number, number]> = [];
  let componentId = 0;

  for (let start = 0; start < triangles.length; start += 1) {
    if (flipped[start] !== undefined) {
      continue;
    }

    flipped[start] = false;
    componentIds[start] = componentId;
    componentRefs[componentId] = vertexAt(positions, triangles[start][0]);
    const queue = [start];

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const currentFlipped = flipped[current] === true;
      const [i0, i1, i2] = triangles[current];

      for (const [from, to] of triangleEdges(i0, i1, i2)) {
        const currentEntry = (edgeMap.get(edgeKey(from, to)) ?? []).find((entry) => entry.triangleIndex === current);
        if (!currentEntry) {
          continue;
        }

        const currentDirection = currentEntry.direction * (currentFlipped ? -1 : 1);
        for (const neighborEntry of edgeMap.get(edgeKey(from, to)) ?? []) {
          if (neighborEntry.triangleIndex === current) {
            continue;
          }

          const neighborMultiplier = -currentDirection * neighborEntry.direction;
          const shouldFlipNeighbor = neighborMultiplier === -1;
          if (flipped[neighborEntry.triangleIndex] === undefined) {
            flipped[neighborEntry.triangleIndex] = shouldFlipNeighbor;
            componentIds[neighborEntry.triangleIndex] = componentId;
            queue.push(neighborEntry.triangleIndex);
          }
        }
      }
    }

    componentId += 1;
  }

  const originalComponentVolumes = new Array(componentId).fill(0);
  const reorientedComponentVolumes = new Array(componentId).fill(0);
  let originSignedVolume = 0;
  for (let index = 0; index < triangles.length; index += 1) {
    const [i0, i1, i2] = triangles[index];
    const ref = componentRefs[componentIds[index]];
    const originA = vertexAt(positions, i0);
    const originB = vertexAt(positions, i1);
    const originC = vertexAt(positions, i2);
    const a = vertexMinusRef(positions, i0, ref);
    const originalB = vertexMinusRef(positions, i1, ref);
    const originalC = vertexMinusRef(positions, i2, ref);
    const reorientedB = vertexMinusRef(positions, flipped[index] ? i2 : i1, ref);
    const reorientedC = vertexMinusRef(positions, flipped[index] ? i1 : i2, ref);

    originSignedVolume += signedTetraVolume(originA, originB, originC);
    originalComponentVolumes[componentIds[index]] += signedTetraVolume(a, originalB, originalC);
    reorientedComponentVolumes[componentIds[index]] += signedTetraVolume(a, reorientedB, reorientedC);
  }

  const bbox = computeBoundingBox(positions);
  const bboxVolume = bbox.sizeX * bbox.sizeY * bbox.sizeZ;
  const originVolume = Math.abs(originSignedVolume);
  const originalVolume = originalComponentVolumes.reduce((sum, volume) => sum + Math.abs(volume), 0);
  const reorientedVolume = reorientedComponentVolumes.reduce((sum, volume) => sum + Math.abs(volume), 0);
  const trustedOriginVolume = bboxVolume > 0 && originVolume <= bboxVolume * 1.01 ? originVolume : 0;
  return Math.max(trustedOriginVolume, originalVolume, reorientedVolume);
}

export function estimateWallThickness(volume: number, area: number): number {
  if (!Number.isFinite(volume) || !Number.isFinite(area) || volume <= 0 || area <= 0) {
    return 0;
  }

  return volume / (area / 2);
}

export function createRectangleContour(width: number, height: number): Point2D[] {
  const roundedWidth = roundBlankSize(width);
  const roundedHeight = roundBlankSize(height);

  return [
    { x: 0, y: 0 },
    { x: roundedWidth, y: 0 },
    { x: roundedWidth, y: roundedHeight },
    { x: 0, y: roundedHeight },
    { x: 0, y: 0 },
  ];
}

export function classifySheetMetalV2(
  bbox: BBox3D,
  positions: Float32Array,
  indices: Uint32Array | null,
  threshold = 0.15
): SheetMetalInfoV2 {
  const dims = sortedDimensions(bbox);
  const minDim = dims[0];
  const midDim = dims[1];
  const maxDim = dims[2];

  if (minDim.size <= 0 || maxDim.size <= 0) {
    return {
      isSheetMetal: false,
      thickness: Math.max(minDim.size, 0),
      projectionAxis: minDim.axis,
      confidence: 0,
      method: 'bbox',
      hasBends: false,
      warnings: [],
    };
  }

  if (maxDim.size < 10) {
    return {
      isSheetMetal: false,
      thickness: minDim.size,
      projectionAxis: minDim.axis,
      confidence: 0.9,
      method: 'bbox',
      hasBends: false,
      warnings: ['Деталь слишком маленькая для классификации листовой раскладки.'],
    };
  }

  const volumeInfo = indices && indices.length >= 3
    ? getVolumeAreaInfo(bbox, positions, indices)
    : null;
  const thinWallInfo = indices && indices.length >= 3
    ? analyzeThinWallProfile(positions, indices)
    : null;
  const ratio = minDim.size / maxDim.size;
  if (ratio >= threshold) {
    if (volumeInfo && isManualThinWallShellCandidate(dims, volumeInfo)) {
      const rejectReason = buildThinWallProfileRejectReason(thinWallInfo);
      if (rejectReason) {
        return {
          isSheetMetal: false,
          thickness: volumeInfo.roundedWall,
          projectionAxis: minDim.axis,
          confidence: 0.75,
          method: 'volume_area',
          hasBends: false,
          warnings: [rejectReason],
        };
      }

      return {
        isSheetMetal: false,
        thickness: volumeInfo.roundedWall,
        projectionAxis: minDim.axis,
        confidence: 0.45,
        method: 'volume_area',
        hasBends: true,
        warnings: [
          `Тонкостенная гнутая оболочка: стенка ${volumeInfo.wallThickness.toFixed(2)}мм по объему/площади, развертка ${volumeInfo.developedBlank.width} x ${volumeInfo.developedBlank.height}мм. Включите как листовую вручную, если нужна раскладка.`,
        ],
        developedBlank: volumeInfo.developedBlank,
      };
    }

    return {
      isSheetMetal: false,
      thickness: roundToStandardThickness(minDim.size),
      projectionAxis: minDim.axis,
      confidence: 0.9,
      method: 'bbox',
      hasBends: false,
      warnings: [],
    };
  }

  if (indices && indices.length >= 3) {
    if (
      volumeInfo &&
      volumeInfo.roundedWall > 0 &&
      volumeInfo.roundedWall <= 12 &&
      volumeInfo.roundedWall < minDim.size * 0.5
    ) {
      const rejectReason = buildThinWallProfileRejectReason(thinWallInfo);
      if (rejectReason) {
        return {
          isSheetMetal: false,
          thickness: volumeInfo.roundedWall,
          projectionAxis: minDim.axis,
          confidence: 0.75,
          method: 'volume_area',
          hasBends: false,
          warnings: [rejectReason],
        };
      }

      const wallThickness = volumeInfo.wallThickness;

      return {
        isSheetMetal: true,
        thickness: volumeInfo.roundedWall,
        projectionAxis: minDim.axis,
        confidence: 0.85,
        method: 'volume_area',
        hasBends: true,
        developedBlank: volumeInfo.developedBlank,
        warnings: [
          `Гнутый профиль: толщина стенки ${wallThickness.toFixed(2)}мм по объему/площади, bbox min ${minDim.size.toFixed(1)}мм.`,
        ],
      };
    }

    const triNormals = extractTriangleNormals(positions, indices);
    if (triNormals.length > 0) {
      const planePair = findDominantPlanePair(triNormals, positions);
      if (planePair.found) {
        const realThickness = planePair.thickness;
        const roundedThickness = roundToStandardThickness(realThickness);

        if (planePair.coverage > 0.55 && roundedThickness > 0 && roundedThickness <= 12) {
          return {
            isSheetMetal: true,
            thickness: roundedThickness,
            projectionAxis: planePair.axis,
            confidence: Math.min(0.95, Math.max(0.7, planePair.coverage)),
            method: Math.abs(roundedThickness - roundToStandardThickness(minDim.size)) < 0.25 ? 'bbox' : 'normals',
            hasBends: false,
            warnings: [],
          };
        }

        if (planePair.coverage > 0.3 && realThickness < minDim.size * 0.5 && roundedThickness > 0 && roundedThickness <= 12) {
          return {
            isSheetMetal: true,
            thickness: roundedThickness,
            projectionAxis: planePair.axis,
            confidence: 0.6,
            method: 'normals',
            hasBends: true,
            warnings: [
              `Вероятно гнутая деталь: толщина по граням ${realThickness.toFixed(2)}мм, bbox min ${minDim.size.toFixed(1)}мм.`,
            ],
          };
        }
      }
    }
  }

  if (minDim.size > 12) {
    if (isCompactThickPlateCandidate(dims)) {
      return {
        isSheetMetal: true,
        thickness: roundToStandardThickness(minDim.size),
        projectionAxis: minDim.axis,
        confidence: 0.8,
        method: 'bbox',
        hasBends: false,
        warnings: [],
      };
    }

    if (midDim.size <= 30) {
      return {
        isSheetMetal: false,
        thickness: roundToStandardThickness(minDim.size),
        projectionAxis: minDim.axis,
        confidence: 0.5,
        method: 'heuristic',
        hasBends: true,
        warnings: [`Профиль: средний размер bbox ${midDim.size.toFixed(1)}мм слишком узкий.`],
      };
    }

    if (midDim.size > 100 && maxDim.size > 100) {
      return {
        isSheetMetal: false,
        thickness: roundToStandardThickness(minDim.size),
        projectionAxis: minDim.axis,
        confidence: 0.3,
        method: 'heuristic',
        hasBends: true,
        warnings: [`Толщина bbox ${minDim.size.toFixed(1)}мм выше листового порога.`],
      };
    }

    return {
      isSheetMetal: true,
      thickness: roundToStandardThickness(minDim.size),
      projectionAxis: minDim.axis,
      confidence: 0.3,
      method: 'heuristic',
      hasBends: true,
      warnings: [`Толщина bbox ${minDim.size.toFixed(1)}мм может быть глубиной профиля, а не толщиной стенки.`],
    };
  }

  const flatRatio = midDim.size / maxDim.size;
  if (flatRatio < 0.04 && midDim.size < 30) {
    return {
      isSheetMetal: true,
      thickness: roundToStandardThickness(minDim.size),
      projectionAxis: minDim.axis,
      confidence: 0.35,
      method: 'heuristic',
      hasBends: true,
      warnings: [`Очень узкая полка профиля: ${midDim.size.toFixed(1)}мм на ${maxDim.size.toFixed(1)}мм.`],
    };
  }

  const confidence = ratio < 0.05 ? 0.95 : ratio < 0.10 ? 0.85 : 0.70;

  return {
    isSheetMetal: true,
    thickness: roundToStandardThickness(minDim.size),
    projectionAxis: minDim.axis,
    confidence,
    method: 'bbox',
    hasBends: false,
    warnings: [],
  };
}

function analyzeThinWallProfile(positions: Float32Array, indices: Uint32Array): ThinWallProfileInfo | null {
  const orientations = collectThinWallOrientations(positions, indices);
  const candidateThicknesses = orientations.flatMap((orientation) => orientation.candidateGaps);
  if (candidateThicknesses.length === 0) {
    return null;
  }

  const minThickness = Math.min(...candidateThicknesses);
  const maxThickness = Math.max(...candidateThicknesses);
  const meanThickness = (minThickness + maxThickness) / 2;
  const uniform = meanThickness > 0
    ? (maxThickness - minThickness) / meanThickness <= THIN_WALL_UNIFORM_TOLERANCE
    : true;

  return {
    candidateThicknesses,
    uniform,
    minThickness,
    maxThickness,
    closedTube: isClosedTubeProfile(orientations),
  };
}

function buildThinWallProfileRejectReason(info: ThinWallProfileInfo | null): string | null {
  if (!info) {
    return null;
  }

  if (info.closedTube) {
    return 'Профиль: замкнутая труба — не для листового раскроя.';
  }

  if (!info.uniform && info.minThickness !== null && info.maxThickness !== null) {
    return `Профиль: неравномерная толщина стенок ${formatMm(info.minThickness)}..${formatMm(info.maxThickness)} мм, листовая развертка отклонена.`;
  }

  return null;
}

function collectThinWallOrientations(positions: Float32Array, indices: Uint32Array): ThinWallOrientation[] {
  const orientations: ThinWallOrientation[] = [];

  for (let i = 0; i < indices.length; i += 3) {
    const [i0, i1, i2] = [indices[i], indices[i + 1], indices[i + 2]];
    if (!isValidTriangleIndex(positions, i0) || !isValidTriangleIndex(positions, i1) || !isValidTriangleIndex(positions, i2)) {
      continue;
    }

    const ax = positions[i0 * 3];
    const ay = positions[i0 * 3 + 1];
    const az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3];
    const by = positions[i1 * 3 + 1];
    const bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3];
    const cy = positions[i2 * 3 + 1];
    const cz = positions[i2 * 3 + 2];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const normalLength = Math.hypot(nx, ny, nz);
    if (normalLength < 1e-10) {
      continue;
    }

    const area = normalLength / 2;
    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;
    const normal = canonicalNormal([nx, ny, nz]);
    const center: [number, number, number] = [
      (ax + bx + cx) / 3,
      (ay + by + cy) / 3,
      (az + bz + cz) / 3,
    ];
    const projection = dot3(center, normal);
    let orientation = orientations.find((candidate) => dot3(candidate.normal, normal) >= THIN_WALL_NORMAL_COS);

    if (!orientation) {
      orientation = {
        normal,
        totalArea: 0,
        planes: [],
        candidateGaps: [],
      };
      orientations.push(orientation);
    }

    const nextArea = orientation.totalArea + area;
    orientation.normal = normalize3([
      (orientation.normal[0] * orientation.totalArea + normal[0] * area) / nextArea,
      (orientation.normal[1] * orientation.totalArea + normal[1] * area) / nextArea,
      (orientation.normal[2] * orientation.totalArea + normal[2] * area) / nextArea,
    ]);
    orientation.totalArea = nextArea;
    addProjectionPlane(orientation.planes, projection, area);
  }

  for (const orientation of orientations) {
    orientation.planes = orientation.planes
      .filter((plane) => plane.area >= orientation.totalArea * THIN_WALL_MIN_PLANE_AREA_RATIO)
      .sort((left, right) => left.projection - right.projection);
    orientation.candidateGaps = collectCandidatePlaneGaps(orientation.planes);
  }

  return orientations.filter((orientation) => orientation.candidateGaps.length > 0);
}

function addProjectionPlane(planes: ThinWallPlaneGroup[], projection: number, area: number): void {
  const existing = planes.find((plane) => Math.abs(plane.projection - projection) <= THIN_WALL_PLANE_TOLERANCE_MM);
  if (!existing) {
    planes.push({ projection, area });
    return;
  }

  const nextArea = existing.area + area;
  existing.projection = (existing.projection * existing.area + projection * area) / nextArea;
  existing.area = nextArea;
}

function collectCandidatePlaneGaps(planes: ThinWallPlaneGroup[]): number[] {
  const gaps: number[] = [];

  for (let index = 1; index < planes.length; index += 1) {
    const gap = planes[index].projection - planes[index - 1].projection;
    if (gap >= THIN_WALL_MIN_MM && gap <= THIN_WALL_MAX_MM) {
      gaps.push(roundBlankSize(gap));
    }
  }

  return gaps;
}

function isClosedTubeProfile(orientations: ThinWallOrientation[]): boolean {
  const repeatedWallDirections = orientations.filter((orientation) => {
    const gaps = orientation.candidateGaps;
    if (gaps.length < 2 || orientation.planes.length < 4) {
      return false;
    }

    return gaps.some((gap, index) =>
      gaps.some((other, otherIndex) =>
        otherIndex !== index &&
        Math.abs(gap - other) / Math.max(gap, other) <= THIN_WALL_UNIFORM_TOLERANCE
      )
    );
  });

  return repeatedWallDirections.length >= 2;
}

function canonicalNormal(normal: [number, number, number]): [number, number, number] {
  const normalized = normalize3(normal);
  const axis = [Math.abs(normalized[0]), Math.abs(normalized[1]), Math.abs(normalized[2])];
  const dominant = axis[0] >= axis[1] && axis[0] >= axis[2] ? 0 : axis[1] >= axis[2] ? 1 : 2;

  if (normalized[dominant] < 0) {
    return [-normalized[0], -normalized[1], -normalized[2]];
  }

  return normalized;
}

function normalize3(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 1e-10) {
    return [0, 0, 1];
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function dot3(left: [number, number, number], right: [number, number, number]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function projectTo2D(positions: Float32Array, axis: Axis): Point2D[] {
  if (positions.length % 3 !== 0) {
    throw new Error('Position array length must be divisible by 3.');
  }

  const pointsByKey = new Map<string, Point2D>();

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    const point = projectVertex(x, y, z, axis);
    pointsByKey.set(pointKey(point, POINT_EPSILON), point);
  }

  return Array.from(pointsByKey.values());
}

export function convexHull(points: Point2D[]): Point2D[] {
  const unique = dedupePoints(points, POINT_EPSILON).sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  if (unique.length === 0) {
    return [];
  }

  if (unique.length === 1) {
    return [unique[0], unique[0]];
  }

  if (unique.length === 2) {
    return closeContour(unique);
  }

  const lower: Point2D[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Point2D[] = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();

  return closeContour([...lower, ...upper]);
}

export function extractBoundaryContour(positions: Float32Array, indices: Uint32Array, axis: Axis): Point2D[] {
  if (indices.length < 3 || indices.length % 3 !== 0) {
    return [];
  }

  const bbox = computeBoundingBox(positions);
  const axisMin = getAxisBounds(bbox, axis).min;
  const axisMax = getAxisBounds(bbox, axis).max;
  const thickness = Math.max(axisMax - axisMin, POINT_EPSILON);
  const planeTolerance = Math.max(thickness * 0.1, POINT_EPSILON);
  const edgeCounts = new Map<string, number>();

  for (let i = 0; i < indices.length; i += 3) {
    addEdgeCount(edgeCounts, indices[i], indices[i + 1]);
    addEdgeCount(edgeCounts, indices[i + 1], indices[i + 2]);
    addEdgeCount(edgeCounts, indices[i + 2], indices[i]);
  }

  const boundaryEdges = Array.from(edgeCounts.entries())
    .filter(([, count]) => count === 1)
    .map(([key]) => key.split(':').map(Number) as [number, number]);

  const topEdges = boundaryEdges.filter(([a, b]) =>
    isEdgeOnPlane(positions, a, b, axis, axisMax, planeTolerance)
  );
  const bottomEdges = boundaryEdges.filter(([a, b]) =>
    isEdgeOnPlane(positions, a, b, axis, axisMin, planeTolerance)
  );
  const selectedEdges = topEdges.length >= bottomEdges.length ? topEdges : bottomEdges;

  if (selectedEdges.length === 0) {
    return [];
  }

  const projectedEdges = selectedEdges
    .map(([a, b]) => [projectVertexAtIndex(positions, a, axis), projectVertexAtIndex(positions, b, axis)] as const)
    .filter(([a, b]) => distance(a, b) >= POINT_EPSILON);

  const chains = buildChains(projectedEdges);
  if (chains.length === 0) {
    return [];
  }

  const closedChains = chains.filter((chain) => chain.length >= 4 && pointsEqual(chain[0], chain[chain.length - 1], CHAIN_EPSILON));
  const candidates = closedChains.length > 0 ? closedChains : chains;
  const best = candidates
    .slice()
    .sort((a, b) => contourScore(b) - contourScore(a))[0];

  return normalizeContour(best);
}

export function simplifyContour(points: Point2D[], tolerance = 0.5): Point2D[] {
  if (points.length <= 2) {
    return points.slice();
  }

  const isClosed = pointsEqual(points[0], points[points.length - 1], POINT_EPSILON);
  const input = isClosed ? points.slice(0, -1) : points.slice();

  if (input.length <= 2) {
    return closeContour(input);
  }

  const simplified = simplifyOpenPolyline(input, tolerance);
  return isClosed ? closeContour(simplified) : simplified;
}

export function normalizeContour(points: Point2D[]): Point2D[] {
  const deduped = removeAdjacentDuplicates(points, POINT_EPSILON);
  if (deduped.length === 0) {
    return [];
  }

  const open = pointsEqual(deduped[0], deduped[deduped.length - 1], POINT_EPSILON)
    ? deduped.slice(0, -1)
    : deduped;

  if (open.length === 0) {
    return [];
  }

  const minX = Math.min(...open.map((point) => point.x));
  const minY = Math.min(...open.map((point) => point.y));
  const normalized = open.map((point) => ({
    x: roundCoord(point.x - minX),
    y: roundCoord(point.y - minY),
  }));

  return closeContour(removeAdjacentDuplicates(normalized, POINT_EPSILON));
}

export function signedPolygonArea(points: Point2D[]): number {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    area += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y;
  }

  return area / 2;
}

export function polygonArea(points: Point2D[]): number {
  return Math.abs(signedPolygonArea(points));
}

export function ensureClockwise(points: Point2D[]): Point2D[] {
  if (signedPolygonArea(points) > 0) {
    return closeContour(points.slice(0, -1).reverse());
  }

  return closeContour(points);
}

export function ensureCounterClockwise(points: Point2D[]): Point2D[] {
  if (signedPolygonArea(points) < 0) {
    return closeContour(points.slice(0, -1).reverse());
  }

  return closeContour(points);
}

export function polygonNetArea(contour: Point2D[], holes: Point2D[][] = []): number {
  const holeArea = holes.reduce((sum, hole) => sum + polygonArea(hole), 0);
  return Math.max(0, polygonArea(contour) - holeArea);
}

export function generateThumbnailSvg(contour: Point2D[], holes: Point2D[][], size = 100): string {
  const allPoints = [contour, ...holes].flat();
  if (allPoints.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"></svg>`;
  }

  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const padding = Math.max(width, height) * 0.1;
  const viewBox = [
    roundCoord(minX - padding),
    roundCoord(minY - padding),
    roundCoord(width + padding * 2),
    roundCoord(height + padding * 2),
  ].join(' ');
  const outerPath = contourToPath(contour);
  const holePaths = holes.map((hole) => contourToPath(hole)).join(' ');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}">`,
    `<path d="${escapeXml(outerPath)}" fill="#3b82f6" fill-opacity="0.2" stroke="#3b82f6" stroke-width="1"/>`,
    holePaths
      ? `<path d="${escapeXml(holePaths)}" fill="white" stroke="#ef4444" stroke-width="1"/>`
      : '',
    '</svg>',
  ].join('');
}

export function roundToStandardThickness(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }

  if (raw > 2.5 && raw < 3) {
    return 3;
  }

  return STANDARD_THICKNESSES.reduce((closest, current) => {
    const currentDiff = Math.abs(current - raw);
    const closestDiff = Math.abs(closest - raw);

    if (Math.abs(currentDiff - closestDiff) < 1e-9) {
      return Math.min(closest, current);
    }

    return currentDiff < closestDiff ? current : closest;
  });
}

function getVolumeAreaInfo(
  bbox: BBox3D,
  positions: Float32Array,
  indices: Uint32Array
): { wallThickness: number; roundedWall: number; developedBlank: DevelopedBlankInfo } | null {
  const meshArea = computeMeshArea(positions, indices);
  const meshVolume = computeMeshVolume(positions, indices);
  const wallThickness = estimateWallThickness(meshVolume, meshArea);
  const roundedWall = roundToStandardThickness(wallThickness);
  const maxDim = sortedDimensions(bbox)[2];

  if (
    roundedWall <= 0 ||
    maxDim.size <= 0 ||
    !Number.isFinite(meshVolume) ||
    meshVolume <= 0
  ) {
    return null;
  }

  const developedWidth = meshVolume / (roundedWall * maxDim.size);
  if (!Number.isFinite(developedWidth) || developedWidth <= 0) {
    return null;
  }

  const width = roundBlankSize(maxDim.size);
  const height = roundBlankSize(developedWidth);

  return {
    wallThickness,
    roundedWall,
    developedBlank: {
      width,
      height,
      contour: createRectangleContour(width, height),
    },
  };
}

function isManualThinWallShellCandidate(
  dims: Array<{ axis: Axis; size: number }>,
  volumeInfo: { wallThickness: number; roundedWall: number }
): boolean {
  const minDim = dims[0];
  const midDim = dims[1];
  const maxDim = dims[2];

  return (
    volumeInfo.roundedWall > 0 &&
    volumeInfo.roundedWall <= 4 &&
    volumeInfo.roundedWall < minDim.size * 0.05 &&
    midDim.size > 100 &&
    maxDim.size > 500
  );
}

function isCompactThickPlateCandidate(dims: Array<{ axis: Axis; size: number }>): boolean {
  const minDim = dims[0];
  const midDim = dims[1];
  const maxDim = dims[2];
  const ratio = minDim.size / maxDim.size;

  return (
    minDim.size >= 12 &&
    minDim.size <= 30 &&
    midDim.size >= 45 &&
    maxDim.size <= 350 &&
    ratio <= 0.16
  );
}

function roundBlankSize(value: number): number {
  return Math.round(value * 10) / 10;
}

function sortedDimensions(bbox: BBox3D): Array<{ axis: Axis; size: number }> {
  return [
    { axis: 'x' as const, size: bbox.sizeX },
    { axis: 'y' as const, size: bbox.sizeY },
    { axis: 'z' as const, size: bbox.sizeZ },
  ].sort((a, b) => a.size - b.size);
}

function dominantAxis(normal: Pick<TriangleNormal, 'nx' | 'ny' | 'nz'>): Axis {
  const absX = Math.abs(normal.nx);
  const absY = Math.abs(normal.ny);
  const absZ = Math.abs(normal.nz);

  if (absX > absY && absX > absZ) {
    return 'x';
  }

  return absY > absZ ? 'y' : 'z';
}

function isValidTriangleIndex(positions: Float32Array, index: number): boolean {
  const offset = index * 3;
  return Number.isInteger(index) &&
    offset >= 0 &&
    offset + 2 < positions.length &&
    Number.isFinite(positions[offset]) &&
    Number.isFinite(positions[offset + 1]) &&
    Number.isFinite(positions[offset + 2]);
}

function triangleEdges(i0: number, i1: number, i2: number): Array<[number, number]> {
  return [[i0, i1], [i1, i2], [i2, i0]];
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function vertexAt(positions: Float32Array, index: number): [number, number, number] {
  const offset = index * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function vertexMinusRef(positions: Float32Array, index: number, ref: [number, number, number]): [number, number, number] {
  const offset = index * 3;
  return [
    positions[offset] - ref[0],
    positions[offset + 1] - ref[1],
    positions[offset + 2] - ref[2],
  ];
}

function signedTetraVolume(a: [number, number, number], b: [number, number, number], c: [number, number, number]): number {
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) +
    b[0] * (c[1] * a[2] - c[2] * a[1]) +
    c[0] * (a[1] * b[2] - a[2] * b[1])
  ) / 6;
}

function addEdgeCount(edgeCounts: Map<string, number>, a: number, b: number): void {
  const key = edgeKey(a, b);
  edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
}

function buildChains(edges: ReadonlyArray<readonly [Point2D, Point2D]>): Point2D[][] {
  const adjacency = new Map<string, string[]>();
  const points = new Map<string, Point2D>();

  for (const [start, end] of edges) {
    const startKey = pointKey(start, CHAIN_EPSILON);
    const endKey = pointKey(end, CHAIN_EPSILON);

    if (startKey === endKey) {
      continue;
    }

    points.set(startKey, start);
    points.set(endKey, end);
    adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), endKey]);
    adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), startKey]);
  }

  const chains: Point2D[][] = [];
  const visitedEdges = new Set<string>();

  for (const startKey of adjacency.keys()) {
    for (const neighborKey of adjacency.get(startKey) ?? []) {
      const firstEdgeKey = normalizedEdgeKey(startKey, neighborKey);
      if (visitedEdges.has(firstEdgeKey)) {
        continue;
      }

      const chainKeys = [startKey];
      let previousKey = startKey;
      let currentKey = neighborKey;
      visitedEdges.add(firstEdgeKey);

      while (true) {
        chainKeys.push(currentKey);

        if (currentKey === startKey) {
          break;
        }

        const nextKey = (adjacency.get(currentKey) ?? []).find((candidate) => {
          const edgeKey = normalizedEdgeKey(currentKey, candidate);
          return candidate !== previousKey && !visitedEdges.has(edgeKey);
        });

        if (!nextKey) {
          break;
        }

        visitedEdges.add(normalizedEdgeKey(currentKey, nextKey));
        previousKey = currentKey;
        currentKey = nextKey;
      }

      const chain = chainKeys.map((key) => points.get(key)).filter((point): point is Point2D => Boolean(point));
      if (chain.length >= 2) {
        chains.push(chain);
      }
    }
  }

  return chains;
}

function closeContour(points: Point2D[]): Point2D[] {
  if (points.length === 0) {
    return [];
  }

  const contour = points.slice();
  if (!pointsEqual(contour[0], contour[contour.length - 1], POINT_EPSILON)) {
    contour.push({ ...contour[0] });
  }

  return contour;
}

function contourScore(points: Point2D[]): number {
  const area = polygonArea(closeContour(points));
  return area > 0 ? area : polylineLength(points);
}

function contourToPath(points: Point2D[]): string {
  const contour = closeContour(points);
  if (contour.length === 0) {
    return '';
  }

  const [first, ...rest] = contour;
  return [`M ${roundCoord(first.x)} ${roundCoord(first.y)}`, ...rest.map((point) => `L ${roundCoord(point.x)} ${roundCoord(point.y)}`), 'Z'].join(' ');
}

function cross(origin: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function dedupePoints(points: Point2D[], epsilon: number): Point2D[] {
  const byKey = new Map<string, Point2D>();
  for (const point of points) {
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      byKey.set(pointKey(point, epsilon), point);
    }
  }
  return Array.from(byKey.values());
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToLine(point: Point2D, start: Point2D, end: Point2D): number {
  const denominator = distance(start, end);
  if (denominator < RDP_EPSILON) {
    return distance(point, start);
  }

  return Math.abs((end.y - start.y) * point.x - (end.x - start.x) * point.y + end.x * start.y - end.y * start.x) / denominator;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getAxisBounds(bbox: BBox3D, axis: Axis): { min: number; max: number } {
  if (axis === 'x') {
    return { min: bbox.minX, max: bbox.maxX };
  }
  if (axis === 'y') {
    return { min: bbox.minY, max: bbox.maxY };
  }
  return { min: bbox.minZ, max: bbox.maxZ };
}

function getAxisValue(positions: Float32Array, vertexIndex: number, axis: Axis): number {
  const offset = vertexIndex * 3;
  if (axis === 'x') {
    return positions[offset];
  }
  if (axis === 'y') {
    return positions[offset + 1];
  }
  return positions[offset + 2];
}

function isEdgeOnPlane(
  positions: Float32Array,
  a: number,
  b: number,
  axis: Axis,
  plane: number,
  tolerance: number
): boolean {
  return Math.abs(getAxisValue(positions, a, axis) - plane) <= tolerance &&
    Math.abs(getAxisValue(positions, b, axis) - plane) <= tolerance;
}

function normalizedEdgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pointKey(point: Point2D, epsilon: number): string {
  return `${Math.round(point.x / epsilon)}:${Math.round(point.y / epsilon)}`;
}

function pointsEqual(a: Point2D, b: Point2D, epsilon: number): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

function polylineLength(points: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

function projectVertex(x: number, y: number, z: number, axis: Axis): Point2D {
  if (axis === 'x') {
    return { x: y, y: z };
  }
  if (axis === 'y') {
    return { x, y: z };
  }
  return { x, y };
}

function projectVertexAtIndex(positions: Float32Array, vertexIndex: number, axis: Axis): Point2D {
  const offset = vertexIndex * 3;
  return projectVertex(positions[offset], positions[offset + 1], positions[offset + 2], axis);
}

function removeAdjacentDuplicates(points: Point2D[], epsilon: number): Point2D[] {
  const result: Point2D[] = [];

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }

    if (result.length === 0 || !pointsEqual(result[result.length - 1], point, epsilon)) {
      result.push(point);
    }
  }

  if (result.length > 1 && pointsEqual(result[0], result[result.length - 1], epsilon)) {
    result[result.length - 1] = { ...result[0] };
  }

  return result;
}

function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function simplifyOpenPolyline(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length <= 2) {
    return points.slice();
  }

  const first = points[0];
  const last = points[points.length - 1];
  let maxDistance = -Infinity;
  let index = -1;

  for (let i = 1; i < points.length - 1; i += 1) {
    const currentDistance = distanceToLine(points[i], first, last);
    if (currentDistance > maxDistance) {
      maxDistance = currentDistance;
      index = i;
    }
  }

  if (maxDistance > tolerance && index > 0) {
    const left = simplifyOpenPolyline(points.slice(0, index + 1), tolerance);
    const right = simplifyOpenPolyline(points.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}
