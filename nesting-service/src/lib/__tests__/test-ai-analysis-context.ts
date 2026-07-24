import assert from 'node:assert/strict';
import type { AISettingsView, BOMEntry, SteelTypeCatalogItem } from '../ai/types';

async function main(): Promise<void> {
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test?schema=nesting';
  const { createProjectAnalysisExecutionContext } = await import('../ai/analysis-context');
  const { resolveBOMSteelTypes } = await import('../ai/steel-types');

  const steelTypes: SteelTypeCatalogItem[] = [
    { id: 'steel-st3sp', name: 'Ст3сп', densityKgMm3: 0.00000785 },
    { id: 'steel-st3ps', name: 'Ст3пс', densityKgMm3: 0.00000785 },
  ];
  const settings: AISettingsView = {
    model: 'anthropic/claude-sonnet-4.6',
    baseUrl: 'https://openrouter.ai/api/v1',
    hasApiKey: true,
    maxTokens: 32000,
    monthlyBudget: 50,
    currentMonthUsage: 1,
    currentMonthRequests: 1,
    totalRequests: 1,
    averageRequestCost: 1,
    budgetWarning: false,
    autoApplyResults: true,
  };
  const openRouterConfig = {
    apiKey: 'test-key',
    model: settings.model,
    baseUrl: settings.baseUrl,
    maxTokens: settings.maxTokens,
    monthlyBudget: settings.monthlyBudget,
  };

  const workerContext = createProjectAnalysisExecutionContext({
    pdfSha256: 'same-pdf',
    steelTypes,
    settings,
    openRouterConfig,
  });
  const httpContext = createProjectAnalysisExecutionContext({
    pdfSha256: 'same-pdf',
    steelTypes: [...steelTypes].reverse(),
    settings,
    openRouterConfig,
  });
  assert.equal(
    workerContext.contextKey,
    httpContext.contextKey,
    'worker and HTTP calls must normalize to one analysis context'
  );
  assert.deepEqual(workerContext.steelTypes, httpContext.steelTypes);

  const rawBom: BOMEntry[] = [{
    articleNumber: '',
    position: '1',
    designation: 'ЭТЛ-03.001',
    description: 'Уголок гнутый',
    bomSection: 'Детали',
    partType: 'sheet',
    thicknessMm: 2,
    widthMm: null,
    heightMm: null,
    massKg: null,
    materialGrade: 'Ст3сп',
    materialType: 'Сталь',
    norm: '',
    name: 'Уголок гнутый',
    material: 'Ст3сп',
    steelTypeRaw: null,
    steelTypeId: null,
    steelTypeName: null,
    steelTypeWarning: null,
    quantity: 1,
    thickness: 2,
    notes: '',
  }];
  const workerResult = resolveBOMSteelTypes(rawBom, workerContext.steelTypes);
  const httpResult = resolveBOMSteelTypes(rawBom, httpContext.steelTypes);
  assert.deepEqual(workerResult, httpResult, 'steel resolution must not depend on the caller');
  assert.equal(workerResult[0].steelTypeId, 'steel-st3sp');

  const differentContext = createProjectAnalysisExecutionContext({
    pdfSha256: 'same-pdf',
    steelTypes,
    settings: { ...settings, autoApplyResults: false },
    openRouterConfig,
  });
  assert.notEqual(
    workerContext.contextKey,
    differentContext.contextKey,
    'nesting-affecting analysis parameters must produce a different lease context'
  );

  console.log('[ai-analysis-context] caller parity, steel resolution, and context hashing passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
