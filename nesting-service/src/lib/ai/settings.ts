import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../../config';
import { ValidationError } from '../errors';
import { prisma } from '../prisma';
import {
  DEFAULT_AI_MAX_TOKENS,
  DEFAULT_AI_AUTO_APPLY_RESULTS,
  DEFAULT_AI_MONTHLY_BUDGET,
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
  type AISettingsView,
  type AIUsageHistoryItem,
  type OpenRouterConfig,
} from './types';

const SETTINGS_ID = 'singleton';
const ENCRYPTION_PREFIX = 'aes-gcm:v1:';
const PREVIOUS_DEFAULT_OPENROUTER_MODEL: string = 'anthropic/claude-sonnet-4-20250514';

export const aiSettingsInputSchema = z.object({
  apiKey: z.string().trim().optional(),
  model: z.string().trim().min(1).optional(),
  baseUrl: z.string().trim().url().optional(),
  maxTokens: z.coerce.number().int().min(256).max(32000).optional(),
  monthlyBudget: z.coerce.number().min(0).max(100000).optional(),
  autoApplyResults: z.boolean().optional(),
});

export type AISettingsInput = z.infer<typeof aiSettingsInputSchema>;

export async function getOpenRouterConfig(): Promise<OpenRouterConfig> {
  const stored = await getStoredAISettings();
  const storedKey = await decryptStoredApiKey(stored?.apiKey ?? null);
  const apiKey = storedKey || config.OPENROUTER_API_KEY || '';
  const model = stored?.model || config.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  const baseUrl = normalizeBaseUrl(stored?.baseUrl || config.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL);
  const maxTokens = stored?.maxTokens || DEFAULT_AI_MAX_TOKENS;
  const monthlyBudget = stored?.monthlyBudget ?? DEFAULT_AI_MONTHLY_BUDGET;

  if (!apiKey) {
    throw new ValidationError('OpenRouter API ключ не настроен. Настройте его в разделе "Настройки AI".');
  }

  return { apiKey, model, baseUrl, maxTokens, monthlyBudget };
}

export async function hasOpenRouterApiKey(): Promise<boolean> {
  try {
    const stored = await prisma.aISettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { apiKey: true },
    });
    const storedKey = await decryptStoredApiKey(stored?.apiKey ?? null);
    return Boolean(storedKey || config.OPENROUTER_API_KEY);
  } catch {
    return Boolean(config.OPENROUTER_API_KEY);
  }
}

export async function getAISettingsView(): Promise<AISettingsView> {
  const stored = await getStoredAISettings();
  const [usage, totalRequests, hasApiKey] = await Promise.all([
    getCurrentMonthUsage(),
    prisma.aIUsageLog.count(),
    hasOpenRouterApiKey(),
  ]);

  const currentMonthUsage = roundMoney(usage.cost);
  const averageRequestCost = usage.requests > 0 ? roundMoney(usage.cost / usage.requests) : 0;
  const monthlyBudget = stored?.monthlyBudget ?? DEFAULT_AI_MONTHLY_BUDGET;
  const autoApplyResults = stored?.autoApplyResults ?? DEFAULT_AI_AUTO_APPLY_RESULTS;

  return {
    model: stored?.model || config.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
    baseUrl: normalizeBaseUrl(stored?.baseUrl || config.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL),
    hasApiKey,
    maxTokens: stored?.maxTokens || DEFAULT_AI_MAX_TOKENS,
    monthlyBudget,
    currentMonthUsage,
    currentMonthRequests: usage.requests,
    totalRequests,
    averageRequestCost,
    budgetWarning: monthlyBudget > 0 && currentMonthUsage > monthlyBudget,
    autoApplyResults,
  };
}

