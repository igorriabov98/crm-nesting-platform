import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { NotFoundError } from '../errors';
import { analyzePDF, parsePDFAnalysisResponse } from './openrouter';
import { estimateCost, getAISettingsView, recordAIUsage } from './settings';
import { matchBOMToParts } from './bom-matcher';
import { applyDimensionGuard, applyThicknessGuard } from './dimension-guard';
import {
  AI_RECALC_REQUIRED_MESSAGE,
  buildAIApplySnapshot,
  hasAIApplyTrackedChange,
  hasNestingAffectingChange,
  type AIApplyStatus,
  type SnapshotPart,
} from './apply-control';
import { extractDeterministicPdfDataFromPdf, mergeDeterministicBOM, mergeDeterministicDetails } from './pdf-bom-fallback';
import { resolveBOMSteelTypes } from './steel-types';
import type { BOMEntry, DetailEntry, MatchResult, PartForMatching, PDFAnalysisResult, SteelTypeCatalogItem } from './types';
import { normalizePartType, partTypeFromLegacySheetFlag } from '../part-type';

export interface ProjectPdfAnalysisResult {
  success: boolean;
  bom: BOMEntry[];
  details: DetailEntry[];
  matches: MatchResult[];
  unmatchedBom: BOMEntry[];
  tokensUsed: number;
  model: string;
  cost: number;
  budgetWarning: boolean;
  error: string | null;
  rawResponse: string;
}

export async function analyzeProjectPdf(input: {
  projectId: string;
  pdfFilePath: string;
  autoApply?: boolean;
  appliedBy?: string | null;
  steelTypes?: SteelTypeCatalogItem[];
}): Promise<ProjectPdfAnalysisResult> {
  const pdfResult = await analyzePDF(input.pdfFilePath, { steelTypes: input.steelTypes });

  if (!pdfResult.success) {
    return buildFailedResult(pdfResult);
  }

  const deterministicPdfData = await loadDeterministicPdfData(input.pdfFilePath);
  const extractedBom = mergeDeterministicBOM(pdfResult.bom, deterministicPdfData.bom);
  const bom = resolveBOMSteelTypes(extractedBom, input.steelTypes ?? []);
  const details = mergeDeterministicDetails(pdfResult.details, deterministicPdfData.details);
  const parts = await prisma.part.findMany({
    where: { projectId: input.projectId, isActive: true },
    select: {
      id: true,
      name: true,
      material: true,
      steelTypeId: true,
      steelTypeName: true,
      steelTypeRaw: true,
      quantity: true,
      thickness: true,
      width: true,
      height: true,
      contourStale: true,
      contour: true,
      bboxSizeX: true,
      bboxSizeY: true,
      bboxSizeZ: true,
      meshVolume: true,
      meshArea: true,
      facesCount: true,
      isSheetMetal: true,
      partType: true,
      hasBends: true,
      classificationMethod: true,
      classificationWarning: true,
    },
  });
  const matches = matchBOMToParts(bom, parts, details, input.steelTypes ?? []);
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const settings = await getAISettingsView();
  const shouldAutoApply = input.autoApply ?? settings.autoApplyResults;
  const finalMatches = shouldAutoApply
    ? await autoApplyMatches(input.projectId, matches, partsById, input.appliedBy ?? null)
    : matches.map((match) => ({ ...match, applyStatus: 'suggested' as const }));
  const unmatchedBom = getUnmatchedBom(bom, finalMatches);
  const cost = estimateCost(pdfResult.tokensUsed, pdfResult.model);

  await recordAIUsage({
    projectId: input.projectId,
    tokensUsed: pdfResult.tokensUsed,
    model: pdfResult.model,
    cost,
  });

  const budgetWarning = settings.budgetWarning;

  await persistProjectSpecification({
    projectId: input.projectId,
    bom,
    details,
    matches: finalMatches,
    unmatchedBom,
    tokensUsed: pdfResult.tokensUsed,
    model: pdfResult.model,
    cost,
    budgetWarning,
    rawResponse: pdfResult.rawResponse,
  });

  return {
    success: true,
    bom,
    details,
    matches: finalMatches,
    unmatchedBom,
    tokensUsed: pdfResult.tokensUsed,
    model: pdfResult.model,
    cost,
    budgetWarning,
    error: null,
    rawResponse: pdfResult.rawResponse,
  };
}

export async function getProjectSpecification(projectId: string): Promise<Omit<ProjectPdfAnalysisResult, 'success' | 'error'> & {
  createdAt: Date;
  updatedAt: Date;
} | null> {
  const project = await prisma.nestingProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      specification: true,
    },
  });

  if (!project) {
    throw new NotFoundError('Проект', projectId);
  }

  if (!project.specification) {
    return null;
  }

  return {
    bom: project.specification.bom as unknown as BOMEntry[],
    details: parseStoredDetails(project.specification.rawResponse),
    matches: project.specification.matches as unknown as MatchResult[],
    unmatchedBom: project.specification.unmatchedBom as unknown as BOMEntry[],
    tokensUsed: project.specification.tokensUsed,
    model: project.specification.model,
    cost: project.specification.cost,
    budgetWarning: project.specification.budgetWarning,
    rawResponse: project.specification.rawResponse,
    createdAt: project.specification.createdAt,
    updatedAt: project.specification.updatedAt,
  };
}

