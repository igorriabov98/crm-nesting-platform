import { z } from 'zod';

export const materialSchema = z.enum(['Сталь', 'Нержавейка', 'Алюминий']);
const priceSchema = z.union([z.coerce.number().nonnegative(), z.null()]);
const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === 'false') return false;
  if (value === 'true') return true;
  return value;
}, z.boolean());

export const createSheetSchema = z.object({
  material: materialSchema,
  thickness: z.coerce.number().positive().max(50),
  width: z.coerce.number().positive().max(12000),
  height: z.coerce.number().positive().max(6000),
  price: priceSchema.optional(),
  stock: z.coerce.number().int().nonnegative().default(0),
});

export const updateSheetSchema = createSheetSchema.partial();

const gapBaseSchema = z.object({
  material: materialSchema,
  thicknessMin: z.coerce.number().nonnegative(),
  thicknessMax: z.coerce.number().nonnegative(),
  gap: z.coerce.number().positive().max(30),
});

export const createGapSchema = gapBaseSchema
  .refine((data) => data.thicknessMin <= data.thicknessMax, {
    message: 'thicknessMin должен быть меньше или равен thicknessMax',
    path: ['thicknessMin'],
  });

export const updateGapSchema = gapBaseSchema.partial().refine(
  (data) =>
    data.thicknessMin === undefined ||
    data.thicknessMax === undefined ||
    data.thicknessMin <= data.thicknessMax,
  {
    message: 'thicknessMin должен быть меньше или равен thicknessMax',
    path: ['thicknessMin'],
  }
);

const kFactorBaseSchema = z.object({
  material: materialSchema,
  thicknessMin: z.coerce.number().nonnegative(),
  thicknessMax: z.coerce.number().nonnegative(),
  kFactor: z.coerce.number().positive().max(1),
});

export const createKFactorSchema = kFactorBaseSchema
  .refine((data) => data.thicknessMin <= data.thicknessMax, {
    message: 'thicknessMin должен быть меньше или равен thicknessMax',
    path: ['thicknessMin'],
  });

export const updateKFactorSchema = kFactorBaseSchema.partial().refine(
  (data) =>
    data.thicknessMin === undefined ||
    data.thicknessMax === undefined ||
    data.thicknessMin <= data.thicknessMax,
  {
    message: 'thicknessMin должен быть меньше или равен thicknessMax',
    path: ['thicknessMin'],
  }
);

export const createRemnantSchema = z.object({
  material: materialSchema,
  thickness: z.coerce.number().positive().max(50),
  width: z.coerce.number().positive().max(12000),
  height: z.coerce.number().positive().max(6000),
  sourceOrder: z.string().min(1).optional(),
  sourceSheet: z.string().min(1).optional(),
});

export const updateRemnantSchema = createRemnantSchema.partial();

export const sheetFilterSchema = z.object({
  material: materialSchema.optional(),
  thickness: z.coerce.number().positive().optional(),
});

export const materialFilterSchema = z.object({
  material: materialSchema.optional(),
});

export const remnantFilterSchema = z.object({
  material: materialSchema.optional(),
  thickness: z.coerce.number().positive().optional(),
  availableOnly: booleanQuerySchema.default(true),
});

export type CreateSheet = z.infer<typeof createSheetSchema>;
export type UpdateSheet = z.infer<typeof updateSheetSchema>;
export type SheetFilter = z.infer<typeof sheetFilterSchema>;
export type CreateGap = z.infer<typeof createGapSchema>;
export type UpdateGap = z.infer<typeof updateGapSchema>;
export type CreateKFactor = z.infer<typeof createKFactorSchema>;
export type UpdateKFactor = z.infer<typeof updateKFactorSchema>;
export type CreateRemnant = z.infer<typeof createRemnantSchema>;
export type UpdateRemnant = z.infer<typeof updateRemnantSchema>;
export type RemnantFilter = z.infer<typeof remnantFilterSchema>;
