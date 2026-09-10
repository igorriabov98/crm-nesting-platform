import type { Database } from '@/lib/types/database'

export type ProductFasteningType = Database['public']['Enums']['product_fastening_type']
export type ProductCompletionType = Database['public']['Enums']['product_completion_type']
export type ClientFasteningFileType = 'metal_plate' | 'a4_plate'

export type DirectClientFasteningUpload = {
  objectPath: string
  fasteningType: ClientFasteningFileType
  fileName: string
  mimeType: string | null
  fileSize: number
}

export const CLIENT_FASTENING_TYPES = [
  'metal_plate',
  'a4_plate',
  'white_sticker',
  'none_required',
] as const satisfies readonly ProductFasteningType[]
export type ClientFasteningType = (typeof CLIENT_FASTENING_TYPES)[number]

export const CLIENT_FASTENING_FILE_TYPES = [
  'metal_plate',
  'a4_plate',
] as const satisfies readonly ClientFasteningFileType[]

export const CLIENT_FASTENING_FILE_MAX_BYTES = 50 * 1024 * 1024

const CLIENT_FASTENING_TYPE_SET = new Set<ProductFasteningType>(CLIENT_FASTENING_TYPES)
const CLIENT_FASTENING_FILE_TYPE_SET = new Set<ClientFasteningFileType>(CLIENT_FASTENING_FILE_TYPES)

function normalizedName(value: string) {
  return value.trim().toLowerCase()
}

export function clientFasteningFileExtension(fileName: string) {
  const match = normalizedName(fileName).match(/\.[a-z0-9]{1,24}$/u)
  return match?.[0] || ''
}

export function normalizeClientFasteningTypes(value: ProductFasteningType[] | null | undefined): ClientFasteningType[] {
  if (!value) return []
  if (!Array.isArray(value)) throw new Error('Некорректный список креплений')
  const unique = Array.from(new Set(value))
  for (const item of unique) {
    if (!CLIENT_FASTENING_TYPE_SET.has(item)) {
      throw new Error(item === 'wp_plate' ? 'Таблички на WP больше не используются' : 'Некорректный тип крепления')
    }
  }
  return CLIENT_FASTENING_TYPES.filter((item) => unique.includes(item))
}

export function validateClientFasteningFile(input: {
  fasteningType: ClientFasteningFileType
  fileName: string
  fileSize: number
}) {
  if (!CLIENT_FASTENING_FILE_TYPE_SET.has(input.fasteningType)) {
    throw new Error('Файл можно прикрепить только к табличке А4 или металлической табличке')
  }
  const fileName = input.fileName.trim()
  if (!fileName || fileName.length > 240) throw new Error('Некорректное имя файла')
  if (/[\\/\u0000-\u001f\u007f]/u.test(fileName) || fileName === '.' || fileName === '..') {
    throw new Error('Имя файла содержит недопустимые символы')
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) throw new Error('Файл пустой')
  if (input.fileSize > CLIENT_FASTENING_FILE_MAX_BYTES) throw new Error('Файл превышает лимит 50 МБ')
  const extension = clientFasteningFileExtension(fileName)
  if (!extension) throw new Error('У файла должно быть расширение')
  return { fileName, extension }
}

export function clientFasteningUploadPrefix(
  productId: string,
  productVersionId: string,
  clientId: string,
  fasteningType: ClientFasteningFileType,
) {
  return `products/${productId}/versions/${productVersionId}/clients/${clientId}/${fasteningType}/uploads/`
}

export function validateDirectClientFasteningUploads(
  productId: string,
  productVersionId: string,
  clientId: string,
  fasteningTypes: ProductFasteningType[],
  uploads: DirectClientFasteningUpload[],
) {
  if (!Array.isArray(uploads) || uploads.length > CLIENT_FASTENING_FILE_TYPES.length) {
    throw new Error('Можно загрузить не больше двух файлов табличек')
  }
  const selectedTypes = new Set(normalizeClientFasteningTypes(fasteningTypes))
  const seenTypes = new Set<ClientFasteningFileType>()

  return uploads.map((upload) => {
    const { fileName } = validateClientFasteningFile(upload)
    if (!selectedTypes.has(upload.fasteningType)) {
      throw new Error('Нельзя загрузить файл для невыбранного типа таблички')
    }
    if (seenTypes.has(upload.fasteningType)) {
      throw new Error('Для одного типа таблички можно загрузить только один файл')
    }
    seenTypes.add(upload.fasteningType)

    const prefix = clientFasteningUploadPrefix(productId, productVersionId, clientId, upload.fasteningType)
    if (!upload.objectPath.startsWith(prefix) || upload.objectPath.includes('..')) {
      throw new Error('Некорректный путь файла таблички')
    }
    if (clientFasteningFileExtension(upload.objectPath) !== clientFasteningFileExtension(fileName)) {
      throw new Error('Расширение загруженного файла не совпадает с именем')
    }
    return {
      ...upload,
      fileName,
      mimeType: upload.mimeType?.trim() || null,
    }
  })
}

export function missingClientFasteningFiles(
  fasteningTypes: ProductFasteningType[] | null | undefined,
  fileTypes: Iterable<string>,
) {
  const selectedTypes = new Set(normalizeClientFasteningTypes(fasteningTypes))
  const availableFiles = new Set(fileTypes)
  return CLIENT_FASTENING_FILE_TYPES.filter(
    (type) => selectedTypes.has(type) && !availableFiles.has(type),
  )
}

export function isProductClientFasteningComplete(input: {
  completionType: ProductCompletionType | null | undefined
  fasteningTypes: ProductFasteningType[] | null | undefined
  fileTypes: Iterable<string>
}) {
  const fasteningTypes = normalizeClientFasteningTypes(input.fasteningTypes)
  return Boolean(input.completionType)
    && fasteningTypes.length > 0
    && missingClientFasteningFiles(fasteningTypes, input.fileTypes).length === 0
}
