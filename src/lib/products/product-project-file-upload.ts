import type { ProductProjectFile } from '@/lib/types'

export type DirectProductProjectUpload = {
  objectPath: string
  fileKind: ProductProjectFile['file_kind']
  fileName: string
  mimeType: string | null
  fileSize: number
}

export const PRODUCT_PROJECT_FILE_MAX_BYTES = 50 * 1024 * 1024
export const PRODUCT_PROJECT_FILE_MAX_COUNT = 10

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.csv', '.txt', '.rtf',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif',
  '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz',
  '.dxf', '.dwg', '.step', '.stp', '.iges', '.igs',
])

export function productProjectFileExtension(fileName: string) {
  const match = fileName.trim().toLowerCase().match(/\.[a-z0-9]{1,12}$/)
  return match?.[0] || ''
}

export function inferProductProjectFileKind(fileName: string): ProductProjectFile['file_kind'] {
  const extension = productProjectFileExtension(fileName)
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.heif'].includes(extension)) return 'photo'
  if (['.step', '.stp', '.iges', '.igs'].includes(extension)) return 'step'
  if (['.dxf', '.dwg'].includes(extension)) return 'drawing'
  if (extension === '.pdf') return 'pdf'
  return 'other'
}

export function validateProductProjectFile(input: { fileName: string; fileSize: number }) {
  const fileName = input.fileName.trim()
  if (!fileName || fileName.length > 240) throw new Error('Некорректное имя файла')
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) throw new Error('Файл пустой')
  if (input.fileSize > PRODUCT_PROJECT_FILE_MAX_BYTES) {
    throw new Error('Размер одного файла не должен превышать 50 МБ')
  }

  const extension = productProjectFileExtension(fileName)
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error('Этот формат файла не поддерживается')
  return { fileName, extension }
}

export function productProjectUploadPrefix(projectId: string, versionId: string, userId: string) {
  return `product-projects/${projectId}/${versionId}/uploads/${userId}/`
}

export function validateProductProjectUploads(
  projectId: string,
  versionId: string,
  userId: string,
  uploads: DirectProductProjectUpload[],
) {
  if (uploads.length > PRODUCT_PROJECT_FILE_MAX_COUNT) {
    throw new Error('Можно прикрепить не больше 10 файлов')
  }
  const prefix = productProjectUploadPrefix(projectId, versionId, userId)
  return uploads.map((upload) => {
    const { fileName } = validateProductProjectFile({
      fileName: upload.fileName,
      fileSize: upload.fileSize,
    })
    if (!upload.objectPath.startsWith(prefix) || upload.objectPath.includes('..')) {
      throw new Error('Некорректный путь загруженного файла')
    }
    if (productProjectFileExtension(upload.objectPath) !== productProjectFileExtension(fileName)) {
      throw new Error('Расширение загруженного файла не совпадает с именем')
    }
    return {
      ...upload,
      fileKind: inferProductProjectFileKind(fileName),
      fileName,
      mimeType: upload.mimeType?.trim() || null,
    }
  })
}
