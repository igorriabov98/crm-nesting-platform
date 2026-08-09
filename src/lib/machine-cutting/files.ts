export const MACHINE_CUTTING_BUCKET = 'nesting-files'
export const MACHINE_CUTTING_MAX_BYTES = 500 * 1024 * 1024

const MACHINE_CUTTING_EXTENSIONS = new Set(['.zip', '.rar', '.7z'])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const GENERATED_OBJECT_NAME = /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:zip|rar|7z)$/iu

export type DirectMachineCuttingUpload = {
  requestId: string
  completionId: string | null
  objectPath: string
  fileName: string
  mimeType: string | null
  fileSize: number
}

export function machineCuttingFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

export function validateMachineCuttingUploadRequest(input: { fileName: string; fileSize: number }) {
  const fileName = input.fileName.trim()
  if (!fileName || fileName.length > 240 || CONTROL_CHARACTERS.test(fileName) || /[/\\]/u.test(fileName)) {
    throw new Error('Некорректное имя архива')
  }
  if (!Number.isInteger(input.fileSize) || input.fileSize <= 0) {
    throw new Error('Архив не должен быть пустым')
  }
  if (input.fileSize > MACHINE_CUTTING_MAX_BYTES) {
    throw new Error('Размер архива не должен превышать 500 МБ')
  }

  const extension = machineCuttingFileExtension(fileName)
  if (!MACHINE_CUTTING_EXTENSIONS.has(extension)) {
    throw new Error('Допустимы только архивы ZIP, RAR и 7Z')
  }
  return { fileName, extension }
}

export function machineCuttingUploadPrefix(machineId: string, requestId: string) {
  return `machine-cutting/${machineId}/${requestId}/`
}

export function validateMachineCuttingRegistration(input: DirectMachineCuttingUpload & { machineId: string }) {
  const validated = validateMachineCuttingUploadRequest({
    fileName: input.fileName,
    fileSize: input.fileSize,
  })
  const prefix = machineCuttingUploadPrefix(input.machineId, input.requestId)
  if (!input.objectPath.startsWith(prefix) || input.objectPath.includes('..')) {
    throw new Error('Путь архива не принадлежит этой машине')
  }

  const objectName = input.objectPath.slice(prefix.length)
  if (!GENERATED_OBJECT_NAME.test(objectName) || machineCuttingFileExtension(objectName) !== validated.extension) {
    throw new Error('Некорректный путь архива')
  }
  return { ...validated, prefix, objectName }
}
