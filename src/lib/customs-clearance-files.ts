import type { CustomsDocumentKind } from '@/lib/customs-clearance'

export type CustomsClearanceDirectUpload = {
  objectPath: string
  fileName: string
  mimeType: string
  fileSize: number
}

export const CUSTOMS_CLEARANCE_FILE_MAX_BYTES = 25 * 1024 * 1024
export const CUSTOMS_CLEARANCE_FILE_MAX_COUNT = 10

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

export function customsClearanceFileExtension(fileName: string) {
  const match = fileName.trim().toLowerCase().match(/\.[a-z0-9]{1,12}$/)
  return match?.[0] || ''
}

export function validateCustomsClearanceFile(input: {
  fileName: string
  fileSize: number
  contentType?: string | null
}) {
  const fileName = input.fileName.trim()
  if (!fileName || fileName.length > 240) throw new Error('Некорректное имя файла')
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) throw new Error('Файл пустой')
  if (input.fileSize > CUSTOMS_CLEARANCE_FILE_MAX_BYTES) {
    throw new Error('Размер одного файла не должен превышать 25 МБ')
  }

  const extension = customsClearanceFileExtension(fileName)
  const mimeType = MIME_BY_EXTENSION[extension]
  const reportedMimeType = input.contentType?.split(';', 1)[0].trim().toLowerCase()
  if (!mimeType) throw new Error('Разрешены PDF, DOC, DOCX, XLS, XLSX, JPG и PNG')
  if (reportedMimeType && reportedMimeType !== 'application/octet-stream' && reportedMimeType !== mimeType) {
    throw new Error('Тип файла не соответствует расширению')
  }
  return { fileName, extension, mimeType }
}

export function customsClearanceUploadPrefix(machineId: string, userId: string) {
  return `customs-clearance/${machineId}/${userId}/`
}

export function validateCustomsClearanceUploads(
  machineId: string,
  userId: string,
  documentKind: CustomsDocumentKind,
  uploads: CustomsClearanceDirectUpload[],
) {
  if (!['invoice', 'specification', 'packing_list', 'other'].includes(documentKind)) {
    throw new Error('Некорректный тип документа')
  }
  if (uploads.length < 1 || uploads.length > CUSTOMS_CLEARANCE_FILE_MAX_COUNT) {
    throw new Error('Можно прикрепить от 1 до 10 файлов')
  }
  const prefix = customsClearanceUploadPrefix(machineId, userId)
  return uploads.map((upload) => {
    const validated = validateCustomsClearanceFile({
      fileName: upload.fileName,
      fileSize: upload.fileSize,
      contentType: upload.mimeType,
    })
    if (!upload.objectPath.startsWith(prefix) || upload.objectPath.includes('..')) {
      throw new Error('Некорректный путь загруженного файла')
    }
    if (customsClearanceFileExtension(upload.objectPath) !== validated.extension) {
      throw new Error('Расширение загруженного файла не совпадает с именем')
    }
    return { ...upload, fileName: validated.fileName, mimeType: validated.mimeType }
  })
}
