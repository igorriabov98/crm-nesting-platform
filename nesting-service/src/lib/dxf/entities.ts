type DxfPoint = {
  x: number;
  y: number;
};

const MIN_SEGMENT_MM = 0.01;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function dxfLwPolyline(points: DxfPoint[], layer: string, closed = true): string {
  const cleanPoints = normalizePolylinePoints(points, closed);

  if (closed && cleanPoints.length < 3) {
    return '';
  }

  if (!closed && cleanPoints.length < 2) {
    return '';
  }

  const lines = [
    '0',
    'LWPOLYLINE',
    '8',
    layer,
    '90',
    String(cleanPoints.length),
    '70',
    closed ? '1' : '0',
  ];

  for (const point of cleanPoints) {
    lines.push('10', formatNum(point.x), '20', formatNum(point.y));
  }

  return lines.join('\r\n');
}

export function dxfPathAsLines(points: DxfPoint[], layer: string, closed = true): string {
  const cleanPoints = normalizePolylinePoints(points, closed);

  if (closed && cleanPoints.length < 3) {
    return '';
  }

  if (!closed && cleanPoints.length < 2) {
    return '';
  }

  const segments: string[] = [];
  const segmentCount = closed ? cleanPoints.length : cleanPoints.length - 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const start = cleanPoints[index];
    const end = cleanPoints[(index + 1) % cleanPoints.length];
    const segment = dxfLine(start.x, start.y, end.x, end.y, layer);

    if (segment.length > 0) {
      segments.push(segment);
    }
  }

  return segments.join('\r\n');
}

export function dxfText(text: string, x: number, y: number, height: number, layer: string): string {
  const safeText = sanitizeDxfText(text);

  return [
    '0',
    'TEXT',
    '8',
    layer,
    '10',
    formatNum(x),
    '20',
    formatNum(y),
    '30',
    '0',
    '40',
    formatNum(height),
    '1',
    safeText,
    '72',
    '1',
    '11',
    formatNum(x),
    '21',
    formatNum(y),
    '31',
    '0',
    '73',
    '2',
  ].join('\r\n');
}

export function dxfLine(x1: number, y1: number, x2: number, y2: number, layer: string): string {
  if (distance({ x: x1, y: y1 }, { x: x2, y: y2 }) < MIN_SEGMENT_MM) {
    return '';
  }

  return [
    '0',
    'LINE',
    '8',
    layer,
    '10',
    formatNum(x1),
    '20',
    formatNum(y1),
    '30',
    '0',
    '11',
    formatNum(x2),
    '21',
    formatNum(y2),
    '31',
    '0',
  ].join('\r\n');
}

export function dxfCircle(cx: number, cy: number, radius: number, layer: string): string {
  if (!Number.isFinite(radius) || radius <= 0) {
    return '';
  }

  return [
    '0',
    'CIRCLE',
    '8',
    layer,
    '10',
    formatNum(cx),
    '20',
    formatNum(cy),
    '30',
    '0',
    '40',
    formatNum(radius),
  ].join('\r\n');
}

export function dxfInsert(blockName: string, x: number, y: number, layer: string): string {
  return [
    '0',
    'INSERT',
    '8',
    layer,
    '2',
    blockName,
    '10',
    formatNum(x),
    '20',
    formatNum(y),
    '30',
    '0',
  ].join('\r\n');
}

export function dxfComment(text: string): string {
  const safeText = sanitizeDxfText(text);

  if (safeText.length === 0) {
    return '';
  }

  return ['999', safeText].join('\r\n');
}

export function formatNum(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid DXF number: ${n}`);
  }

  const rounded = Number.parseFloat(n.toFixed(4));
  return Object.is(rounded, -0) ? '0' : rounded.toString();
}

function normalizePolylinePoints(points: DxfPoint[], closed: boolean): DxfPoint[] {
  const finitePoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const withoutClosingPoint = removeClosingPoint(finitePoints);
  const withoutDuplicateSegments: DxfPoint[] = [];

  for (const point of withoutClosingPoint) {
    const previous = withoutDuplicateSegments[withoutDuplicateSegments.length - 1];
    if (!previous || distance(previous, point) >= MIN_SEGMENT_MM) {
      withoutDuplicateSegments.push(point);
    }
  }

  if (!closed) {
    return withoutDuplicateSegments;
  }

  while (
    withoutDuplicateSegments.length > 1 &&
    distance(withoutDuplicateSegments[0], withoutDuplicateSegments[withoutDuplicateSegments.length - 1]) <
      MIN_SEGMENT_MM
  ) {
    withoutDuplicateSegments.pop();
  }

  return withoutDuplicateSegments;
}

function removeClosingPoint(points: DxfPoint[]): DxfPoint[] {
  if (points.length < 2) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];

  if (distance(first, last) < MIN_SEGMENT_MM) {
    return points.slice(0, -1);
  }

  return points;
}

function sanitizeDxfText(text: string): string {
  return String(text).replace(/\r?\n/g, ' ').replace(CONTROL_CHARS, '').trim();
}

function distance(a: DxfPoint, b: DxfPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