export async function updateAISettings(input: AISettingsInput): Promise<AISettingsView> {
  const data: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    maxTokens?: number;
    monthlyBudget?: number;
    autoApplyResults?: boolean;
  } = {};

  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    data.apiKey = encryptApiKey(input.apiKey.trim());
  }
  if (input.model) data.model = input.model;
  if (input.baseUrl) data.baseUrl = normalizeBaseUrl(input.baseUrl);
  if (typeof input.maxTokens === 'number') data.maxTokens = input.maxTokens;
  if (typeof input.monthlyBudget === 'number') data.monthlyBudget = input.monthlyBudget;
  if (typeof input.autoApplyResults === 'boolean') data.autoApplyResults = input.autoApplyResults;

  await prisma.aISettings.upsert({
    where: { id: SETTINGS_ID },
    update: data,
    create: {
      id: SETTINGS_ID,
      model: data.model || config.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
      baseUrl: data.baseUrl || config.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL,
      maxTokens: data.maxTokens || DEFAULT_AI_MAX_TOKENS,
      monthlyBudget: data.monthlyBudget ?? DEFAULT_AI_MONTHLY_BUDGET,
      autoApplyResults: data.autoApplyResults ?? DEFAULT_AI_AUTO_APPLY_RESULTS,
      apiKey: data.apiKey,
    },
  });

  return getAISettingsView();
}

export async function getAIUsageHistory(limit = 50): Promise<{ data: AIUsageHistoryItem[]; total: number }> {
  const [logs, total] = await prisma.$transaction([
    prisma.aIUsageLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    }),
    prisma.aIUsageLog.count(),
  ]);

  const projectIds = Array.from(new Set(logs.map((log) => log.projectId)));
  const projects = projectIds.length
    ? await prisma.nestingProject.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, orderNumber: true },
      })
    : [];
  const orderByProjectId = new Map(projects.map((project) => [project.id, project.orderNumber]));

  return {
    data: logs.map((log) => ({
      id: log.id,
      projectId: log.projectId,
      orderNumber: orderByProjectId.get(log.projectId) || log.projectId,
      tokensUsed: log.tokensUsed,
      model: log.model,
      cost: roundMoney(log.cost),
      createdAt: log.createdAt.toISOString(),
    })),
    total,
  };
}

export async function recordAIUsage(input: {
  projectId: string;
  tokensUsed: number;
  model: string;
  cost: number;
}): Promise<void> {
  await prisma.aIUsageLog.create({
    data: {
      projectId: input.projectId,
      tokensUsed: Math.max(0, Math.round(input.tokensUsed)),
      model: input.model,
      cost: roundMoney(input.cost),
    },
  });
}

export function estimateCost(tokens: number, _model: string): number {
  return roundMoney(tokens * 0.00001);
}

export async function getBudgetWarning(): Promise<boolean> {
  const settings = await getAISettingsView();
  return settings.budgetWarning;
}

function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX.slice(0, -1),
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

async function decryptStoredApiKey(value: string | null): Promise<string> {
  if (!value) return '';

  if (!value.startsWith(ENCRYPTION_PREFIX)) {
    return value.trim();
  }

  try {
    const [algorithm, version, ivText, tagText, encryptedText] = value.split(':');
    if (algorithm !== 'aes-gcm' || version !== 'v1' || !ivText || !tagText || !encryptedText) {
      throw new Error('invalid encrypted key format');
    }

    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8').trim();
  } catch (error) {
    console.warn('[ai-settings] Не удалось расшифровать OpenRouter API ключ из БД:', error instanceof Error ? error.message : error);
    return '';
  }
}

function getEncryptionKey(): Buffer {
  const secret = config.AI_SETTINGS_ENCRYPTION_KEY || config.DATABASE_URL;
  return createHash('sha256').update(secret).digest();
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

async function getStoredAISettings() {
  await upgradeStoredDefaultModel();
  return prisma.aISettings.findUnique({ where: { id: SETTINGS_ID } });
}

async function upgradeStoredDefaultModel(): Promise<void> {
  if (DEFAULT_OPENROUTER_MODEL === PREVIOUS_DEFAULT_OPENROUTER_MODEL) return;

  await prisma.aISettings.updateMany({
    where: {
      id: SETTINGS_ID,
      model: PREVIOUS_DEFAULT_OPENROUTER_MODEL,
    },
    data: {
      model: DEFAULT_OPENROUTER_MODEL,
    },
  });
}

async function getCurrentMonthUsage(): Promise<{ cost: number; requests: number }> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [usage, requests] = await Promise.all([
    prisma.aIUsageLog.aggregate({
      where: { createdAt: { gte: start } },
      _sum: { cost: true },
    }),
    prisma.aIUsageLog.count({
      where: { createdAt: { gte: start } },
    }),
  ]);

  return { cost: usage._sum.cost ?? 0, requests };
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 10000) / 10000;
}
