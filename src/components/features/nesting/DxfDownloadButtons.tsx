'use client'

import { useState } from 'react'
import { Archive, Download, FileSearch, Loader2, RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type DownloadType = 'sheet' | 'all' | 'diagnostic'

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-')
}

async function readDownloadError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  } catch {
    // The server may return a non-JSON error page. Use a stable user-facing fallback.
  }

  return `Не удалось скачать файл (ошибка ${response.status})`
}

export function DxfDownloadButtons({
  projectId,
  sheetId,
  orderNumber,
  sheetIndex,
  disabledReason,
}: {
  projectId: string
  sheetId: string
  orderNumber: string
  sheetIndex: number
  disabledReason?: string
}) {
  const router = useRouter()
  const [loadingType, setLoadingType] = useState<DownloadType | null>(null)
  const safeOrderNumber = safeFileName(orderNumber)

  const handleDownload = async (type: DownloadType, url: string, filename: string) => {
    setLoadingType(type)

    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(await readDownloadError(response))

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось скачать файл')
    } finally {
      setLoadingType(null)
    }
  }

  const isDownloading = loadingType !== null

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="outline"
        disabled={isDownloading || Boolean(disabledReason)}
        title={disabledReason ? `DXF заблокирован: ${disabledReason}` : undefined}
        aria-busy={loadingType === 'sheet'}
        onClick={() => handleDownload('sheet', `/api/nesting/dxf/${projectId}/${sheetId}`, `${safeOrderNumber}-sheet-${sheetIndex}.dxf`)}
      >
        {loadingType === 'sheet' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        Скачать DXF (этот лист)
      </Button>
      <Button
        disabled={isDownloading || Boolean(disabledReason)}
        title={disabledReason ? `DXF заблокирован: ${disabledReason}` : undefined}
        aria-busy={loadingType === 'all'}
        onClick={() => handleDownload('all', `/api/nesting/dxf/${projectId}`, `${safeOrderNumber}-dxf.zip`)}
      >
        {loadingType === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
        Скачать все DXF (ZIP)
      </Button>
      <Button
        variant="outline"
        disabled={isDownloading}
        aria-busy={loadingType === 'diagnostic'}
        onClick={() => handleDownload('diagnostic', `/api/nesting/diagnostic-package/${projectId}`, `${safeOrderNumber}-diagnostic.zip`)}
      >
        {loadingType === 'diagnostic' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
        Скачать диагностику
      </Button>
      <Button variant="ghost" onClick={() => router.push(`/nesting/${projectId}/parts`)}>
        <RotateCcw className="h-4 w-4" />
        Пересчитать
      </Button>
    </div>
  )
}
