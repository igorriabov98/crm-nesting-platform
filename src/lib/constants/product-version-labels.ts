import type { Database } from '@/lib/types/database'

export type ProductFasteningType = Database['public']['Enums']['product_fastening_type']
export type ProductCompletionType = Database['public']['Enums']['product_completion_type']

export const PRODUCT_FASTENING_TYPE_LABELS: Record<ProductFasteningType, string> = {
  metal_plate: 'Металлические таблички',
  wp_plate: 'Таблички на WP',
  a4_plate: 'Табличка А4',
  white_sticker: 'Белые наклейки',
  none_required: 'Крепление не требуется',
}

export const PRODUCT_COMPLETION_TYPE_LABELS: Record<ProductCompletionType, string> = {
  mounting_set: 'Mounting set',
  chain_set: 'Chain set',
}
