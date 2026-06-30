import { dxfComment, dxfInsert, dxfLine, dxfLwPolyline, dxfPathAsLines, dxfText, formatNum } from './entities';
import { createLeadSegments, type LeadSegment, type LeadObstacleBox } from './leads';
import { ensureCCW, ensureCW, removeClosingPoint, transformContourForDxf, type DxfRotation } from './transform';
import type { Point2D } from '../nesting/types';

const NL = '\r\n';

type DxfEntityMode = 'lwpolyline' | 'line';

type DxfLayerKey = 'sheet' | 'cut' | 'holes' | 'labels' | 'remnant' | 'grain' | 'leadIn' | 'leadOut';

type DxfLayerDefinition = {
  name: string;
  color: number;
};

type PreparedPart = {
  part: DxfPartData;
  blockName: string;
  outerContour: Point2D[];
  holeContours: Point2D[][];
  leadSegments: LeadSegment[];
  warnings: string[];
};

const DEFAULT_LAYERS: Record<DxfLayerKey, DxfLayerDefinition> = {
  sheet: { name: 'SHEET', color: 7 },
  cut: { name: 'CUT', color: 1 },
  holes: { name: 'HOLES', color: 2 },
  labels: { name: 'LABELS', color: 3 },
  remnant: { name: 'REMNANT', color: 8 },
  grain: { name: 'GRAIN', color: 6 },
  leadIn: { name: 'LEAD_IN', color: 4 },
  leadOut: { name: 'LEAD_OUT', color: 5 },
};

export const CAM_DXF_OPTIONS: DxfGenerationOptions = {
  dxfVersion: 'AC1009',
  entityMode: 'line',
  includeSheet: false,
  includeLabels: false,
  includeRemnant: false,
  grainArrow: false,
  blockMode: false,
  cutLayer: DEFAULT_LAYERS.cut.name,
  holeLayer: DEFAULT_LAYERS.holes.name,
  leadInLayer: DEFAULT_LAYERS.leadIn.name,
  leadOutLayer: DEFAULT_LAYERS.leadOut.name,
  leadInLength: 3,
  leadOutLength: 2,
  leadSafeMargin: 5,
};

export interface DxfPartData {
  name: string;
  x: number;
  y: number;
  rotation: DxfRotation;
  placedW: number;
  placedH: number;
  contour: Point2D[];
  holes: Point2D[][];
  originalW: number;
  originalH: number;
  grainLock: boolean;
}

