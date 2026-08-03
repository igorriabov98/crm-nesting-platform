import { fileExtension } from '@/lib/products/product-file-upload'

export const PRODUCT_PRODUCTION_DRAWING_BUCKET = 'product-production-drawings'
export const PRODUCT_PRODUCTION_DRAWING_MAX_BYTES = 50 * 1024 * 1024
export const PRODUCT_PRODUCTION_DRAWING_MAX_FILES_PER_BATCH = 10

export type DirectProductProductionDrawingUpload = {
  objectPath: string
  fileName: string
  mimeType: string | null
  fileSize: number
}

export function productProductionDrawingUploadPrefix(productId: string, productVersionId: string) {
  return `products/${productId}/versions/${productVersionId}/uploads/`
}

export function validateProductProductionDrawingFile(input: {
  fileName: string
  fileSize: number
  mimeType?: string | null
}) {
  const fileName = input.fileName.trim()
  if (!fileName || fileName.length > 240) throw new Error('Некорректное имя файла')
  if (fileExtension(fileName) !== '.pdf') throw new Error('Комплектный чертёж должен быть в формате PDF')
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) throw new Error('Файл пустой')
  if (input.fileSize > PRODUCT_PRODUCTION_DRAWING_MAX_BYTES) throw new Error('Файл превышает лимит 50 МБ')

  const mimeType = input.mimeType?.trim().toLowerCase() || null
  if (mimeType && mimeType !== 'application/pdf') throw new Error('Комплектный чертёж должен быть в формате PDF')

  return { fileName, mimeType: 'application/pdf' as const }
}

export function validateDirectProductProductionDrawingUploads(
  productId: string,
  productVersionId: string,
  uploads: DirectProductProductionDrawingUpload[],
) {
  if (!Array.isArray(uploads) || uploads.length === 0) throw new Error('Выберите хотя бы один PDF-файл')
  if (uploads.length > PRODUCT_PRODUCTION_DRAWING_MAX_FILES_PER_BATCH) {
    throw new Error('За один раз можно загрузить не больше 10 PDF-файлов')
  }

  const prefix = productProductionDrawingUploadPrefix(productId, productVersionId)
  const objectPaths = new Set<string>()

  return uploads.map((upload) => {
    const normalized = validateProductProductionDrawingFile(upload)
    if (!upload.objectPath.startsWith(prefix) || upload.objectPath.includes('..')) {
      throw new Error('Некорректный путь комплектного чертежа')
    }
    if (fileExtension(upload.objectPath) !== '.pdf') {
      throw new Error('Расширение загруженного файла не совпадает с форматом PDF')
    }
    if (objectPaths.has(upload.objectPath)) throw new Error('Один файл нельзя зарегистрировать дважды')
    objectPaths.add(upload.objectPath)

    return {
      ...upload,
      fileName: normalized.fileName,
      mimeType: normalized.mimeType,
    }
  })
}
