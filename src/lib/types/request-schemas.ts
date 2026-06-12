import { z } from 'zod'

const emptyToUndefined = (value: unknown) => {
  if (value === '' || value === undefined) return undefined
  return value
}

const optionalString = z.preprocess(emptyToUndefined, z.string().nullable().optional())
const optionalUuid = z.preprocess(emptyToUndefined, z.string().uuid().nullable().optional())
const optionalNumber = (schema: z.ZodNumber) => z.preprocess(emptyToUndefined, z.coerce.number().pipe(schema).nullable().optional())
const requiredNumber = (schema: z.ZodNumber) => z.coerce.number().pipe(schema)
const optionalBoolean = z.preprocess(emptyToUndefined, z.coerce.boolean().optional())

export const availabilitySchema = z.enum(['available', 'unavailable', 'partial', 'unknown'])
export const pipeSubtypeSchema = z.enum(['square', 'rectangular', 'round', 'wire'])
export const chainCordSubtypeSchema = z.enum(['chain', 'cord'])
const PAINT_FINISH_VALUES = ['\u043c\u0430\u0442\u043e\u0432\u044b\u0439', '\u0433\u043b\u044f\u043d\u0435\u0446', '\u0448\u0430\u0433\u0440\u0435\u043d\u044c'] as const

const normalizePaintFinish = (value: unknown) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes('\u043c\u0430\u0442')) return '\u043c\u0430\u0442\u043e\u0432\u044b\u0439'
  if (normalized.includes('\u0433\u043b\u044f\u043d')) return '\u0433\u043b\u044f\u043d\u0435\u0446'
  if (normalized.includes('\u0448\u0430\u0433\u0440')) return '\u0448\u0430\u0433\u0440\u0435\u043d\u044c'
  return undefined
}

export const paintFinishSchema = z.enum(PAINT_FINISH_VALUES)
const optionalPaintFinish = z.preprocess((value) => normalizePaintFinish(emptyToUndefined(value)), paintFinishSchema.optional())

export const sheetMetalSchema = z.object({
  material_name: optionalString,
  material_grade: optionalString,
  steel_type_id: optionalUuid,
  sheet_size: optionalString,
  thickness_mm: optionalNumber(z.number().positive('Должно быть больше 0')),
  remainder_qty: requiredNumber(z.number().int().min(0)).default(0),
  material_id: optionalUuid,
  material_variant_id: optionalUuid,
  is_custom_material_variant: optionalBoolean,
  custom_delivery_date: optionalString,
  sort_order: optionalNumber(z.number().int().min(0)),
})

// @deprecated - используется только для обратной совместимости
export const roundTubeSchema = z.object({
  material_name: z.string().min(1, 'Укажите название материала'),
  order_meters: requiredNumber(z.number().min(0)).default(0),
  order_kg: requiredNumber(z.number().min(0)).default(0),
  actual_meters: optionalNumber(z.number().min(0)),
  actual_kg: optionalNumber(z.number().min(0)),
  piece_count: optionalString,
  custom_delivery_date: optionalString,
  material_id: optionalUuid,
  material_variant_id: optionalUuid,
  sort_order: optionalNumber(z.number().int().min(0)),
})

export const circleSchema = z.object({
  diameter_mm: optionalNumber(z.number().positive()),
  steel_grade: optionalString,
  steel_type_id: optionalUuid,
  is_calibrated: optionalBoolean.default(false),
  remainder_mm: requiredNumber(z.number().min(0)).default(0),
  material_id: optionalUuid,
  material_variant_id: optionalUuid,
  is_custom_material_variant: optionalBoolean,
  custom_delivery_date: optionalString,
  sort_order: optionalNumber(z.number().int().min(0)),
})

export const pipeSchema = z.object({
  pipe_type: pipeSubtypeSchema,
  steel_type_id: optionalUuid,
  size: optionalString,
  wall_thickness_mm: optionalNumber(z.number().positive()),
  diameter_mm: optionalNumber(z.number().positive()),
  remainder_length_mm: requiredNumber(z.number().min(0)).default(0),
  remainder_qty: requiredNumber(z.number().int().min(0)).default(0),
  remainder_kg: requiredNumber(z.number().min(0)).default(0),
  material_id: optionalUuid,
  material_variant_id: optionalUuid,
  is_custom_material_variant: optionalBoolean,
  custom_delivery_date: optionalString,
  sort_order: optionalNumber(z.number().int().min(0)),
})

