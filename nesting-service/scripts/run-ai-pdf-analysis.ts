import { existsSync } from 'node:fs';
import { analyzePDF } from '../src/lib/ai/openrouter';
import { DEFAULT_AI_MAX_TOKENS } from '../src/lib/ai/types';

async function main(): Promise<void> {
  const pdfFilePath = process.argv[2];
  if (!pdfFilePath || !existsSync(pdfFilePath)) {
    throw new Error('Usage: tsx scripts/run-ai-pdf-analysis.ts <pdf-file> [max-tokens] [--expect-truncated]');
  }

  const runtimeConfig = await loadStoredConfigReadOnly();
  const maxTokens = Number(process.argv[3] || DEFAULT_AI_MAX_TOKENS);
  if (!Number.isInteger(maxTokens) || maxTokens < 1) throw new Error(`Invalid max tokens: ${process.argv[3]}`);
  const expectTruncated = process.argv.includes('--expect-truncated');

  const result = await analyzePDF(pdfFilePath, {
    maxTokens,
    configOverride: runtimeConfig,
  });

  const bomGroups = Array.from(new Set(result.bom.map((entry) => `${entry.bomSection || '—'} | ${entry.parentAssembly || '—'}`))).sort();
  const thicknesses = Array.from(new Set(result.details.map((detail) => detail.thicknessMm).filter((value) => value > 0))).sort((a, b) => a - b);
  console.log(JSON.stringify({
    success: result.success,
    failureKind: result.failureKind,
    finishReason: result.finishReason,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    maxTokens: result.maxTokens,
    bomRows: result.bom.length,
    details: result.details.length,
    thicknesses,
    bomGroups,
    error: result.error,
  }, null, 2));

  if (expectTruncated) {
    assertExpectedTruncation(result.failureKind, result.finishReason);
    return;
  }
  if (!result.success) process.exitCode = 1;
}

async function loadStoredConfigReadOnly(): Promise<{ apiKey: string; model: string; baseUrl: string }> {
  const { getOpenRouterConfigReadOnly } = await import('../src/lib/ai/settings');
  const { prisma } = await import('../src/lib/prisma');
  try {
    const config = await getOpenRouterConfigReadOnly();
    return { apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl };
  } finally {
    await prisma.$disconnect();
  }
}

function assertExpectedTruncation(failureKind: string | null, finishReason: string | null): void {
  if (failureKind !== 'truncated' || (finishReason !== 'length' && finishReason !== 'max_tokens')) {
    throw new Error(`Expected truncation, got failureKind=${failureKind}, finishReason=${finishReason}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
