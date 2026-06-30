import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { NotFoundError } from '../errors';
import { analyzePDF, parsePDFAnalysisResponse } from './openrouter';
import { estimateCost, getAISettingsView, recordAIUsage } from './settings';
import { matchBOMToParts } from './bom-matcher';
import { resolveBOMSteelTypes } from './steel-types';
import type { BOMEntry, DetailEntry, MatchResult, PartForMatching, PDFAnalysisResult, SteelTypeCatalogItem } from './types';

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
  steelTypes?: SteelTypeCatalogItem[];
}): Promise<ProjectPdfAnalysisResult> {
  const pdfResult = await analyzePDF(input.pdfFilePath, { steelTypes: input.steelTypes });

  if (!pdfResult.success) {
    return buildFailedResult(pdfResult);
  }

  const bom = resolveBOMSteelTypes(pdfResult.bom, input.steelTypes ?? []);
  const parts = await prisma.part.findMany({
    where: { projectId: input.projectId },
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
      bboxSizeX: true,
      bboxSizeY: true,
      bboxSizeZ: true,
      meshVolume: true,
      meshArea: true,
      facesCount: true,
      isSheetMetal: true,
      hasBends: true,
    },
  });
  const matches = matchBOMToParts(bom, parts, pdfResult.details, input.steelTypes ?? []);
  const finalMatches = input.autoApply === false ? matches : await autoApplyMatches(matches);
  const unmatchedBom = getUnmatchedBom(bom, finalMatches);
  const cost = estimateCost(pdfResult.tokensUsed, pdfResult.model);

  await recordAIUsage({
    projectId: input.projectId,
    tokensUsed: pdfResult.tokensUsed,
    model: pdfResult.model,
    cost,
  });

  const settings = await getAISettingsView();
  const budgetWarning = settings.budgetWarning;

  await persistProjectSpecification({
    projectId: input.projectId,
    bom,
    details: pdfResult.details,
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
    details: pdfResult.details,
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

async function autoApplyMatches(matches: MatchResult[]): Promise<MatchResult[]> {
  const nextMatches = [...matches];

  for (let index = 0; index < nextMatches.length; index += 1) {
    const match = nextMatches[index];
    if (match.matchConfidence <= 0.8) continue;

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
    if (typeof match.suggestedThickness === 'number') data.thickness = match.suggestedThickness;
    if (match.suggestedUnfoldingWidth && match.suggestedUnfoldingHeight) {
      data.width = match.suggestedUnfoldingWidth;
      data.height = match.suggestedUnfoldingHeight;
      data.hasBends = !isFlatBOMSheet(match);
    }
    if (match.suggestedIsSheetMetal === true) {
      data.isSheetMetal = true;
      data.classificationMethod = 'pdf_bom';
      data.classificationWarning = null;
      if (isFlatBOMSheet(match)) data.hasBends = false;
    } else if (match.suggestedIsSheetMetal === false) {
      data.isSheetMetal = false;
    }
    if (typeof match.suggestedQuantity === 'number') data.quantity = match.suggestedQuantity;

    if (Object.keys(data).length === 0) continue;

    await prisma.part.update({
      where: { id: match.partId },
      data,
    });

    nextMatches[index] = { ...match, autoApplied: true };
  }

  return nextMatches;
}

function isFlatBOMSheet(match: Pick<MatchResult, 'bomName'>): boolean {
  const source = match.bomName.toLowerCase();
  return /\b(bl|blech|sheet)\b/.test(source) || /лист/.test(source);
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

export async function markSpecificationMatchesApplied(projectId: string, partIds: Set<string>): Promise<void> {
  if (partIds.size === 0) return;

  const specification = await prisma.projectSpecification.findUnique({
    where: { projectId },
    select: { matches: true },
  });

  if (!specification) return;

  const matches = Array.isArray(specification.matches) ? specification.matches : [];
  const nextMatches = matches.map((match) => {
    if (isMatchRecord(match) && partIds.has(match.partId)) {
      return { ...(match as Record<string, unknown>), autoApplied: true };
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

  return bom.filter((entry) => !matchedKeys.has(buildBomKey(entry.position, entry.designation, entry.name)));
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