async function autoApplyMatches(
  projectId: string,
  matches: MatchResult[],
  partsById: Map<string, SnapshotPart & { id: string; name: string }>,
  appliedBy: string | null
): Promise<MatchResult[]> {
  const nextMatches = [...matches];
  let needsUnfoldRecalculation = false;
  const appliedAt = new Date();

  for (let index = 0; index < nextMatches.length; index += 1) {
    const match = nextMatches[index];
    if (match.matchConfidence < 0.8) {
      nextMatches[index] = { ...match, applyStatus: 'suggested' };
      continue;
    }

    const data: Prisma.PartUpdateInput = {};
    if (match.suggestedMaterial) data.material = match.suggestedMaterial;
    if (match.suggestedSteelTypeId) {
      data.steelTypeId = match.suggestedSteelTypeId;
      data.steelTypeName = match.suggestedSteelTypeName;
      data.steelTypeRaw = match.suggestedSteelTypeRaw;
    } else if (match.suggestedSteelTypeRaw) {
      data.steelTypeId = null;
      data.steelTypeName = null;
      data.steelTypeRaw = match.suggestedSteelTypeRaw;
    }
    const part = partsById.get(match.partId);
    const thicknessGuard = part
      ? applyThicknessGuard(data, part, match.suggestedThickness)
      : null;
    if (thicknessGuard) {
      Object.assign(data, thicknessGuard.data);
    }
    if (thicknessGuard?.mismatch) {
      match.thicknessMismatch = true;
      match.thicknessMismatchNote = thicknessGuard.note;
    }
    const dimensionGuard = part
      ? applyDimensionGuard(data, part, match.suggestedUnfoldingWidth, match.suggestedUnfoldingHeight)
      : null;
    if (dimensionGuard) {
      Object.assign(data, dimensionGuard.data);
      if (dimensionGuard.dimensionsApplied) {
        data.contourStale = false;
      }
    }
    if (dimensionGuard?.mismatch) {
      match.applyStatus = 'needs_force';
    }
    if (match.suggestedHasBends !== null) data.hasBends = match.suggestedHasBends;
    if (match.suggestedPartType) {
      data.partType = match.suggestedPartType;
      data.isSheetMetal = match.suggestedPartType === 'SHEET';
      data.classificationMethod = 'pdf_bom';
      data.classificationWarning = null;
      if (match.suggestedPartType !== 'SHEET') {
        data.hasBends = false;
        data.grainLock = false;
        data.thicknessMismatch = false;
        data.thicknessMismatchNote = null;
      }
    } else if (match.suggestedIsSheetMetal === true) {
      data.partType = 'SHEET';
      data.isSheetMetal = true;
      data.classificationMethod = 'pdf_bom';
      data.classificationWarning = null;
    } else if (match.suggestedIsSheetMetal === false) {
      data.partType = 'PROFILE';
      data.isSheetMetal = false;
      data.hasBends = false;
      data.grainLock = false;
      data.classificationMethod = 'pdf_bom';
      data.classificationWarning = null;
    }
    const currentPartType = part
      ? normalizePartType(part.partType, partTypeFromLegacySheetFlag(part.isSheetMetal))
      : 'SHEET';
    const effectivePartType = typeof data.partType === 'string'
      ? normalizePartType(data.partType, currentPartType)
      : currentPartType;
    if (typeof match.suggestedQuantity === 'number' && effectivePartType === 'SHEET') {
      data.quantity = match.suggestedQuantity;
    }

    if (Object.keys(data).length === 0) continue;
    if (hasNestingAffectingChange(data)) {
      needsUnfoldRecalculation = true;
    }

    if (part && hasAIApplyTrackedChange(data)) {
      data.aiApplySnapshot = buildAIApplySnapshot(part, { appliedBy, appliedAt }) as unknown as Prisma.InputJsonValue;
    }

    await prisma.part.update({
      where: { id: match.partId },
      data,
    });

    const blockedByGuard = Boolean(thicknessGuard?.mismatch || dimensionGuard?.mismatch);
    nextMatches[index] = {
      ...match,
      autoApplied: !blockedByGuard,
      applyStatus: blockedByGuard ? 'needs_force' : 'applied_auto',
      appliedBy,
      appliedAt: appliedAt.toISOString(),
    };
  }

  if (needsUnfoldRecalculation) {
    await prisma.nestingProject.update({
      where: { id: projectId },
      data: {
        status: 'parsed',
        errorMessage: AI_RECALC_REQUIRED_MESSAGE,
      },
    });
  }

  return nextMatches;
}

