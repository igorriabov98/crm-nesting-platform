import * as fs from 'node:fs';
import {
  type BBox3D,
  type ClassificationMethod,
  type Point2D,
  computeBoundingBox,
  computeMeshArea,
  computeMeshVolume,
  classifySheetMetalV2,
  convexHull,
  ensureClockwise,
  estimateWallThickness,
  extractTriangleNormals,
  extractBoundaryContour,
  findDominantPlanePair,
  generateThumbnailSvg,
  normalizeContour,
  projectTo2D,
  roundToStandardThickness,
  simplifyContour,
} from './geometry';
import { readBrepPartContours, type BrepContourResult, type BrepPartContour, type KFactorResolver } from './brep/brep-reader';
import { extractStepOccurrenceNames } from './step-source-names';
import { normalizeCadText } from './text-encoding';

interface OcctNode {
  name?: string;
  meshes?: number[];
  children?: OcctNode[];
}

interface OcctMesh {
  name?: string;
  attributes?: {
    position?: {
      array?: Float32Array | number[];
    };
  };
  index?: {
    array?: Uint32Array | number[];
  };
}

interface OcctResult {
  success: boolean;
  root?: OcctNode;
  meshes?: OcctMesh[];
  error?: string;
  message?: string;
}

export interface ParsedPart {
  name: string;
  thickness: number | null;
  width: number;
  height: number;
  contour: Point2D[];
  holes: Point2D[][];
  contourSource: ContourSource;
  isSheetMetal: boolean;
  hasBends: boolean;
  confidence: number;
  classificationMethod: ClassificationMethod;
  classificationWarning: string | null;
  thumbnailSvg: string;
  boundingBox: BBox3D;
  meshVolume: number;
  meshArea: number;
  facesCount: number;
  bendCount: number;
  kFactor: number | null;
  kFactorDefaulted: boolean;
}

export type ContourSource = 'EXACT_BREP' | 'UNFOLDED_BREP' | 'EXACT_BOUNDARY' | 'CONVEX_HULL' | 'RECT_ESTIMATE';

export type BrepTrace = {
  partName: string;
  source: ContourSource;
  bendCount: number;
  reason: string | null;
  elapsedMs: number | null;
};

export interface StepParseResult {
  success: boolean;
  parts: ParsedPart[];
  totalMeshes: number;
  sheetMetalCount: number;
  brepOk: number;
  brepFlat: number;
  brepUnfolded: number;
  brepFallback: number;
  brepTrace: BrepTrace[];
  errors: string[];
  parseTimeMs: number;
}

export type StepParseOptions = {
  material?: string;
  resolveKFactor?: KFactorResolver;
};

let occtInstance: any = null;
let occtLoading: Promise<any> | null = null;
const BREP_PART_TIMEOUT_MS = 30_000;

async function getOcct(): Promise<any> {
  if (occtInstance) {
    return occtInstance;
  }

  if (!occtLoading) {
    const occtimportjs = require('occt-import-js');
    occtLoading = occtimportjs().then((loaded: any) => {
      console.log('[step-parser] OCCT WASM loaded');
      occtInstance = loaded;
      return loaded;
    });
  }

  return occtLoading;
}

