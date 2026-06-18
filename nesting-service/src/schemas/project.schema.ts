import { z } from 'zod';

export const projectStatusSchema = z.enum(['created', 'parsing', 'parsed', 'calculating', 'done', 'error']);

export const projectListFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: projectStatusSchema.optional(),
  search: z.string().trim().optional(),
});

export const createProjectSchema = z.object({
  orderNumber: z.string().trim().min(1, 'Номер заказа обязателен').max(100),
  quantity: z.coerce.number().int().min(1).max(10000).default(1),
});

const storageUriSchema = z.string().trim().startsWith('supabase://').max(1200);

export const createStorageProjectSchema = createProjectSchema.extend({
  stepStorageUri: storageUriSchema,
  pdfStorageUri: storageUriSchema.optional().nullable(),
});

export const createBatchProjectSchema = z.object({
  orderNumber: z.string().trim().min(1).max(150),
  inputs: z.array(z.object({
    sourceId: z.string().trim().min(1).max(120),
    sourceType: z.string().trim().min(1).max(80).default('crm_machine_item'),
    machineId: z.string().trim().min(1).max(120).optional(),
    machineName: z.string().trim().max(200).optional(),
    machineItemId: z.string().trim().min(1).max(120).optional(),
    productId: z.string().trim().min(1).max(120).optional(),
    productName: z.string().trim().max(200).optional(),
    drawingNumber: z.string().trim().max(120).optional(),
    quantity: z.coerce.number().int().min(1).max(10000).default(1),
    stepField: z.string().trim().min(1).max(80),
    pdfField: z.string().trim().min(1).max(80).optional(),
    sortOrder: z.coerce.number().int().min(0).default(0),
  })).min(1).max(100),
});

export const createStorageBatchProjectSchema = z.object({
  orderNumber: z.string().trim().min(1).max(150),
  inputs: z.array(z.object({
    sourceId: z.string().trim().min(1).max(120),
    sourceType: z.string().trim().min(1).max(80).default('crm_machine_item'),
    machineId: z.string().trim().min(1).max(120).optional(),
    machineName: z.string().trim().max(200).optional(),
    machineItemId: z.string().trim().min(1).max(120).optional(),
    productId: z.string().trim().min(1).max(120).optional(),
    productName: z.string().trim().max(200).optional(),
    drawingNumber: z.string().trim().max(120).optional(),
    quantity: z.coerce.number().int().min(1).max(10000).default(1),
    stepStorageUri: storageUriSchema,
    pdfStorageUri: storageUriSchema.optional().nullable(),
    sortOrder: z.coerce.number().int().min(0).default(0),
  })).min(1).max(100),
});

export const updatePartSchema = z.object({
  material: z.enum(['Сталь', 'Нержавейка', 'Алюминий']).optional(),
  steelTypeId: z.string().min(1).nullable().optional(),
  steelTypeName: z.string().min(1).nullable().optional(),
  steelTypeRaw: z.string().min(1).nullable().optional(),
  quantity: z.number().int().min(1).optional(),
  grainLock: z.boolean().optional(),
  isSheetMetal: z.boolean().optional(),
  thickness: z.coerce.number().positive().max(50).optional(),
});

export const calculateSchema = z.object({
  strategy: z.enum(['minWaste', 'remnant', 'minSheets']).default('minWaste'),
});

export const projectPartParamsSchema = z.object({
  id: z.string().min(1),
  partId: z.string().min(1),
});

export const projectSheetParamsSchema = z.object({
  id: z.string().min(1),
  sheetId: z.string().min(1),
});

export type ProjectListFilter = z.infer<typeof projectListFilterSchema>;
export type CreateProject = z.infer<typeof createProjectSchema>;
export type CreateBatchProject = z.infer<typeof createBatchProjectSchema>;
export type CreateStorageProject = z.infer<typeof createStorageProjectSchema>;
export type CreateStorageBatchProject = z.infer<typeof createStorageBatchProjectSchema>;
export type UpdatePart = z.infer<typeof updatePartSchema>;
export type CalculateRequest = z.infer<typeof calculateSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