async function loadDeterministicPdfData(pdfFilePath: string): Promise<{ bom: BOMEntry[]; details: DetailEntry[] }> {
  try {
    const data = await extractDeterministicPdfDataFromPdf(pdfFilePath);
    if (data.bom.length > 0 || data.details.length > 0) {
      console.log(`[ai] deterministic PDF parsed: ${data.bom.length} BOM entries, ${data.details.length} detail entries`);
    }
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ai] deterministic PDF fallback failed: ${message}`);
    return { bom: [], details: [] };
  }
}

async function persistProjectSpecification(input: {
  projectId: string;
  bom: BOMEntry[];
  details: DetailEntry[];
  matches: MatchResult[];
  unmatchedBom: BOMEntry[];
  tokensUsed: number;
  model: string;
  cost: number;
  budgetWarning: boolean;
  rawResponse: string;
}): Promise<void> {
  const data = {
    bom: input.bom as unknown as Prisma.InputJsonValue,
    matches: input.matches as unknown as Prisma.InputJsonValue,
    unmatchedBom: input.unmatchedBom as unknown as Prisma.InputJsonValue,
    tokensUsed: input.tokensUsed,
    model: input.model,
    cost: input.cost,
    budgetWarning: input.budgetWarning,
    rawResponse: input.rawResponse,
  };

  await prisma.projectSpecification.upsert({
    where: { projectId: input.projectId },
    create: {
      projectId: input.projectId,
      ...data,
    },
    update: data,
  });
}

export async function markSpecificationMatchesApplied(
  projectId: string,
  partIds: Set<string>,
  options: {
    status?: AIApplyStatus;
    appliedBy?: string | null;
    appliedAt?: Date;
    revertedBy?: string | null;
    revertedAt?: Date;
  } = {}
): Promise<void> {
  if (partIds.size === 0) return;

  const specification = await prisma.projectSpecification.findUnique({
    where: { projectId },
    select: { matches: true },
  });

  if (!specification) return;

  const matches = Array.isArray(specification.matches) ? specification.matches : [];
  const nextMatches = matches.map((match) => {
    if (isMatchRecord(match) && partIds.has(match.partId)) {
      const status = options.status ?? 'applied_manual';
      return {
        ...(match as Record<string, unknown>),
        autoApplied: status === 'applied_auto' || status === 'applied_manual' || status === 'applied_forced',
        applyStatus: status,
        appliedBy: options.appliedBy ?? (match as MatchResult).appliedBy ?? null,
        appliedAt: options.appliedAt?.toISOString() ?? (match as MatchResult).appliedAt ?? null,
        revertedBy: status === 'reverted' ? options.revertedBy ?? null : null,
        revertedAt: status === 'reverted' ? options.revertedAt?.toISOString() ?? null : null,
      };
    }
    return match;
  });

  await prisma.projectSpecification.update({
    where: { projectId },
    data: { matches: nextMatches as Prisma.InputJsonValue },
  });
}

export async function markSpecificationMatchesReverted(
  projectId: string,
  partIds: Set<string>,
  revertedBy?: string | null,
  revertedAt: Date = new Date()
): Promise<void> {
  if (partIds.size === 0) return;

  const specification = await prisma.projectSpecification.findUnique({
    where: { projectId },
    select: { matches: true },
  });

  if (!specification) return;

  const matches = Array.isArray(specification.matches) ? specification.matches : [];
  const nextMatches = matches.map((match) => {
    if (isMatchRecord(match) && partIds.has(match.partId)) {
      return {
        ...(match as Record<string, unknown>),
        autoApplied: false,
        applyStatus: 'reverted',
        revertedBy: revertedBy ?? null,
        revertedAt: revertedAt.toISOString(),
      };
    }
    return match;
  });

  await prisma.projectSpecification.update({
    where: { projectId },
    data: { matches: nextMatches as Prisma.InputJsonValue },
  });
}

function isMatchRecord(value: unknown): value is MatchResult {
  return typeof value === 'object' && value !== null && 'partId' in value && typeof value.partId === 'string';
}

function getUnmatchedBom(bom: BOMEntry[], matches: MatchResult[]): BOMEntry[] {
  const matchedKeys = new Set(
    matches
      .filter((match) => match.matchType !== 'none')
      .map((match) => buildBomKey(match.bomPosition, match.bomDesignation, match.bomName))
  );

  return bom.filter((entry) => !matchedKeys.has(buildBomKey(entry.position, entry.designation, entry.description || entry.name)));
}

function buildBomKey(position: string, designation: string, name: string): string {
  const designationKey = designation.trim().toLowerCase();
  if (designationKey) return `designation__${designationKey}`;
  return `${position.trim().toLowerCase()}__${name.trim().toLowerCase()}`;
}

function parseStoredDetails(rawResponse: string): DetailEntry[] {
  try {
    return parsePDFAnalysisResponse(rawResponse).details;
  } catch {
    return [];
  }
}

function buildFailedResult(pdfResult: PDFAnalysisResult): ProjectPdfAnalysisResult {
  return {
    success: false,
    bom: [],
    details: [],
    matches: [],
    unmatchedBom: [],
    tokensUsed: pdfResult.tokensUsed,
    model: pdfResult.model,
    cost: 0,
    budgetWarning: false,
    error: pdfResult.error,
    rawResponse: pdfResult.rawResponse,
  };
}

export type { MatchResult, PartForMatching };
