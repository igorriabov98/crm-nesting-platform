import type { DepartmentRequestAttachmentPhase } from '@/lib/department-requests'

export type DepartmentRequestDirectUpload = {
  objectPath: string
  fileName: string
  mimeType: string | null
  fileSize: number
}

export const DEPARTMENT_REQUEST_FILE_MAX_BYTES = 25 * 1024 * 1024
export const DEPARTMENT_REQUEST_FILE_MAX_COUNT = 10

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.rtf',
  '.png', '.jpg', '.jpeg', '.webp', '.heic',
  '.zip', '.rar', '.7z',
  '.dxf', '.dwg', '.step', '.stp', '.iges', '.igs',
])

export function departmentRequestFileExtension(fileName: string) {
  const match = fileName.trim().toLowerCase().match(/\.[a-z0-9]{1,12}$/)
  return match?.[0] || ''
}

export function validateDepartmentRequestFile(input: {
  fileName: string
  fileSize: number
}) {
  const fileName = input.fileName.trim()
  if (!fileName || fileName.length > 240) throw new Error('Некорректное имя файла')
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) throw new Error('Файл пустой')
  if (input.fileSize > DEPARTMENT_REQUEST_FILE_MAX_BYTES) {
    throw new Error('Размер одного файла не должен превышать 25 МБ')
  }

  const extension = departmentRequestFileExtension(fileName)
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error('Этот формат файла не поддерживается')
  }

  return { fileName, extension }
}

export function departmentRequestUploadPrefix(
  requestId: string,
  userId: string,
  phase: DepartmentRequestAttachmentPhase,
) {
  return `department-requests/${requestId}/${userId}/${phase}/`
}

export function validateDepartmentRequestUploads(
  requestId: string,
  userId: string,
  phase: DepartmentRequestAttachmentPhase,
  uploads: DepartmentRequestDirectUpload[],
) {
  if (uploads.length > DEPARTMENT_REQUEST_FILE_MAX_COUNT) {
    throw new Error('Можно прикрепить не больше 10 файлов')
  }

  const prefix = departmentRequestUploadPrefix(requestId, userId, phase)
  return uploads.map((upload) => {
    const { fileName } = validateDepartmentRequestFile({
      fileName: upload.fileName,
      fileSize: upload.fileSize,
    })
    if (!upload.objectPath.startsWith(prefix) || upload.objectPath.includes('..')) {
      throw new Error('Некорректный путь загруженного файла')
    }
    if (departmentRequestFileExtension(upload.objectPath) !== departmentRequestFileExtension(fileName)) {
      throw new Error('Расширение загруженного файла не совпадает с именем')
    }
    return {
      ...upload,
      fileName,
      mimeType: upload.mimeType?.trim() || null,
    }
  })
}
