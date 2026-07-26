type Vector3 = [number, number, number];

export type CanonicalMeshFrame = {
  positions: Float32Array;
  normalDominance: number;
};

const VECTOR_EPSILON = 1e-9;
const NORMAL_CLUSTER_COSINE = Math.cos(5 * Math.PI / 180);
const NORMAL_DOMINANCE_MIN = 0.05;
const PCA_GAP_RELATIVE_EPSILON = 1e-8;

export function buildCanonicalMeshFrame(
  positions: ArrayLike<number>,
  indices: Uint32Array
): CanonicalMeshFrame | null {
  const dominantNormal = findDominantAreaNormal(positions, indices);
  if (!dominantNormal) return null;
  const normalDominance = dominantNormal.area / dominantNormal.totalArea;
  if (normalDominance < NORMAL_DOMINANCE_MIN) return null;

  let normal = stabilizeNormalSign(dominantNormal.normal, positions);

  const center = centroid3(positions);
  const seedAxis = leastAlignedCoordinateAxis(normal);
  const planeA = normalize3(cross3(normal, seedAxis));
  if (!planeA) return null;
  const planeB = normalize3(cross3(normal, planeA));
  if (!planeB) return null;

  const projected = projectAroundCenter(positions, center, planeA, planeB);
  const covariance = covariance2(projected);
  const principal2 = principalAxis2(covariance, projected);
  let axisU = normalize3(addScaled3(scale3(planeA, principal2[0]), planeB, principal2[1]));
  if (!axisU) return null;
  axisU = stabilizeAxisSign(axisU, positions, center);

  let axisV = normalize3(cross3(normal, axisU));
  if (!axisV) return null;
  axisV = stabilizeAxisSign(axisV, positions, center);
  normal = normalize3(cross3(axisU, axisV)) ?? normal;

  const canonical = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    const relative: Vector3 = [
      positions[index] - center[0],
      positions[index + 1] - center[1],
      positions[index + 2] - center[2],
    ];
    canonical[index] = dot3(relative, axisU);
    canonical[index + 1] = dot3(relative, axisV);
    canonical[index + 2] = dot3(relative, normal);
  }

  return { positions: canonical, normalDominance };
}

function findDominantAreaNormal(
  positions: ArrayLike<number>,
  indices: Uint32Array
): { normal: Vector3; area: number; totalArea: number } | null {
  const clusters: Array<{ seed: Vector3; sum: Vector3; area: number }> = [];
  let totalArea = 0;

  for (let index = 0; index + 2 < indices.length; index += 3) {
    const a = vertex3(positions, indices[index]);
    const b = vertex3(positions, indices[index + 1]);
    const c = vertex3(positions, indices[index + 2]);
    if (!a || !b || !c) continue;
    const cross = cross3(sub3(b, a), sub3(c, a));
    const doubleArea = length3(cross);
    if (doubleArea <= VECTOR_EPSILON) continue;
    const normal = scale3(cross, 1 / doubleArea);
    const area = doubleArea / 2;
    totalArea += area;
    const cluster = clusters.find((candidate) => Math.abs(dot3(candidate.seed, normal)) >= NORMAL_CLUSTER_COSINE);
    if (cluster) {
      const sign = dot3(cluster.seed, normal) < 0 ? -1 : 1;
      cluster.sum = addScaled3(cluster.sum, normal, area * sign);
      cluster.area += area;
    } else {
      clusters.push({ seed: normal, sum: scale3(normal, area), area });
    }
  }

  if (totalArea <= VECTOR_EPSILON || clusters.length === 0) return null;
  let dominant = clusters[0];
  for (let index = 1; index < clusters.length; index += 1) {
    if (clusters[index].area > dominant.area + VECTOR_EPSILON) dominant = clusters[index];
  }
  const normal = normalize3(dominant.sum);
  return normal ? { normal, area: dominant.area, totalArea } : null;
}

