export type ProductUploadFileKind = 'drawing' | 'step' | 'pdf' | 'photo' | 'other'

export type DirectProductUpload = {
  objectPath: string
  fileKind: ProductUploadFileKind
  fileName: string
  mimeType: string | null
  fileSize: number
}

export const PRODUCT_FILE_MAX_BYTES = 50 * 1024 * 1024

const FILE_KIND_EXTENSIONS: Record<ProductUploadFileKind, string[] | null> = {
  drawing: ['.pdf', '.dxf', '.dwg'],
  step: ['.step', '.stp'],
  pdf: ['.pdf'],
  photo: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif'],
  other: null,
}

const VERSION_FILE_KINDS = new Set<ProductUploadFileKind>(['drawing', 'step'])

function normalizedName(value: string) {
  return value.trim().toLowerCase()
}

export function fileExtension(fileName: string) {
  const match = normalizedName(fileName).match(/\.[a-z0-9]{1,12}$/)
  return match?.[0] || ''
}

export function validateProductUploadRequest(input: {
  fileKind: ProductUploadFileKind
  fileName: string
  fileSize: number
}) {
  const fileName = input.fileName.trim()
  if (!fileName || fileName.length > 240) throw new Error('Некорректное имя файла')
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) throw new Error('Файл пустой')
  if (input.fileSize > PRODUCT_FILE_MAX_BYTES) throw new Error('Файл превышает лимит 50 МБ')

  const allowedExtensions = FILE_KIND_EXTENSIONS[input.fileKind]
  const extension = fileExtension(fileName)
  if (allowedExtensions && !allowedExtensions.includes(extension)) {
    throw new Error(`Допустимые форматы: ${allowedExtensions.join(', ')}`)
  }
  if (!extension) throw new Error('У файла должно быть расширение')

  return { fileName, extension }
}

export function productUploadPrefix(productId: string) {
  return `products/${productId}/uploads/`
}

export function validateDirectProductUploads(
  productId: string,
  uploads: DirectProductUpload[],
  options: { versionFilesOnly?: boolean } = {},
) {
  if (!Array.isArray(uploads) || uploads.length === 0) {
    throw new Error('Добавьте PDF или STEP файл')
  }
  if (uploads.length > 2 && options.versionFilesOnly) {
    throw new Error('За один раз можно добавить только PDF и STEP')
  }

  const prefix = productUploadPrefix(productId)
  const seenKinds = new Set<ProductUploadFileKind>()

  return uploads.map((upload) => {
    if (options.versionFilesOnly && !VERSION_FILE_KINDS.has(upload.fileKind)) {
      throw new Error('В версию можно добавить только PDF или STEP')
    }
    if (options.versionFilesOnly && upload.fileKind === 'drawing' && fileExtension(upload.fileName) !== '.pdf') {
      throw new Error('Чертёж версии должен быть в формате PDF')
    }
    if (seenKinds.has(upload.fileKind)) throw new Error('Нельзя загрузить два файла одного типа')
    seenKinds.add(upload.fileKind)

    validateProductUploadRequest(upload)
    if (!upload.objectPath.startsWith(prefix) || upload.objectPath.includes('..')) {
      throw new Error('Некорректный путь загруженного файла')
    }
    if (fileExtension(upload.objectPath) !== fileExtension(upload.fileName)) {
      throw new Error('Расширение загруженного файла не совпадает с именем')
    }

    return {
      ...upload,
      fileName: upload.fileName.trim(),
      mimeType: upload.mimeType?.trim() || null,
    }
  })
}

export function versionDocumentState(files: Array<{ file_kind: string }>) {
  const hasDrawing = files.some((file) => file.file_kind === 'drawing' || file.file_kind === 'pdf')
  const hasStep = files.some((file) => file.file_kind === 'step')
  return {
    hasDrawing,
    hasStep,
    complete: hasDrawing && hasStep,
  }
}