export interface DxfRemnantData {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DxfGenerationOptions {
  grainArrow?: boolean;
  dxfVersion?: 'AC1009' | 'AC1027';
  entityMode?: DxfEntityMode;
  includeSheet?: boolean;
  includeLabels?: boolean;
  includeRemnant?: boolean;
  blockMode?: boolean;
  cutLayer?: string;
  holeLayer?: string;
  labelLayer?: string;
  sheetLayer?: string;
  remnantLayer?: string;
  grainLayer?: string;
  leadInLayer?: string;
  leadOutLayer?: string;
  leadInLength?: number;
  leadOutLength?: number;
  leadSafeMargin?: number;
}

export function generateDXF(
  sheet: { width: number; height: number; material: string; thickness: number },
  parts: DxfPartData[],
  remnant: DxfRemnantData | null,
  options: DxfGenerationOptions = {}
): string {
  const resolvedOptions = resolveOptions(options);
  const preparedParts = prepareParts(sheet, parts, resolvedOptions);
  const layers = collectLayers(resolvedOptions);
  const lines: string[] = [];

  lines.push(...buildHeader(sheet, resolvedOptions));
  lines.push(...buildTables(layers));

  if (resolvedOptions.blockMode) {
    lines.push('0', 'SECTION', '2', 'BLOCKS');
    for (const prepared of preparedParts) {
      pushPartBlock(lines, prepared, resolvedOptions);
    }
    lines.push('0', 'ENDSEC');
  }

  lines.push('0', 'SECTION', '2', 'ENTITIES');

  if (resolvedOptions.includeSheet) {
    pushPath(
      lines,
      ensureCW([
        { x: 0, y: 0 },
        { x: sheet.width, y: 0 },
        { x: sheet.width, y: sheet.height },
        { x: 0, y: sheet.height },
      ]),
      resolvedOptions.layers.sheet,
      true,
      resolvedOptions.entityMode
    );
  }

  for (const prepared of preparedParts) {
    if (resolvedOptions.blockMode) {
      pushEntity(lines, dxfInsert(prepared.blockName, prepared.part.x, prepared.part.y, '0'));
    } else {
      pushPlacedPartEntities(lines, prepared, resolvedOptions);
    }
  }

  if (resolvedOptions.includeRemnant && remnant && remnant.width > 0 && remnant.height > 0) {
    pushRemnant(lines, remnant, resolvedOptions);
  }

  if (resolvedOptions.grainArrow && sheet.width >= 140 && sheet.height >= 40) {
    const grainY = sheet.height - 20;
    pushEntity(lines, dxfLine(20, grainY, 120, grainY, resolvedOptions.layers.grain));
    pushEntity(lines, dxfLine(120, grainY, 112, grainY + 5, resolvedOptions.layers.grain));
    pushEntity(lines, dxfLine(120, grainY, 112, grainY - 5, resolvedOptions.layers.grain));
    pushEntity(lines, dxfText('GRAIN', 70, grainY + 12, 8, resolvedOptions.layers.grain));
  }

  for (const warning of preparedParts.flatMap((part) => part.warnings)) {
    pushEntity(lines, dxfComment(warning));
  }

  lines.push('0', 'ENDSEC', '0', 'EOF');

  return `${lines.join(NL)}${NL}`;
}

type ResolvedDxfOptions = {
  grainArrow: boolean;
  dxfVersion: 'AC1009' | 'AC1027';
  entityMode: DxfEntityMode;
  includeSheet: boolean;
  includeLabels: boolean;
  includeRemnant: boolean;
  blockMode: boolean;
  leadInLength: number;
  leadOutLength: number;
  leadSafeMargin: number;
  layers: Record<DxfLayerKey, string>;
};

function resolveOptions(options: DxfGenerationOptions): ResolvedDxfOptions {
  return {
    grainArrow: options.grainArrow !== false,
    dxfVersion: options.dxfVersion ?? 'AC1027',
    entityMode: options.entityMode ?? 'lwpolyline',
    includeSheet: options.includeSheet !== false,
    includeLabels: options.includeLabels !== false,
    includeRemnant: options.includeRemnant !== false,
    blockMode: options.blockMode === true,
    leadInLength: normalizeLength(options.leadInLength),
    leadOutLength: normalizeLength(options.leadOutLength),
    leadSafeMargin: normalizeSafeMargin(options.leadSafeMargin),
    layers: {
      sheet: options.sheetLayer ?? DEFAULT_LAYERS.sheet.name,
      cut: options.cutLayer ?? DEFAULT_LAYERS.cut.name,
      holes: options.holeLayer ?? DEFAULT_LAYERS.holes.name,
      labels: options.labelLayer ?? DEFAULT_LAYERS.labels.name,
      remnant: options.remnantLayer ?? DEFAULT_LAYERS.remnant.name,
      grain: options.grainLayer ?? DEFAULT_LAYERS.grain.name,
      leadIn: options.leadInLayer ?? DEFAULT_LAYERS.leadIn.name,
      leadOut: options.leadOutLayer ?? DEFAULT_LAYERS.leadOut.name,
    },
  };
}

function buildHeader(
  sheet: { width: number; height: number; material: string; thickness: number },
  options: ResolvedDxfOptions
): string[] {
  return [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    options.dxfVersion,
    '9',
    '$INSUNITS',
    '70',
    '4',
    '9',
    '$MEASUREMENT',
    '70',
    '1',
    '9',
    '$EXTMIN',
    '10',
    '0',
    '20',
    '0',
    '30',
    '0',
    '9',
    '$EXTMAX',
    '10',
    formatNum(sheet.width),
    '20',
    formatNum(sheet.height),
    '30',
    '0',
    '0',
    'ENDSEC',
  ];
}

function buildTables(layers: DxfLayerDefinition[]): string[] {
  const lines: string[] = [];

  lines.push('0', 'SECTION', '2', 'TABLES');
  lines.push(
    '0',
    'TABLE',
    '2',
    'LTYPE',
    '70',
    '1',
    '0',
    'LTYPE',
    '2',
    'CONTINUOUS',
    '70',
    '0',
    '3',
    'Solid line',
    '72',
    '65',
    '73',
    '0',
    '40',
    '0',
    '0',
    'ENDTAB'
  );

  lines.push('0', 'TABLE', '2', 'LAYER', '70', String(layers.length));
  for (const layer of layers) {
    lines.push('0', 'LAYER', '2', layer.name, '70', '0', '62', String(layer.color), '6', 'CONTINUOUS');
  }
  lines.push('0', 'ENDTAB', '0', 'ENDSEC');

  return lines;
}

function collectLayers(options: ResolvedDxfOptions): DxfLayerDefinition[] {
  const layers = new Map<string, DxfLayerDefinition>();

  const addLayer = (name: string, fallback: DxfLayerDefinition) => {
    if (!layers.has(name)) {
      layers.set(name, { name, color: fallback.color });
    }
  };

  if (options.includeSheet) {
    addLayer(options.layers.sheet, DEFAULT_LAYERS.sheet);
  }

  addLayer(options.layers.cut, DEFAULT_LAYERS.cut);
  addLayer(options.layers.holes, DEFAULT_LAYERS.holes);

  if (options.leadInLength > 0) {
    addLayer(options.layers.leadIn, DEFAULT_LAYERS.leadIn);
  }

  if (options.leadOutLength > 0) {
    addLayer(options.layers.leadOut, DEFAULT_LAYERS.leadOut);
  }

  if (options.includeLabels) {
    addLayer(options.layers.labels, DEFAULT_LAYERS.labels);
  }

  if (options.includeRemnant) {
    addLayer(options.layers.remnant, DEFAULT_LAYERS.remnant);
  }

  if (options.grainArrow) {
    addLayer(options.layers.grain, DEFAULT_LAYERS.grain);
  }

  return Array.from(layers.values());
}

function prepareParts(
  sheet: { width: number; height: number },
  parts: DxfPartData[],
  options: ResolvedDxfOptions
): PreparedPart[] {
  const boxes: LeadObstacleBox[] = parts.map((part, index) => ({
    index,
    x: part.x,
    y: part.y,
    width: part.placedW,
    height: part.placedH,
  }));

  return parts.map((part, index) => {
    const outerContour = ensureCW(
      removeClosingPoint(transformContourForDxf(part.contour, part.rotation, 0, 0, part.originalW, part.originalH))
    );
    const holeContours = part.holes.map((hole) =>
      ensureCCW(removeClosingPoint(transformContourForDxf(hole, part.rotation, 0, 0, part.originalW, part.originalH)))
    );
    const leadResults = [
      createLeadSegments(outerContour, part, index, 'outer', sheet, boxes, {
        leadInLength: options.leadInLength,
        leadOutLength: options.leadOutLength,
        safeMargin: options.leadSafeMargin,
      }),
      ...holeContours.map((hole, holeIndex) =>
        createLeadSegments(hole, part, index, `hole-${holeIndex + 1}`, sheet, boxes, {
          leadInLength: options.leadInLength,
          leadOutLength: options.leadOutLength,
          safeMargin: options.leadSafeMargin,
        })
      ),
    ];

    return {
      part,
      blockName: makeBlockName(part, index),
      outerContour,
      holeContours,
      leadSegments: leadResults.flatMap((result) => result.segments),
      warnings: leadResults.flatMap((result) => result.warnings),
    };
  });
}

function pushPartBlock(lines: string[], prepared: PreparedPart, options: ResolvedDxfOptions): void {
  lines.push(
    '0',
    'BLOCK',
    '8',
    '0',
    '2',
    prepared.blockName,
    '70',
    '0',
    '10',
    '0',
    '20',
    '0',
    '30',
    '0',
    '3',
    prepared.blockName,
    '1',
    ''
  );

  pushLocalPartEntities(lines, prepared, options);
  lines.push('0', 'ENDBLK');
}

function pushPlacedPartEntities(lines: string[], prepared: PreparedPart, options: ResolvedDxfOptions): void {
  const offset = prepared.part;
  const translatedPart: PreparedPart = {
    ...prepared,
    outerContour: translatePoints(prepared.outerContour, offset.x, offset.y),
    holeContours: prepared.holeContours.map((hole) => translatePoints(hole, offset.x, offset.y)),
    leadSegments: prepared.leadSegments.map((segment) => ({
      from: translatePoint(segment.from, offset.x, offset.y),
      to: translatePoint(segment.to, offset.x, offset.y),
      kind: segment.kind,
    })),
  };

  pushLocalPartEntities(lines, translatedPart, options);
}

function pushLocalPartEntities(lines: string[], prepared: PreparedPart, options: ResolvedDxfOptions): void {
  pushPath(lines, prepared.outerContour, options.layers.cut, true, options.entityMode);

  for (const hole of prepared.holeContours) {
    pushPath(lines, hole, options.layers.holes, true, options.entityMode);
  }

  for (const segment of prepared.leadSegments) {
    const layer = segment.kind === 'leadIn' ? options.layers.leadIn : options.layers.leadOut;
    pushEntity(lines, dxfLine(segment.from.x, segment.from.y, segment.to.x, segment.to.y, layer));
  }

  if (options.includeLabels) {
    const bounds = getBounds(prepared.outerContour);
    const centerX = bounds.minX + (bounds.maxX - bounds.minX) / 2;
    const centerY = bounds.minY + (bounds.maxY - bounds.minY) / 2;
    const textHeight = Math.min(Math.max(Math.min(prepared.part.placedW, prepared.part.placedH) * 0.1, 5), 30);
    pushEntity(lines, dxfText(prepared.part.name, centerX, centerY, textHeight, options.layers.labels));
  }

  if (prepared.part.grainLock && options.grainArrow) {
    const bounds = getBounds(prepared.outerContour);
    addGrainArrow(
      lines,
      bounds.minX,
      bounds.maxY - 10,
      Math.min(bounds.maxX - bounds.minX, 80),
      options.layers.grain
    );
  }
}

function pushRemnant(lines: string[], remnant: DxfRemnantData, options: ResolvedDxfOptions): void {
  const remnantContour = ensureCW([
    { x: remnant.x, y: remnant.y },
    { x: remnant.x + remnant.width, y: remnant.y },
    { x: remnant.x + remnant.width, y: remnant.y + remnant.height },
    { x: remnant.x, y: remnant.y + remnant.height },
  ]);
  pushPath(lines, remnantContour, options.layers.remnant, true, options.entityMode);
  pushEntity(
    lines,
    dxfText(
      `${Math.round(remnant.width)}x${Math.round(remnant.height)}`,
      remnant.x + remnant.width / 2,
      remnant.y + remnant.height / 2,
      15,
      options.layers.remnant
    )
  );
}

function pushPath(lines: string[], points: Point2D[], layer: string, closed: boolean, entityMode: DxfEntityMode): void {
  pushEntity(
    lines,
    entityMode === 'line' ? dxfPathAsLines(points, layer, closed) : dxfLwPolyline(points, layer, closed)
  );
}

function addGrainArrow(lines: string[], x: number, y: number, maxWidth: number, layer: string): void {
  const startX = x + 10;
  const endX = x + Math.min(maxWidth - 10, 80);

  if (endX <= startX + 10) {
    return;
  }

  pushEntity(lines, dxfLine(startX, y, endX, y, layer));
  pushEntity(lines, dxfLine(endX, y, endX - 8, y + 5, layer));
  pushEntity(lines, dxfLine(endX, y, endX - 8, y - 5, layer));
}

function translatePoints(points: Point2D[], offsetX: number, offsetY: number): Point2D[] {
  return points.map((point) => translatePoint(point, offsetX, offsetY));
}

function translatePoint(point: Point2D, offsetX: number, offsetY: number): Point2D {
  return { x: point.x + offsetX, y: point.y + offsetY };
}

function getBounds(points: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: points[0].x, minY: points[0].y, maxX: points[0].x, maxY: points[0].y }
  );
}

function makeBlockName(part: DxfPartData, index: number): string {
  const namePart = part.name
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return `PART_${index + 1}_${namePart || 'DETAIL'}`.slice(0, 64);
}

function normalizeLength(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return 0;
  }

  return value;
}

function normalizeSafeMargin(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 0) {
    return 0;
  }

  return value;
}

function pushEntity(lines: string[], entity: string): void {
  if (entity.length > 0) {
    lines.push(entity);
  }
}
