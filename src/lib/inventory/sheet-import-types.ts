export const SHEET_IMPORT_MAX_BYTES = 3 * 1024 * 1024
export const SHEET_IMPORT_MAX_ROWS = 2_000
export const SHEET_IMPORT_HEADERS = [
  'Вид листа', 'Марка стали', 'Толщина, мм', 'Ширина, мм', 'Длина, мм',
  'Количество к приходу, шт.',
] as const

export type SheetImportRow = {
  row: number
  material: string
  grade: string
  thickness: number
  width: number
  length: number
  quantity: number
}
export type SheetImportIssue = { row: number; message: string }
export type SheetImportResolvedRow = SheetImportRow & {
  materialId: string | null
  steelTypeId: string | null
  variantId: string | null
  density: number | null
  weightKg: number | null
}
export type SheetImportPrevious = {
  id: string; createdAt: string; fileName: string; author: string; quantity: number
}
export type SheetImportPreview = {
  rows: SheetImportResolvedRow[]
  errors: SheetImportIssue[]
  skippedRows: number[]
  quantity: number
  weightKg: number | null
  pendingDensityGrades: string[]
  fingerprint: string
  previewHash: string
  previous: SheetImportPrevious | null
  newMaterials: number
  newGrades: number
  newVariants: number
}
export type SheetImportResult = {
  batchId: string; receiptCount: number; quantity: number; weightKg: number | null; replayed: boolean
}
export type SheetImportCatalog = {
  grades: Array<{ name: string; density: number | null }>
}
