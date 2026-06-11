'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { Progress } from '@/components/ui/progress'
import { UploadZone } from '@/components/features/nesting/UploadZone'

const STEP_MAX_BYTES = 500 * 1024 * 1024
const PDF_MAX_BYTES = 50 * 1024 * 1024

function hasAllowedExtension(file: File, extensions: string[]) {
  const name = file.name.toLowerCase()
  return extensions.some((extension) => name.endsWith(extension))
}

function validateFile(file: File, extensions: string[], maxBytes: number, label: string) {
  if (!hasAllowedExtension(file, extensions)) {
    return `${label}: недопустимый формат файла`
  }
  if (file.size > maxBytes) {
    return `${label}: файл слишком большой`
  }
  return null
}

function formatMegabytes(bytes: number) {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} МБ`
}

export function NestingUploadForm() {
  const router = useRouter()
  const [stepFile, setStepFile] = useState<File | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [orderNumber, setOrderNumber] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [loadedBytes, setLoadedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState(0)

  function setValidatedStep(file: File | null) {
    setStepError(null)
    if (file) {
      const error = validateFile(file, ['.step', '.stp'], STEP_MAX_BYTES, 'STEP')
      if (error) {
        setStepFile(null)
        setStepError(error)
        return
      }
    }
    setStepFile(file)
  }

  function setValidatedPdf(file: File | null) {
    setPdfError(null)
    if (file) {
      const error = validateFile(file, ['.pdf'], PDF_MAX_BYTES, 'PDF')
      if (error) {
        setPdfFile(null)
        setPdfError(error)
        return
      }
    }
    setPdfFile(file)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!stepFile || !orderNumber.trim()) return

    const formData = new FormData()
    formData.append('stepFile', stepFile)
    if (pdfFile) formData.append('pdfFile', pdfFile)
    formData.append('orderNumber', orderNumber.trim())
    formData.append('quantity', String(Math.max(1, quantity)))

    setIsUploading(true)
    setProgress(0)
    setLoadedBytes(0)
    setTotalBytes(stepFile.size + (pdfFile?.size ?? 0))

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/nesting/upload')

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      setLoadedBytes(event.loaded)
      setTotalBytes(event.total)
      setProgress(Math.round((event.loaded / event.total) * 100))
    }

    xhr.onload = () => {
      setIsUploading(false)
      const data = JSON.parse(xhr.responseText || '{}') as { data?: { id?: string }; error?: string; message?: string }
      if (xhr.status >= 200 && xhr.status < 300 && data.data?.id) {
        toast.success('Файл загружен, парсинг запущен')
        router.push(`/nesting/${data.data.id}/parts`)
        return
      }
      toast.error(data.error || data.message || 'Не удалось загрузить файлы')
    }

    xhr.onerror = () => {
      setIsUploading(false)
      toast.error('Не удалось соединиться с CRM proxy')
    }

    xhr.send(formData)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/nesting">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" />
          Назад к проектам
        </Button>
      </Link>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-[#E8ECF0] bg-white p-6">
        <UploadZone
          title="Перетащите STEP-файл сюда"
          description=".step или .stp до 500 МБ"
          accept=".step,.stp"
          file={stepFile}
          error={stepError}
          disabled={isUploading}
          onFile={setValidatedStep}
        />

        <UploadZone
          title="PDF-чертёж"
          description="Опционально, .pdf до 50 МБ"
          accept=".pdf"
          file={pdfFile}
          error={pdfError}
          disabled={isUploading}
          onFile={setValidatedPdf}
        />

        <div className="grid gap-4 md:grid-cols-[1fr_180px]">
          <div className="space-y-2">
            <Label htmlFor="orderNumber">Номер заказа</Label>
            <Input
              id="orderNumber"
              value={orderNumber}
              onChange={(event) => setOrderNumber(event.target.value)}
              placeholder="Например, ЗК-1547"
              disabled={isUploading}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quantity">Количество изделий</Label>
            <Input
              id="quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value || 1))}
              disabled={isUploading}
            />
          </div>
        </div>

        {isUploading && (
          <div className="space-y-2">
            <Progress value={progress} />
            <p className="text-sm text-[#6B7280]">
              {progress}% • {formatMegabytes(loadedBytes)} / {formatMegabytes(totalBytes)}
            </p>
          </div>
        )}

        <LoadingButton
          type="submit"
          loading={isUploading}
          loadingText="Загрузка..."
          disabled={!stepFile || !orderNumber.trim() || Boolean(stepError || pdfError)}
          className="w-full"
        >
          Загрузить и начать парсинг
        </LoadingButton>
      </form>
    </div>
  )
}
