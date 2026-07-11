import { randomUUID } from 'node:crypto'
import type { Database } from '@/lib/types/database'

type ProductFileInsert = Database['public']['Tables']['product_files']['Insert']
type ProductFileKind = ProductFileInsert['file_kind']

type ProductVersionFileInsertInput = {
  productId: string
  productVersionId: string
  fileKind: ProductFileKind
  fileName: string
  filePath: string
  mimeType: string | null
  fileSize: number | null
  uploadedBy: string
}

export function buildProductVersionFileInsert(input: ProductVersionFileInsertInput): ProductFileInsert {
  return {
    id: randomUUID(),
    product_id: input.productId,
    product_version_id: input.productVersionId,
    file_kind: input.fileKind,
    file_name: input.fileName,
    file_path: input.filePath,
    mime_type: input.mimeType,
    file_size: input.fileSize,
    uploaded_by: input.uploadedBy,
  }
}
