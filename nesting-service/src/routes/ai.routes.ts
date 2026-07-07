import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError, NotFoundError, ValidationError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { idParamSchema } from '../schemas/common.schema';
import {
  analyzeProjectPdf,
  getProjectSpecification,
  markSpecificationMatchesApplied,
  markSpecificationMatchesReverted,
} from '../lib/ai/service';
import {
  AI_RECALC_REQUIRED_MESSAGE,
  buildRestorePartData,
  hasGeometryAffectingChange,
  parseAIApplySnapshot,
} from '../lib/ai/apply-control';
import { prepareBOMApplyUpdate, type BOMApplyBlockedRow } from '../lib/ai/bom-apply';
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
  autoApply: z.boolean().optional(),
  appliedBy: z.string().min(1).nullable().optional(),
});

const applyBomSchema = z.object({
  force: z.boolean().optional(),
  appliedBy: z.string().min(1).nullable().optional(),
  matches: z.array(
    z.object({
      partId: z.string().min(1),
      material: z.string().trim().min(1).max(120).optional(),
      steelTypeId: z.string().min(1).nullable().optional(),
      steelTypeName: z.string().min(1).nullable().optional(),
      steelTypeRaw: z.string().min(1).nullable().optional(),
      quantity: z.coerce.number().int().min(1).optional(),
      thickness: z.coerce.number().positive().max(50).optional(),
      isSheetMetal: z.boolean().optional(),
      partType: z.enum(['SHEET', 'PROFILE', 'PURCHASED']).optional(),
      hasBends: z.boolean().optional(),
      unfoldingWidth: z.coerce.number().positive().max(12000).optional(),
      unfoldingHeight: z.coerce.number().positive().max(12000).optional(),
    }).refine((value) =>
      value.material ||
      value.quantity ||
      value.thickness ||
      value.isSheetMetal !== undefined ||
      value.partType !== undefined ||
      value.hasBends !== undefined ||
      value.unfoldingWidth ||
      value.unfoldingHeight ||
      'steelTypeId' in value ||
      'steelTypeName' in value ||
      'steelTypeRaw' in value, {
      message: 'Нужно указать хотя бы одно изменение',
    })
  ),
});

