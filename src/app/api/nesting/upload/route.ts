import { NextRequest, NextResponse } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { getNestingProxyAccess } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

const STEP_MAX_BYTES = 500 * 1024 * 1024
const PDF_MAX_BYTES = 50 * 1024 * 1024
const MULTIPART_OVERHEAD_BYTES = 5 * 1024 * 1024

function hasAllowedExtension(file: File, extensions: string[]) {
  const name = file.name.toLowerCase()
  return extensions.some((extension) => name.endsWith(extension))
}

function validateFile(file: FormDataEntryValue | null, extensions: string[], maxBytes: number, label: string) {
  if (!(file instanceof File)) return `${label} file is required`
  if (!hasAllowedExtension(file, extensions)) return `${label}: unsupported file extension`
  if (file.size <= 0) return `${label}: empty file`
  if (file.size > maxBytes) return `${label}: file is too large`
  return null
}

function validateUploadFormData(formData: FormData) {
  const stepError = validateFile(formData.get('stepFile'), ['.step', '.stp'], STEP_MAX_BYTES, 'STEP')
  if (stepError) return stepError

  const pdfFile = formData.get('pdfFile')
  if (pdfFile) {
    const pdfError = validateFile(pdfFile, ['.pdf'], PDF_MAX_BYTES, 'PDF')
    if (pdfError) return pdfError
  }

  const orderNumber = String(formData.get('orderNumber') || '').trim()
  if (!orderNumber) return 'Order number is required'
  if (orderNumber.length > 120) return 'Order number is too long'

  const quantity = Number(formData.get('quantity') || 1)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
    return 'Quantity is invalid'
  }

  return null
}

function isAllowedManualStorageUri(value: unknown) {
  if (typeof value !== 'string') return false
  const prefix = 'supabase://nesting-files/uploads/'
  const objectPath = value.slice(prefix.length)
  return value.startsWith(prefix)
    && objectPath.length > 0
    && !objectPath.includes('..')
    && !objectPath.includes('\\')
}

export async function POST(request: NextRequest) {
  try {
    const access = await getNestingProxyAccess('nesting')
    if (access.response) return access.response
    const userId = access.context!.userId

    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = await request.json() as {
        orderNumber?: unknown
        quantity?: unknown
        stepStorageUri?: unknown
        pdfStorageUri?: unknown
      }
      if (!isAllowedManualStorageUri(body.stepStorageUri)
        || (body.pdfStorageUri != null && !isAllowedManualStorageUri(body.pdfStorageUri))) {
        return NextResponse.json({ error: 'Storage reference is not allowed' }, { status: 400 })
      }
      const res = await fetch(`${getNestingServiceUrl()}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, createdBy: userId }),
      })
      const data = await res.json().catch(() => ({ error: 'Unable to create nesting project' }))
      return NextResponse.json(data, { status: res.status })
    }

    const serviceUrl = new URL(getNestingServiceUrl())
    const isLocalService = ['localhost', '127.0.0.1', '::1'].includes(serviceUrl.hostname)
    if (process.env.NODE_ENV === 'production' || !isLocalService) {
      return NextResponse.json({ error: 'Multipart upload is available only for local development' }, { status: 415 })
    }

    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > STEP_MAX_BYTES + PDF_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return NextResponse.json({ error: 'Upload is too large' }, { status: 413 })
    }

    const formData = await request.formData()
    const validationError = validateUploadFormData(formData)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const res = await fetch(`${getNestingServiceUrl()}/api/projects`, {
      method: 'POST',
      body: formData,
    })
    const data = await res.json().catch(() => ({ error: 'Не удалось загрузить файлы' }))

    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось загрузить файлы' },
      { status: 500 }
    )
  }
}
