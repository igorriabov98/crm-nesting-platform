import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AISettingsView, OpenRouterConfig, SteelTypeCatalogItem } from './types';
import { getAISettingsView, getOpenRouterConfig } from './settings';
import { prisma } from '../prisma';

const ANALYSIS_CONTEXT_VERSION = 'project-pdf-analysis-v1';

type SteelTypeCatalogRow = {
  id: string;
  name: string;
  densityKgMm3: number | string | null;
};

export type ProjectAnalysisExecutionContext = {
  contextKey: string;
  steelTypes: SteelTypeCatalogItem[];
  settings: AISettingsView;
  openRouterConfig: OpenRouterConfig | null;
};

export async function loadProjectAnalysisExecutionContext(
  pdfFilePath: string
): Promise<ProjectAnalysisExecutionContext> {
  const openRouterConfig = await getOpenRouterConfig().catch(() => null);
  const [pdfBuffer, steelTypes, settings] = await Promise.all([
    readFile(pdfFilePath),
    loadSteelTypeCatalog(),
    getAISettingsView(),
  ]);

  return createProjectAnalysisExecutionContext({
    pdfSha256: createHash('sha256').update(pdfBuffer).digest('hex'),
    steelTypes,
    settings,
    openRouterConfig,
  });
}

export async function loadSteelTypeCatalog(): Promise<SteelTypeCatalogItem[]> {
  const rows = await prisma.$queryRaw<SteelTypeCatalogRow[]>`
    SELECT
      id::text AS "id",
      name,
      density_kg_mm3::double precision AS "densityKgMm3"
    FROM public.steel_types
    ORDER BY name, id
  `;

  return normalizeSteelTypeCatalog(rows);
}

export function createProjectAnalysisExecutionContext(input: {
  pdfSha256: string;
  steelTypes: SteelTypeCatalogItem[];
  settings: AISettingsView;
  openRouterConfig: OpenRouterConfig | null;
}): ProjectAnalysisExecutionContext {
  const steelTypes = normalizeSteelTypeCatalog(input.steelTypes);
  const effectiveProvider = input.openRouterConfig
    ? {
        configured: true,
        model: input.openRouterConfig.model,
        baseUrl: input.openRouterConfig.baseUrl,
        maxTokens: input.openRouterConfig.maxTokens,
      }
    : {
        configured: false,
        model: input.settings.model,
        baseUrl: input.settings.baseUrl,
        maxTokens: input.settings.maxTokens,
      };
  const contextKey = createHash('sha256')
    .update(JSON.stringify({
      version: ANALYSIS_CONTEXT_VERSION,
      pdfSha256: input.pdfSha256,
      provider: effectiveProvider,
      autoApplyResults: input.settings.autoApplyResults,
      steelTypes,
    }))
    .digest('hex');

  return {
    contextKey,
    steelTypes,
    settings: input.settings,
    openRouterConfig: input.openRouterConfig,
  };
}

function normalizeSteelTypeCatalog(
  rows: Array<SteelTypeCatalogItem | SteelTypeCatalogRow>
): SteelTypeCatalogItem[] {
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      densityKgMm3: row.densityKgMm3 === null || row.densityKgMm3 === undefined
        ? null
        : Number(row.densityKgMm3),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru') || left.id.localeCompare(right.id));
}