const revertBomSchema = z.object({
  appliedBy: z.string().min(1).nullable().optional(),
  partIds: z.array(z.string().min(1)).optional(),
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
    if (project.inputs.length > 0) {
      // TODO(INTEGRATION_AUDIT.md §7): replace first-PDF batch analysis with per-input PDF analysis.
      throw new ValidationError('AI-анализ PDF для пакетной раскладки временно недоступен');
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
      autoApply: body.autoApply,
      appliedBy: body.appliedBy ?? null,
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
      where: { projectId: id, id: { in: body.matches.map((match) => match.partId) }, isActive: true },
      select: {
        id: true,
        name: true,
        material: true,
        steelTypeId: true,
        steelTypeName: true,
        steelTypeRaw: true,
        quantity: true,
        width: true,
        height: true,
        contourStale: true,
        thickness: true,
        isSheetMetal: true,
        partType: true,
        hasBends: true,
        classificationMethod: true,
        classificationWarning: true,
      },
    });
    const partsById = new Map(parts.map((part) => [part.id, part]));
    const pendingUpdates: Array<{ partId: string; data: Prisma.PartUpdateInput }> = [];
    const updatedPartIds = new Set<string>();
    const blockedPartIds = new Set<string>();
    const blocked: BOMApplyBlockedRow[] = [];
    const results: Array<{
      partId: string;
      partName?: string;
      status: 'applied' | 'blocked' | 'skipped' | 'not_found';
      reason?: BOMApplyBlockedRow['reason'];
      message?: string;
      requiresForce?: boolean;
    }> = [];
    let needsUnfoldRecalculation = false;
    const appliedAt = new Date();

    for (const match of body.matches) {
      const part = partsById.get(match.partId);
      if (!part) {
        results.push({ partId: match.partId, status: 'not_found', message: 'Деталь не найдена' });
        continue;
      }

      const prepared = prepareBOMApplyUpdate(match, part, {
        force: body.force === true,
        appliedBy: body.appliedBy ?? null,
        appliedAt,
      });

      if (prepared.status === 'blocked') {
        if (body.matches.length === 1 && body.force !== true) {
          throw new AppError(409, prepared.blocked.message, {
            partId: prepared.blocked.partId,
            mismatchNote: prepared.blocked.mismatchNote,
            thicknessMismatchNote: prepared.blocked.thicknessMismatchNote,
            blocked: prepared.blocked,
          });
        }
        blocked.push(prepared.blocked);
        blockedPartIds.add(prepared.blocked.partId);
        results.push({
          partId: prepared.blocked.partId,
          partName: prepared.blocked.partName,
          status: 'blocked',
          reason: prepared.blocked.reason,
          message: prepared.blocked.message,
          requiresForce: true,
        });
        continue;
      }

      if (prepared.status === 'skipped') {
        results.push({ partId: prepared.partId, partName: prepared.partName, status: 'skipped' });
        continue;
      }

      if (prepared.update.needsUnfoldRecalculation) {
        needsUnfoldRecalculation = true;
      }

      pendingUpdates.push({ partId: prepared.update.partId, data: prepared.update.data });
      updatedPartIds.add(prepared.update.partId);
      results.push({ partId: prepared.update.partId, partName: part.name, status: 'applied' });
    }

    for (const update of pendingUpdates) {
      await prisma.part.update({
        where: { id: update.partId },
        data: update.data,
      });
    }

    await markSpecificationMatchesApplied(id, updatedPartIds, {
      status: body.force === true ? 'applied_forced' : 'applied_manual',
      appliedBy: body.appliedBy ?? null,
      appliedAt,
    });
    await markSpecificationMatchesApplied(id, blockedPartIds, {
      status: 'needs_force',
      appliedBy: body.appliedBy ?? null,
    });
    if (needsUnfoldRecalculation) {
      await prisma.nestingProject.update({
        where: { id },
        data: {
          status: 'parsed',
          errorMessage: AI_RECALC_REQUIRED_MESSAGE,
        },
      });
    }

    return {
      updated: pendingUpdates.length,
      blocked,
      results,
    };
  });

  app.post('/:id/revert-bom', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = revertBomSchema.parse(request.body ?? {});
    const parts = await prisma.part.findMany({
      where: {
        projectId: id,
        ...(body.partIds && body.partIds.length > 0 ? { id: { in: body.partIds } } : {}),
      },
      select: {
        id: true,
        aiApplySnapshot: true,
        thickness: true,
        quantity: true,
        width: true,
        height: true,
        contourStale: true,
        isSheetMetal: true,
        partType: true,
      },
    });

    const revertedPartIds = new Set<string>();
    let needsUnfoldRecalculation = false;

    for (const part of parts) {
      const snapshot = parseAIApplySnapshot(part.aiApplySnapshot);
      if (!snapshot) continue;

      const restoreData = buildRestorePartData(snapshot);
      if (
        part.thickness !== snapshot.thickness ||
        part.quantity !== snapshot.quantity ||
        part.width !== snapshot.width ||
        part.height !== snapshot.height ||
        part.isSheetMetal !== snapshot.isSheetMetal ||
        part.partType !== snapshot.partType ||
        hasGeometryAffectingChange(restoreData)
      ) {
        needsUnfoldRecalculation = true;
      }

      await prisma.part.update({
        where: { id: part.id },
        data: restoreData,
      });
      revertedPartIds.add(part.id);
    }

    const revertedAt = new Date();
    await markSpecificationMatchesReverted(id, revertedPartIds, body.appliedBy ?? null, revertedAt);

    if (needsUnfoldRecalculation) {
      await prisma.nestingProject.update({
        where: { id },
        data: {
          status: 'parsed',
          errorMessage: AI_RECALC_REQUIRED_MESSAGE,
        },
      });
    }

    return { reverted: revertedPartIds.size };
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
      autoApplyResults: settings.autoApplyResults,
    };
  });

  app.post('/test-connection', async () => testOpenRouterConnection());
}