function principalAxis2(
  covariance: { xx: number; xy: number; yy: number },
  points: Array<[number, number]>
): [number, number] {
  const trace = covariance.xx + covariance.yy;
  const radius = Math.hypot(covariance.xx - covariance.yy, 2 * covariance.xy);
  if (radius / Math.max(Math.abs(trace), VECTOR_EPSILON) <= PCA_GAP_RELATIVE_EPSILON) {
    return farthestPairAxis(points);
  }

  const angle = 0.5 * Math.atan2(2 * covariance.xy, covariance.xx - covariance.yy);
  return [Math.cos(angle), Math.sin(angle)];
}

function farthestPairAxis(points: Array<[number, number]>): [number, number] {
  let best: [number, number] = [1, 0];
  let bestDistance = -1;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const dx = points[right][0] - points[left][0];
      const dy = points[right][1] - points[left][1];
      const distance = dx * dx + dy * dy;
      if (distance > bestDistance + VECTOR_EPSILON) {
        bestDistance = distance;
        const length = Math.hypot(dx, dy);
        best = length > VECTOR_EPSILON ? [dx / length, dy / length] : best;
      }
    }
  }
  return best;
}

function covariance2(points: Array<[number, number]>): { xx: number; xy: number; yy: number } {
  if (points.length === 0) return { xx: 0, xy: 0, yy: 0 };
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const [x, y] of points) {
    const dx = x - meanX;
    const dy = y - meanY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  return { xx, xy, yy };
}

function projectAroundCenter(
  positions: ArrayLike<number>,
  center: Vector3,
  axisA: Vector3,
  axisB: Vector3
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let index = 0; index < positions.length; index += 3) {
    const relative: Vector3 = [
      positions[index] - center[0],
      positions[index + 1] - center[1],
      positions[index + 2] - center[2],
    ];
    points.push([dot3(relative, axisA), dot3(relative, axisB)]);
  }
  return points;
}

function stabilizeNormalSign(axis: Vector3, positions: ArrayLike<number>): Vector3 {
  const center = centroid3(positions);
  return stabilizeAxisSign(axis, positions, center);
}

function stabilizeAxisSign(axis: Vector3, positions: ArrayLike<number>, center: Vector3): Vector3 {
  let thirdMoment = 0;
  let extremePositive = 0;
  let extremeNegative = 0;
  for (let index = 0; index < positions.length; index += 3) {
    const projection = dot3([
      positions[index] - center[0],
      positions[index + 1] - center[1],
      positions[index + 2] - center[2],
    ], axis);
    thirdMoment += projection ** 3;
    extremePositive = Math.max(extremePositive, projection);
    extremeNegative = Math.min(extremeNegative, projection);
  }
  if (Math.abs(thirdMoment) > 1e-7) return thirdMoment < 0 ? scale3(axis, -1) : axis;
  return extremePositive + extremeNegative < 0 ? scale3(axis, -1) : axis;
}

function centroid3(positions: ArrayLike<number>): Vector3 {
  const center: Vector3 = [0, 0, 0];
  const count = positions.length / 3;
  for (let index = 0; index < positions.length; index += 3) {
    center[0] += positions[index];
    center[1] += positions[index + 1];
    center[2] += positions[index + 2];
  }
  return count > 0 ? scale3(center, 1 / count) : center;
}

function leastAlignedCoordinateAxis(normal: Vector3): Vector3 {
  const absolute = normal.map(Math.abs);
  if (absolute[0] <= absolute[1] && absolute[0] <= absolute[2]) return [1, 0, 0];
  if (absolute[1] <= absolute[2]) return [0, 1, 0];
  return [0, 0, 1];
}

function vertex3(positions: ArrayLike<number>, index: number): Vector3 | null {
  const offset = index * 3;
  if (offset < 0 || offset + 2 >= positions.length) return null;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function addScaled3(left: Vector3, right: Vector3, scale: number): Vector3 {
  return [left[0] + right[0] * scale, left[1] + right[1] * scale, left[2] + right[2] * scale];
}

function sub3(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale3(vector: Vector3, scale: number): Vector3 {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}

function dot3(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross3(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function length3(vector: Vector3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize3(vector: Vector3): Vector3 | null {
  const length = length3(vector);
  return length > VECTOR_EPSILON ? scale3(vector, 1 / length) : null;
}