export async function parseStepFile(filePath: string, options: StepParseOptions = {}): Promise<StepParseResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const parts: ParsedPart[] = [];

  try {
    const occt = await getOcct();
    const fileContent = fs.readFileSync(filePath);
    const fileBytes = new Uint8Array(fileContent.buffer, fileContent.byteOffset, fileContent.byteLength);
    const result = occt.ReadStepFile(fileBytes, {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.001,
    }) as OcctResult;

    if (!result.success && isStepContainerWithoutGeometry(fileContent)) {
      return {
        success: true,
        parts: [],
        totalMeshes: 0,
        sheetMetalCount: 0,
        brepOk: 0,
        brepFlat: 0,
        brepUnfolded: 0,
        brepFallback: 0,
        brepTrace: [],
        errors: ['STEP file contains no geometry bodies.'],
        parseTimeMs: Date.now() - startTime,
      };
    }

    if (!result.success) {
      return {
        success: false,
        parts: [],
        totalMeshes: 0,
        sheetMetalCount: 0,
        brepOk: 0,
        brepFlat: 0,
        brepUnfolded: 0,
        brepFallback: 0,
        brepTrace: [],
        errors: [extractOcctError(result)],
        parseTimeMs: Date.now() - startTime,
      };
    }

    const meshes = result.meshes ?? [];
    const sourceMeshNames = extractStepOccurrenceNames(fileContent);
    const meshNames = extractMeshNames(result.root);
    const brepContours = await readBrepPartContours(fileBytes, {
      timeoutMs: BREP_PART_TIMEOUT_MS,
      material: options.material,
      resolveKFactor: options.resolveKFactor,
    });
    const brepByIndex = new Map<number, BrepContourResult>();
    const brepTrace: BrepTrace[] = [];
    let brepReadError: string | null = null;
    let brepFlat = 0;
    let brepUnfolded = 0;
    let brepFallback = 0;

    if (brepContours.ok) {
      for (const item of brepContours.results) {
        brepByIndex.set(item.solidIndex, item);
      }
    } else {
      brepReadError = brepContours.error ?? 'B-Rep reader failed';
    }

    for (let i = 0; i < meshes.length; i += 1) {
      const mesh = meshes[i];
      const brepResult = brepByIndex.get(i) ?? null;
      const exactContour = brepResult?.contour ?? null;

      try {
        const part = processMesh(mesh, i, meshNames, sourceMeshNames, errors, exactContour, brepResult);
        if (part) {
          parts.push(part);
          if (part.contourSource === 'EXACT_BREP') {
            brepFlat += 1;
            brepTrace.push({
              partName: part.name,
              source: part.contourSource,
              bendCount: part.bendCount,
              reason: null,
              elapsedMs: brepResult?.elapsedMs ?? null,
            });
          } else if (part.contourSource === 'UNFOLDED_BREP') {
            brepUnfolded += 1;
            brepTrace.push({
              partName: part.name,
              source: part.contourSource,
              bendCount: part.bendCount,
              reason: null,
              elapsedMs: brepResult?.elapsedMs ?? null,
            });
          } else {
            brepFallback += 1;
            brepTrace.push({
              partName: part.name,
              source: part.contourSource,
              bendCount: part.bendCount,
              reason: brepResult?.fallbackReason ?? brepReadError ?? 'no matching B-Rep solid',
              elapsedMs: brepResult?.elapsedMs ?? null,
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Mesh #${i + 1} (${mesh.name ?? 'unnamed'}): ${message}`);
      }
    }

    return {
      success: true,
      parts,
      totalMeshes: meshes.length,
      sheetMetalCount: parts.filter((part) => part.isSheetMetal).length,
      brepOk: brepFlat,
      brepFlat,
      brepUnfolded,
      brepFallback,
      brepTrace,
      errors,
      parseTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      parts: [],
      totalMeshes: 0,
      sheetMetalCount: 0,
      brepOk: 0,
      brepFlat: 0,
      brepUnfolded: 0,
      brepFallback: 0,
      brepTrace: [],
      errors: [`Failed to parse STEP file: ${message}`],
      parseTimeMs: Date.now() - startTime,
    };
  }
}

function extractMeshNames(root: OcctNode | undefined): Map<number, string> {
  const names = new Map<number, string>();

  function traverse(node: OcctNode, parentName: string): void {
    const nodeName = node.name || parentName;

    for (const meshIndex of node.meshes ?? []) {
      if (Number.isInteger(meshIndex) && nodeName) {
        names.set(meshIndex, nodeName);
      }
    }

    for (const child of node.children ?? []) {
      traverse(child, nodeName);
    }
  }

  if (root) {
    traverse(root, '');
  }

  return names;
}

function processMesh(
  mesh: OcctMesh,
  index: number,
  meshNames: Map<number, string>,
  sourceMeshNames: Map<number, string>,
  errors: string[],
  exactContour: BrepPartContour | null,
  brepResult: BrepContourResult | null
): ParsedPart | null {
  const positionArray = mesh.attributes?.position?.array;

  if (!positionArray || positionArray.length < 9) {
    return null;
  }

  const positions = toFloat32Array(positionArray);
  const indices = mesh.index?.array ? toUint32Array(mesh.index.array) : new Uint32Array();
  const hasIndexedTriangles = indices.length >= 3;
  const rawName = sourceMeshNames.get(index) || mesh.name || meshNames.get(index) || `Part_${index + 1}`;
  const name = normalizeCadText(rawName);
  const boundingBox = computeBoundingBox(positions);
  const meshArea = hasIndexedTriangles ? computeMeshArea(positions, indices) : 0;
  const meshVolume = hasIndexedTriangles ? computeMeshVolume(positions, indices) : 0;
  const facesCount = hasIndexedTriangles ? Math.floor(indices.length / 3) : 0;
  const classification = classifySheetMetalV2(boundingBox, positions, hasIndexedTriangles ? indices : null, 0.15);
  const warnings = [...classification.warnings];
  const holes: Point2D[][] = [];
  let contour: Point2D[] = [];
  let contourSource: ContourSource | null = null;

  if (exactContour) {
    contour = exactContour.contour;
    holes.push(...exactContour.holes);
    contourSource = exactContour.source;
    for (const warning of brepResult?.warnings ?? []) {
      errors.push(`${name}: ${warning}`);
    }
  } else if (classification.developedBlank) {
    contour = classification.developedBlank.contour;
    contourSource = 'RECT_ESTIMATE';
  } else if (classification.isSheetMetal) {
    try {
      if (indices.length >= 3) {
        contour = extractBoundaryContour(positions, indices, classification.projectionAxis);
        if (contour.length >= 3) {
          contourSource = 'EXACT_BOUNDARY';
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${name}: exact contour extraction failed (${message}), convex hull fallback used`);
    }
  }

  if (contour.length < 3) {
    const projected = projectTo2D(positions, classification.projectionAxis);
    contour = convexHull(projected);
    contourSource = 'CONVEX_HULL';
  }

  if (!exactContour) {
    contour = simplifyContour(contour, classification.isSheetMetal ? 0.5 : 1);
    contour = normalizeContour(contour);
    contour = ensureClockwise(contour);
  }

  const fallbackThickness = exactContour
    ? { thickness: exactContour.thickness, warning: null }
    : estimateFallbackThickness({
        classification,
        boundingBox,
        positions,
        indices: hasIndexedTriangles ? indices : null,
        meshVolume,
        meshArea,
      });
  if (fallbackThickness.warning) {
    warnings.push(fallbackThickness.warning);
  }
  const classificationWarning = warnings.length > 0 ? warnings.join('; ') : null;
  if (!exactContour && classificationWarning) {
    errors.push(`${name}: ${classificationWarning}`);
  }

  const { width, height } = exactContour ?? getContourSize(contour);
  const thumbnailSvg = generateThumbnailSvg(contour, holes);

  return {
    name,
    thickness: fallbackThickness.thickness,
    width,
    height,
    contour,
    holes,
    contourSource: contourSource ?? 'CONVEX_HULL',
    isSheetMetal: exactContour ? true : classification.isSheetMetal,
    hasBends: exactContour?.source === 'UNFOLDED_BREP' ? true : exactContour ? false : classification.hasBends,
    confidence: exactContour ? 0.98 : classification.confidence,
    classificationMethod: classification.method,
    classificationWarning: exactContour ? (brepResult?.warnings.join('; ') || null) : classificationWarning,
    thumbnailSvg,
    boundingBox,
    meshVolume,
    meshArea,
    facesCount,
    bendCount: exactContour?.source === 'UNFOLDED_BREP' ? exactContour.bendCount : 0,
    kFactor: exactContour?.source === 'UNFOLDED_BREP' ? exactContour.kFactor : null,
    kFactorDefaulted: exactContour?.source === 'UNFOLDED_BREP' ? exactContour.kFactorDefaulted : false,
  };
}

function estimateFallbackThickness(input: {
  classification: ReturnType<typeof classifySheetMetalV2>;
  boundingBox: BBox3D;
  positions: Float32Array;
  indices: Uint32Array | null;
  meshVolume: number;
  meshArea: number;
}): { thickness: number | null; warning: string | null } {
  const dims = [
    input.boundingBox.sizeX,
    input.boundingBox.sizeY,
    input.boundingBox.sizeZ,
  ].sort((a, b) => a - b);
  const minDim = dims[0] ?? 0;
  const volumeAreaThickness = roundReliableWallThickness(
    estimateWallThickness(input.meshVolume, input.meshArea),
    minDim
  );

  if (volumeAreaThickness !== null) {
    return { thickness: volumeAreaThickness, warning: null };
  }

  if (input.indices && input.indices.length >= 3) {
    const normals = extractTriangleNormals(input.positions, input.indices);
    const planePair = findDominantPlanePair(normals, input.positions);
    const planePairThickness = planePair.found
      ? roundReliableWallThickness(planePair.thickness, minDim)
      : null;

    if (planePairThickness !== null) {
      return { thickness: planePairThickness, warning: null };
    }
  }

  if (
    input.classification.isSheetMetal &&
    input.classification.thickness > 0 &&
    (
      input.classification.thickness <= 12 ||
      (input.classification.method === 'bbox' && !input.classification.hasBends && input.classification.confidence >= 0.7)
    )
  ) {
    return { thickness: input.classification.thickness, warning: null };
  }

  return { thickness: null, warning: 'толщина не определена' };
}

function roundReliableWallThickness(raw: number, minDim: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0 || minDim <= 0 || raw >= minDim * 0.5) {
    return null;
  }

  const rounded = roundToStandardThickness(raw);
  if (rounded <= 0 || rounded > 12) {
    return null;
  }

  return rounded;
}

function extractOcctError(result: OcctResult): string {
  if (result.error) {
    return result.error;
  }

  if (result.message) {
    return result.message;
  }

  return 'Unable to read STEP file. The file is damaged or uses an unsupported format.';
}

function isStepContainerWithoutGeometry(fileContent: Buffer): boolean {
  const content = fileContent.toString('utf8', 0, Math.min(fileContent.length, 2048)).toUpperCase();
  const hasStepEnvelope =
    content.includes('ISO-10303-21') &&
    content.includes('HEADER') &&
    content.includes('DATA') &&
    content.includes('END-ISO-10303-21');
  const dataSection = content.match(/DATA\s*;([\s\S]*?)ENDSEC\s*;/);

  if (!hasStepEnvelope || !dataSection) {
    return false;
  }

  const dataBody = dataSection[1].replace(/\s+/g, '');
  return dataBody.length === 0;
}

function getContourSize(contour: Point2D[]): { width: number; height: number } {
  if (contour.length === 0) {
    return { width: 0, height: 0 };
  }

  const xs = contour.map((point) => point.x);
  const ys = contour.map((point) => point.y);

  return {
    width: roundSize(Math.max(...xs) - Math.min(...xs)),
    height: roundSize(Math.max(...ys) - Math.min(...ys)),
  };
}

function roundSize(value: number): number {
  return Math.round(value * 10) / 10;
}

function toFloat32Array(value: Float32Array | number[]): Float32Array {
  if (value instanceof Float32Array) {
    return value;
  }

  return Float32Array.from(Array.from(value));
}

function toUint32Array(value: Uint32Array | number[]): Uint32Array {
  if (value instanceof Uint32Array) {
    return value;
  }

  return Uint32Array.from(Array.from(value));
}
