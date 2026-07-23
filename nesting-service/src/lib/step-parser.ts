import * as fs from 'node:fs';
import * as path from 'node:path';
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
import { extractStepOccurrenceMetadata, type StepOccurrenceMetadata } from './step-source-names';
import { normalizeCadText } from './text-encoding';
import { inferPartTypeFromGeometry, type PartType } from './part-type';

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
  assemblyPath: string[];
  thickness: number | null;
  width: number;
  height: number;
  contour: Point2D[];
  holes: Point2D[][];
  contourSource: ContourSource;
  isSheetMetal: boolean;
  partType: PartType;
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
  suspectedBend: boolean;
  fallbackReason: string | null;
}

export type ContourSource = 'EXACT_BREP' | 'UNFOLDED_BREP' | 'EXACT_BOUNDARY' | 'CONVEX_HULL' | 'RECT_ESTIMATE';

export type BrepTrace = {
  partName: string;
  assemblyPath: string[];
  source: ContourSource;
  bendCount: number;
  reason: string | null;
  suspectedBend?: boolean;
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
  sourceLabel?: string | null;
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
    const fallbackBaseName = buildFallbackBaseName(filePath, options.sourceLabel);
    const sourceOccurrences = extractStepOccurrenceMetadata(fileContent);
    const sourceMeshMetadata = matchStepOccurrencesToMeshes(meshes, sourceOccurrences);
    const meshMetadata = extractMeshMetadata(result.root);
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
        const part = processMesh(mesh, i, meshes.length, meshMetadata, sourceMeshMetadata, fallbackBaseName, errors, exactContour, brepResult);
        if (part) {
          parts.push(part);
          if (part.contourSource === 'EXACT_BREP') {
            brepFlat += 1;
            brepTrace.push({
              partName: part.name,
              assemblyPath: part.assemblyPath,
              source: part.contourSource,
              bendCount: part.bendCount,
              reason: null,
              suspectedBend: part.suspectedBend,
              elapsedMs: brepResult?.elapsedMs ?? null,
            });
          } else if (part.contourSource === 'UNFOLDED_BREP') {
            brepUnfolded += 1;
            brepTrace.push({
              partName: part.name,
              assemblyPath: part.assemblyPath,
              source: part.contourSource,
              bendCount: part.bendCount,
              reason: null,
              suspectedBend: part.suspectedBend,
              elapsedMs: brepResult?.elapsedMs ?? null,
            });
          } else {
            const fallbackReason = part.fallbackReason ?? brepResult?.fallbackReason ?? brepReadError ?? 'no matching B-Rep solid';
            brepFallback += 1;
            brepTrace.push({
              partName: part.name,
              assemblyPath: part.assemblyPath,
              source: part.contourSource,
              bendCount: part.bendCount,
              reason: fallbackReason,
              suspectedBend: part.suspectedBend,
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
      parts: normalizeCloneClassifications(parts),
      totalMeshes: meshes.length,
      sheetMetalCount: parts.filter((part) => part.partType === 'SHEET').length,
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

type MeshTreeMetadata = {
  name: string;
  assemblyPath: string[];
};

function matchStepOccurrencesToMeshes(
  meshes: OcctMesh[],
  occurrences: Map<number, StepOccurrenceMetadata>
): Map<number, StepOccurrenceMetadata> {
  const occurrenceList = Array.from(occurrences.values());
  const byDesignation = groupOccurrences(occurrenceList, (item) => extractOccurrenceDesignation(item.name));
  const result = new Map<number, StepOccurrenceMetadata>();

  meshes.forEach((mesh, meshIndex) => {
    const designation = extractOccurrenceDesignation(mesh.name ?? '');
    if (!designation) {
      const indexedOccurrence = occurrences.get(meshIndex);
      if (indexedOccurrence) {
        result.set(meshIndex, indexedOccurrence);
      }
      return;
    }
    const candidates = byDesignation.get(designation) ?? [];
    const indexedOccurrence = occurrences.get(meshIndex);
    const resolved = resolveUnambiguousOccurrence(
      candidates,
      indexedOccurrence &&
      extractOccurrenceDesignation(indexedOccurrence.name) === designation
        ? indexedOccurrence
        : null
    );
    if (resolved) {
      result.set(meshIndex, resolved);
    }
  });

  return result;
}

function groupOccurrences(
  occurrences: StepOccurrenceMetadata[],
  getKey: (item: StepOccurrenceMetadata) => string
): Map<string, StepOccurrenceMetadata[]> {
  const groups = new Map<string, StepOccurrenceMetadata[]>();
  for (const occurrence of occurrences) {
    const key = getKey(occurrence);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(occurrence);
    groups.set(key, group);
  }
  return groups;
}

function resolveUnambiguousOccurrence(
  candidates: StepOccurrenceMetadata[],
  indexedCandidate: StepOccurrenceMetadata | null
): StepOccurrenceMetadata | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const parentPaths = new Set(candidates.map((candidate) =>
    candidate.assemblyPath
      .slice(0, -1)
      .map(normalizeOccurrenceName)
      .join('>')
  ));
  if (parentPaths.size !== 1) return null;
  return indexedCandidate ?? candidates[0];
}

function extractOccurrenceDesignation(value: string): string {
  const normalized = normalizeCadText(value).replace(/[‐‑‒–—−]/g, '-');
  const matches = Array.from(normalized.matchAll(/(\d{2,4}\.\d{2}\.\d{3}(?:-\d{1,3})?)/g));
  return matches.at(-1)?.[1] ?? '';
}

function normalizeOccurrenceName(value: string): string {
  return normalizeCadText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[_\s]+(?:\d+|-?\d{2,3})$/u, '')
    .trim();
}

function isCompleteTreePath(
  metadata: MeshTreeMetadata | undefined,
  partName: string
): metadata is MeshTreeMetadata {
  if (!metadata || metadata.assemblyPath.length === 0) return false;
  const leafName = metadata.assemblyPath.at(-1) ?? '';
  const leafDesignation = extractOccurrenceDesignation(leafName);
  const partDesignation = extractOccurrenceDesignation(partName);
  if (leafDesignation && /\.000(?:-\d{1,3})?$/.test(leafDesignation) && leafDesignation !== partDesignation) {
    return false;
  }
  return true;
}

export function extractMeshMetadata(root: OcctNode | undefined): Map<number, MeshTreeMetadata> {
  const metadata = new Map<number, MeshTreeMetadata>();

  function traverse(node: OcctNode, parentPath: string[]): void {
    const normalizedName = normalizeCadText(node.name?.trim() ?? '');
    const assemblyPath = normalizedName
      ? [...parentPath, normalizedName]
      : parentPath;
    const nodeName = normalizedName || parentPath[parentPath.length - 1] || '';

    for (const meshIndex of node.meshes ?? []) {
      if (Number.isInteger(meshIndex) && nodeName) {
        const existing = metadata.get(meshIndex);
        if (!existing || assemblyPath.length > existing.assemblyPath.length) {
          metadata.set(meshIndex, {
            name: nodeName,
            assemblyPath,
          });
        }
      }
    }

    for (const child of node.children ?? []) {
      traverse(child, assemblyPath);
    }
  }

  if (root) {
    traverse(root, []);
  }

  return metadata;
}

function buildFallbackBaseName(filePath: string, sourceLabel?: string | null): string {
  const label = normalizeCadText(sourceLabel?.trim() ?? '');
  if (isUsableFallbackName(label)) {
    return label;
  }

  const fileName = normalizeCadText(path.parse(filePath).name);
  if (isUsableFallbackName(fileName)) {
    return fileName;
  }

  return 'Part';
}

function resolvePartName(rawName: string, fallbackBaseName: string, index: number, totalMeshes: number): string {
  const name = normalizeCadText(rawName);
  if (!isGenericCadName(name)) {
    return name;
  }

  return totalMeshes <= 1 ? fallbackBaseName : `${fallbackBaseName}_${index + 1}`;
}

function isUsableFallbackName(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && !isGenericCadName(normalized);
}

function isGenericCadName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (/^part[_\s-]*\d+$/i.test(normalized)) return true;
  if (normalized === 'single project') return true;
  return normalized.includes('open cascade step translator') || normalized.includes('open cascade shape model');
}

function processMesh(
  mesh: OcctMesh,
  index: number,
  totalMeshes: number,
  meshMetadata: Map<number, MeshTreeMetadata>,
  sourceMeshMetadata: Map<number, StepOccurrenceMetadata>,
  fallbackBaseName: string,
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
  const treeMetadata = meshMetadata.get(index);
  const sourceMetadata = sourceMeshMetadata.get(index);
  const meshName = mesh.name ?? '';
  const sourceCarriesExecutionSuffix =
    Boolean(extractExecutionSuffix(sourceMetadata?.name ?? '')) &&
    !extractExecutionSuffix(meshName);
  const rawName = isReadableCadName(meshName) && !sourceCarriesExecutionSuffix
    ? meshName
    : sourceMetadata?.name || meshName || treeMetadata?.name || `Part_${index + 1}`;
  const name = resolvePartName(rawName, fallbackBaseName, index, totalMeshes);
  const boundingBox = computeBoundingBox(positions);
  const meshArea = hasIndexedTriangles ? computeMeshArea(positions, indices) : 0;
  const meshVolume = hasIndexedTriangles ? computeMeshVolume(positions, indices) : 0;
  const facesCount = hasIndexedTriangles ? Math.floor(indices.length / 3) : 0;
  const classification = classifySheetMetalV2(boundingBox, positions, hasIndexedTriangles ? indices : null, 0.15);
  const warnings = [...classification.warnings];
  const holes: Point2D[][] = [];
  let contour: Point2D[] = [];
  let contourSource: ContourSource | null = null;
  const suspectedBend = brepResult?.suspectedBend === true;
  const brepFallbackReason = brepResult?.fallbackReason ?? null;

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
  const maxBBoxDim = Math.max(boundingBox.sizeX, boundingBox.sizeY, boundingBox.sizeZ);
  const hasBends = exactContour?.source === 'UNFOLDED_BREP' ? true : exactContour ? false : (suspectedBend || classification.hasBends);
  const hasLargeExactSheetContour =
    exactContour?.source === 'EXACT_BREP' &&
    fallbackThickness.thickness !== null &&
    maxBBoxDim >= 50;
  const isSheetMetal = hasBends || classification.isSheetMetal || hasLargeExactSheetContour;
  const partType = inferPartTypeFromGeometry({
    isSheetMetal,
    hasBends,
    bboxSizeX: boundingBox.sizeX,
    bboxSizeY: boundingBox.sizeY,
    bboxSizeZ: boundingBox.sizeZ,
  });

  if (fallbackThickness.warning && partType === 'SHEET') {
    warnings.push(fallbackThickness.warning);
  }
  const classificationWarning = partType === 'SHEET' && warnings.length > 0 ? warnings.join('; ') : null;
  if (!exactContour && classificationWarning) {
    errors.push(`${name}: ${classificationWarning}`);
  }
  if (!exactContour && suspectedBend) {
    const warning = `${name}: suspected bend requires review (${brepFallbackReason ?? 'B-Rep unfolding did not produce a validated blank'})`;
    warnings.push(warning);
    errors.push(warning);
  }
  const finalClassificationWarning = partType === 'SHEET' && warnings.length > 0 ? warnings.join('; ') : null;

  const { width, height } = exactContour ?? getContourSize(contour);
  const thumbnailSvg = generateThumbnailSvg(contour, holes);

  return {
    name,
    assemblyPath: sourceMetadata?.assemblyPath?.length
      ? sourceMetadata.assemblyPath
      : isCompleteTreePath(treeMetadata, name)
        ? treeMetadata!.assemblyPath
        : [],
    thickness: fallbackThickness.thickness,
    width,
    height,
    contour,
    holes,
    contourSource: contourSource ?? 'CONVEX_HULL',
    isSheetMetal: partType === 'SHEET',
    partType,
    hasBends: partType === 'SHEET' && hasBends,
    confidence: exactContour ? 0.98 : classification.confidence,
    classificationMethod: classification.method,
    classificationWarning: exactContour ? (brepResult?.warnings.join('; ') || null) : finalClassificationWarning,
    thumbnailSvg,
    boundingBox,
    meshVolume,
    meshArea,
    facesCount,
    bendCount: exactContour?.source === 'UNFOLDED_BREP' ? exactContour.bendCount : 0,
    kFactor: exactContour?.source === 'UNFOLDED_BREP' ? exactContour.kFactor : null,
    kFactorDefaulted: exactContour?.source === 'UNFOLDED_BREP' ? exactContour.kFactorDefaulted : false,
    suspectedBend,
    fallbackReason: exactContour ? null : brepFallbackReason,
  };
}

function isReadableCadName(value: string): boolean {
  const normalized = normalizeCadText(value);
  const designationIndex = normalized.search(/\d{2,4}\.\d{2}\.\d{3}/);
  const prefix = designationIndex >= 0 ? normalized.slice(0, designationIndex) : normalized;
  return /[A-Za-zА-Яа-яЁё]{2,}/u.test(prefix);
}

function extractExecutionSuffix(value: string): string {
  return value.match(/[_-](\d{2,3})(?:\s|$)/u)?.[1] ?? '';
}

function normalizeCloneClassifications(parts: ParsedPart[]): ParsedPart[] {
  const groups = new Map<string, ParsedPart[]>();

  for (const part of parts) {
    const key = buildCloneSignature(part);
    const group = groups.get(key) ?? [];
    group.push(part);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const partType = resolveClonePartType(group);
    const thickness = resolveCloneThickness(group);

    for (let index = 0; index < group.length; index += 1) {
      const part = group[index];
      Object.assign(part, {
        partType,
        isSheetMetal: partType === 'SHEET',
        hasBends: partType === 'SHEET' && part.hasBends,
        thickness,
        classificationWarning: partType === 'SHEET' ? part.classificationWarning : null,
      });
    }
  }

  return parts;
}

function buildCloneSignature(part: ParsedPart): string {
  const dims = [part.boundingBox.sizeX, part.boundingBox.sizeY, part.boundingBox.sizeZ]
    .map((value) => quantize(value, 0.5))
    .sort((a, b) => a - b)
    .join('x');

  return [
    normalizeCadText(part.name).toLowerCase(),
    dims,
    quantize(part.meshVolume, 1),
    quantize(part.meshArea, 1),
    part.facesCount,
  ].join('|');
}

function resolveClonePartType(group: ParsedPart[]): PartType {
  if (group.some((part) => part.partType === 'SHEET')) return 'SHEET';
  if (group.some((part) => part.partType === 'PURCHASED')) return 'PURCHASED';
  return 'PROFILE';
}

function resolveCloneThickness(group: ParsedPart[]): number | null {
  const counts = new Map<number, number>();

  for (const part of group) {
    if (typeof part.thickness !== 'number' || !Number.isFinite(part.thickness) || part.thickness <= 0) continue;
    const rounded = Math.round(part.thickness * 100) / 100;
    counts.set(rounded, (counts.get(rounded) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0]);
  return sorted[0]?.[0] ?? null;
}

function quantize(value: number, tolerance: number): number {
  return Math.round(value / tolerance) * tolerance;
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