export const knifeSchema = z.object({
  knife_type: optionalString,
  steel_grade: optionalString,
  steel_type_id: optionalUuid,
  length_mm: optionalNumber(z.number().positive()),
  width_mm: optionalNumber(z.number().positive()),
  height_mm: optionalNumber(z.number().positive()),
  remainder_meters: requiredNumber(z.number().min(0)).default(0),
  remainder_qty: requiredNumber(z.number().int().min(0)).default(0),
  material_id: optionalUuid,
  material_variant_id: optionalUuid,
  is_custom_material_variant: optionalBoolean,
  custom_delivery_date: optionalString,
  sort_order: optionalNumber(z.number().int().min(0)),
})

export const componentSchema = z.object({
  component_name: optionalString,
  diameter_mm: optionalNumber(z.number().positive()),
  quantity_needed: optionalNumber(z.number().int().min(0)),
  stock_remainder: requiredNumber(z.number().int().min(0)).default(0),
  unit: z.preprocess(emptyToUndefined, z.string().default('шт')),
  material_id: optionalUuid,
  material_variant_id: optionalUuid,
  is_custom_material_variant: optionalBoolean,
  custom_delivery_date: optionalString,
  sort_order: optionalNumber(z.number().int().min(0)),
})

export const paintSchema = z.object({
  paint_type: optionalString,
  ral_code: optionalString,
  finish: optionalPaintFinish,
  remainder_kg: requiredNumber(z.number().min(0)).default(0),
  material_id: optionalUuid,
  material_variant_id: optionalUuid,
  is_custom_material_variant: optionalBoolean,
  custom_delivery_date: optionalString,
  sort_order: optionalNumber(z.number().int().min(0)),
})

export const meshSchema = z.object({
  description: optionalString,
  length_mm: optionalNumber(z.number().positive()),
  width_mm: optionalNumber(z.number().positive()),
  remainder_qty: requiredNumber(z.number().int().min(0)).default(0),
  material_id: optionalUuid,
  material_variant_id: optionalUuid,
  is_custom_material_variant: optionalBoolean,
  custom_delivery_date: optionalString,
  sort_order: optionalNumber(z.number().int().min(0)),
})

export const chainCordSchema = z.object({
  item_type: chainCordSubtypeSchema,
  parameters: optionalString,
  remainder_meters: requiredNumber(z.number().min(0)).default(0),
  material_id: optionalUuid,
  material_variant_id: optionalUuid,
  is_custom_material_variant: optionalBoolean,
  custom_delivery_date: optionalString,
  sort_order: optionalNumber(z.number().int().min(0)),
})

export const sheetMetalUpdateSchema = sheetMetalSchema.partial()
export const roundTubeUpdateSchema = roundTubeSchema.partial()
export const circleUpdateSchema = circleSchema.partial()
export const pipeUpdateSchema = pipeSchema.partial()
export const knifeUpdateSchema = knifeSchema.partial()
export const componentUpdateSchema = componentSchema.partial()
export const paintUpdateSchema = paintSchema.partial()
export const meshUpdateSchema = meshSchema.partial()
export const chainCordUpdateSchema = chainCordSchema.partial()

export type SheetMetalInput = z.infer<typeof sheetMetalSchema>
/** @deprecated Используется только для обратной совместимости. */
export type RoundTubeInput = z.infer<typeof roundTubeSchema>
export type CircleInput = z.infer<typeof circleSchema>
export type PipeInput = z.infer<typeof pipeSchema>
export type KnifeInput = z.infer<typeof knifeSchema>
export type ComponentInput = z.infer<typeof componentSchema>
export type PaintInput = z.infer<typeof paintSchema>
export type MeshInput = z.infer<typeof meshSchema>
export type ChainCordInput = z.infer<typeof chainCordSchema>
export type AvailabilityInput = z.infer<typeof availabilitySchema>
