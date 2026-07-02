export interface Point2D {
  x: number;
  y: number;
}

export interface NestingPart {
  id: string;
  name: string;
  sourceInputId?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  sourceLabel?: string | null;
  sourceMachineId?: string | null;
  sourceMachineName?: string | null;
  sourceMachineItemId?: string | null;
  sourceProductId?: string | null;
  width: number;
  height: number;
  contour: Point2D[];
  holes: Point2D[][];
  grainLock: boolean;
  area: number;
}

export interface SheetOption {
  id: string;
  width: number;
  height: number;
  material: string;
  thickness: number;
  isRemnant: boolean;
  priority: number;
  potentialUtilization: number;
}

export interface PlacedPart {
  partId: string;
  name: string;
  sourceInputId?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
  sourceLabel?: string | null;
  sourceMachineId?: string | null;
  sourceMachineName?: string | null;
  sourceMachineItemId?: string | null;
  sourceProductId?: string | null;
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
  placedW: number;
  placedH: number;
  contour: Point2D[];
  holes: Point2D[][];
}

export interface SheetResult {
  sheetOptionId: string;
  width: number;
  height: number;
  material: string;
  steelTypeId: string | null;
  steelTypeName: string | null;
  thickness: number;
  isRemnant: boolean;
  usedGap: number;
  usedMargin: number;
  placements: PlacedPart[];
  utilization: number;
  waste: number;
  remnant: RemnantInfo | null;
}

export interface RemnantInfo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  isUsable: boolean;
  candidates?: RemnantCandidate[];
  selectedIds?: string[];
}

export interface RemnantCandidate {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  isUsable: boolean;
}

export interface NestingResult {
  sheets: SheetResult[];
  unplacedParts: { partId: string; name: string }[];
  totalParts: number;
  placedParts: number;
  totalSheets: number;
  avgUtilization: number;
  totalWaste: number;
  computeTimeMs: number;
}

export interface NestingParams {
  strategy: 'minWaste' | 'remnant' | 'minSheets';
  gap: number;
  margin: number;
  grainDirection: 'horizontal';
}
