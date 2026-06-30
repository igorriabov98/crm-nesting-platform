import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, NotFoundError, ValidationError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { idParamSchema } from '../schemas/common.schema';
import { analyzeProjectPdf, getProjectSpecification, markSpecificationMatchesApplied } from '../lib/ai/service';
import {
  aiSettingsInputSchema,
  getAISettingsView,
  getAIUsageHistory,
  hasOpenRouterApiKey,
  updateAISettings,
} from '../lib/ai/settings';
import { testOpenRouterConnection } from '../lib/ai/openrouter';
import { materializeValidatedStorageObject } from '../lib/storage';

const steelTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  densityKgMm3: z.coerce.number().nullable().optional(),
});

const analyzePdfSchema = z.object({
  steelTypes: z.array(steelTypeSchema).optional(),
});

const applyBomSchema = z.object({
  matches: z.array(
    z.object({
      partId: z.string().min(1),
      material: z.enum(['Сталь', 'Нержавейка', 'Алюминий']).optional(),
      steelTypeId: z.string().min(1).nullable().optional(),
      steelTypeName: z.string().min(1).nullable().optional(),
      steelTypeRaw: z.string().min(1).nullable().optional(),
      quantity: z.coerce.number().int().min(1).optional(),
      thickness: z.coerce.number().positive().max(50).optional(),
      isSheetMetal: z.boolean().optional(),
      unfoldingWidth: z.coerce.number().positive().max(12000).optional(),
      unfoldingHeight: z.coerce.number().positive().max(12000).optional(),
    }).refine((value) =>
      value.material ||
      value.quantity ||
      value.thickness ||
      value.isSheetMetal !== undefined ||
      value.unfoldingWidth ||
      value.unfoldingHeight ||
      'steelTypeId' in value ||
      'steelTypeName' in value ||
      'steelTypeRaw' in value, {
      message: 'Нужно указать хотя бы одно изменение',
    })
  ),
});

export async function aiProjectRoutes(app: FastifyInstance) {
  app.post('/:id/analyze-pdf', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = analyzePdfSchema.parse(request.body ?? {});
    const project = await prisma.nestingProject.findUnique({
      where: { id },
      select: {
        id: true,
        pdfFileUrl: true,
        pdfStorageUri: true,
        inputs: {
          select: { pdfFileUrl: true, pdfStorageUri: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!project) {
      throw new NotFoundError('Проект', id);
    }
    const pdfFileRef = project.pdfStorageUri
      ?? project.pdfFileUrl
      ?? project.inputs.find((input) => input.pdfStorageUri || input.pdfFileUrl)?.pdfStorageUri
      ?? project.inputs.find((input) => input.pdfFileUrl)?.pdfFileUrl
      ?? null;

    if (!pdfFileRef) {
      throw new ValidationError('PDF не загружен');
    }
    if (!pdfFileRef) {
      throw new ValidationError('PDF файл не найден на диске');
    }

    const materialized = await materializeValidatedStorageObject(pdfFileRef, 'pdf');
    const result = await analyzeProjectPdf({
      projectId: id,
      pdfFilePath: materialized.filePath,
      autoApply: true,
      steelTypes: body.steelTypes,
    }).finally(() => materialized.cleanup());

    if (!result.success) {
      throw new AppError(500, result.error || 'Ошибка анализа PDF через AI');
    }

    return {
      data: {
        bom: result.bom,
        matches: result.matches,
        unmatchedBom: result.unmatchedBom,
        details: result.details,
        tokensUsed: result.tokensUsed,
        model: result.model,
        cost: result.cost,
        budgetWarning: result.budgetWarning,
      },
    };
  });

  app.get('/:id/specification', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const specification = await getProjectSpecification(id);

    return { data: specification };
  });

  app.post('/:id/apply-bom', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = applyBomSchema.parse(request.body ?? {});
    const parts = await prisma.part.findMany({
      where: { projectId: id, id: { in: body.matches.map((match) => match.partId) } },
      select: { id: true },
    });
    const validPartIds = new Set(parts.map((part) => part.id));
    let updated = 0;
    const updatedPartIds = new Set<string>();

    for (const match of body.matches) {
      if (!validPartIds.has(match.partId)) continue;

      const data: {
        material?: string;
        quantity?: number;
        steelTypeId?: string | null;
        steelTypeName?: string | null;
        steelTypeRaw?: string | null;
        thickness?: number;
        isSheetMetal?: boolean;
        width?: number;
        height?: number;
        hasBends?: boolean;
      } = {};
      if (match.material) data.material = match.material;
      if (match.quantity) data.quantity = match.quantity;
      if ('steelTypeId' in match) data.steelTypeId = match.steelTypeId ?? null;
      if ('steelTypeName' in match) data.steelTypeName = match.steelTypeName ?? null;
      if ('steelTypeRaw' in match) data.steelTypeRaw = match.steelTypeRaw ?? null;
      if (match.thickness) data.thickness = match.thickness;
      if (match.isSheetMetal !== undefined) data.isSheetMetal = match.isSheetMetal;
      if (match.unfoldingWidth && match.unfoldingHeight) {
        data.width = match.unfoldingWidth;
        data.height = match.unfoldingHeight;
        data.hasBends = true;
      }
      if (Object.keys(data).length === 0) continue;

      await prisma.part.update({
        where: { id: match.partId },
        data,
      });
      updated += 1;
      updatedPartIds.add(match.partId);
    }

    await markSpecificationMatchesApplied(id, updatedPartIds);

    return { updated };
  });
}

export async function aiRoutes(app: FastifyInstance) {
  app.get('/settings', async () => getAISettingsView());

  app.put('/settings', async (request) => {
    const body = aiSettingsInputSchema.parse(request.body ?? {});
    return updateAISettings(body);
  });

  app.get('/usage', async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    return getAIUsageHistory(query.limit);
  });

  app.get('/status', async () => {
    const settings = await getAISettingsView();
    return {
      configured: await hasOpenRouterApiKey(),
      hasApiKey: settings.hasApiKey,
      budgetWarning: settings.budgetWarning,
      currentMonthUsage: settings.currentMonthUsage,
      monthlyBudget: settings.monthlyBudget,
    };
  });

  app.post('/test-connection', async () => testOpenRouterConnection());
}
