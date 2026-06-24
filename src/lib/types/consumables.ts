import { z } from 'zod'

export const consumablePrioritySchema = z.enum(['standard', 'high'])
export const consumableStatusSchema = z.enum([
  'draft',
  'new',
  'invoice_taken',
  'delivery',
  'received',
  'received_partial',
  'cancelled',
])
export const consumableDeliveryMethodSchema = z.enum(['nova_poshta', 'other'])
export const consumableMovementTypeSchema = z.enum([
  'initial',
  'manual_receipt',
  'request_receipt',
  'consumption',
  'adjustment',
])

const positiveQuantity = z.coerce.number().positive('Количество должно быть больше нуля')
const nonNegativeQuantity = z.coerce.number().min(0, 'Количество не может быть отрицательным')

export const consumableCategoryInputSchema = z.object({
  factoryId: z.string().uuid(),
  name: z.string().trim().min(2, 'Введите название категории'),
  description: z.string().trim().optional().nullable(),
})

export const consumableItemInputSchema = z.object({
  factoryId: z.string().uuid(),
  categoryId: z.string().uuid(),
  name: z.string().trim().min(2, 'Введите название'),
  characteristics: z.string().trim().min(2, 'Введите характеристику'),
  article: z.string().trim().min(1, 'Введите артикул'),
  unit: z.string().trim().min(1, 'Введите единицу учета'),
  minimumQuantity: nonNegativeQuantity,
  initialQuantity: nonNegativeQuantity.default(0),
})

export const consumableDraftInputSchema = z.object({
  consumableId: z.string().uuid(),
  quantity: positiveQuantity,
  priority: consumablePrioritySchema.default('standard'),
  notes: z.string().trim().optional().nullable(),
})

export const consumableStockOperationSchema = z.object({
  consumableId: z.string().uuid(),
  operation: z.enum(['manual_receipt', 'consumption', 'adjustment']),
  quantity: nonNegativeQuantity.default(0),
  newBalance: nonNegativeQuantity.optional().nullable(),
  comment: z.string().trim().optional().nullable(),
})

export const consumableDeliveryInputSchema = z.object({
  requestId: z.string().uuid(),
  method: consumableDeliveryMethodSchema,
  ttn: z.string().trim().optional().nullable(),
  carrierName: z.string().trim().optional().nullable(),
  carrierEta: z.string().optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.method === 'nova_poshta' && !/^\d{14}$/.test(data.ttn || '')) {
    ctx.addIssue({ code: 'custom', path: ['ttn'], message: 'ТТН должен содержать 14 цифр' })
  }
  if (data.method === 'other') {
    if (!data.carrierName) {
      ctx.addIssue({ code: 'custom', path: ['carrierName'], message: 'Укажите перевозчика' })
    }
    if (!data.carrierEta) {
      ctx.addIssue({ code: 'custom', path: ['carrierEta'], message: 'Укажите ожидаемую дату' })
    }
  }
})

export type ConsumablePriority = z.infer<typeof consumablePrioritySchema>
export type ConsumableRequestStatus = z.infer<typeof consumableStatusSchema>
export type ConsumableDeliveryMethod = z.infer<typeof consumableDeliveryMethodSchema>
export type ConsumableMovementType = z.infer<typeof consumableMovementTypeSchema>
export type ConsumableCategoryInput = z.infer<typeof consumableCategoryInputSchema>
export type ConsumableItemInput = z.infer<typeof consumableItemInputSchema>
export type ConsumableDraftInput = z.infer<typeof consumableDraftInputSchema>
export type ConsumableStockOperationInput = z.infer<typeof consumableStockOperationSchema>
export type ConsumableDeliveryInput = z.infer<typeof consumableDeliveryInputSchema>

export type ConsumableCategory = {
  id: string
  factory_id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ConsumableStockRow = {
  consumable_id: string
  factory_id: string
  category_id: string
  category_name: string
  name: string
  characteristics: string
  article: string
  unit: string
  minimum_quantity: number
  is_active: boolean
  current_quantity: number
  in_work_quantity: number
  is_below_minimum: boolean
  shortage_quantity: number
  updated_at: string | null
}

export type ConsumableMovement = {
  id: string
  consumable_id: string
  factory_id: string
  movement_type: ConsumableMovementType
  quantity_delta: number
  balance_before: number
  balance_after: number
  request_id: string | null
  created_by: string | null
  comment: string | null
  created_at: string
  consumable?: { name: string; unit: string } | null
  author?: { full_name: string | null } | null
}

export type ConsumableRequest = {
  id: string
  factory_id: string
  consumable_id: string
  created_by: string
  priority: ConsumablePriority
  requested_quantity: number
  received_quantity: number
  status: ConsumableRequestStatus
  auto_generated: boolean
  quantity_is_automatic: boolean
  request_date: string | null
  need_by_date: string | null
  submitted_at: string | null
  invoice_taken_at: string | null
  delivery_started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  remainder_closed_reason: string | null
  delivery_method: ConsumableDeliveryMethod | null
  nova_poshta_ttn: string | null
  carrier_name: string | null
  carrier_eta: string | null
  tracking_status: string | null
  tracking_status_code: string | null
  tracking_estimated_delivery_date: string | null
  tracking_last_checked_at: string | null
  tracking_error: string | null
  notes: string | null
  created_at: string
  updated_at: string
  consumable?: {
    id: string
    name: string
    article: string
    characteristics: string
    unit: string
    category?: { name: string } | null
  } | null
  factory?: { id: string; name: string } | null
  creator?: { id: string; full_name: string | null } | null
  receipts?: Array<{
    id: string
    quantity: number
    received_at: string
    receiver?: { full_name: string | null } | null
  }>
  events?: Array<{
    id: string
    event_type: string
    old_status: ConsumableRequestStatus | null
    new_status: ConsumableRequestStatus | null
    details: Record<string, unknown>
    created_at: string
    author?: { full_name: string | null } | null
  }>
}
