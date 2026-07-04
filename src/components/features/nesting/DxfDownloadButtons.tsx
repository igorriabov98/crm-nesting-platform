'use client'

import { Archive, Download, FileSearch, RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '-')
}

function handleDownload(url: string, filename: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export function DxfDownloadButtons({
  projectId,
  sheetId,
  orderNumber,
  sheetIndex,
}: {
  projectId: string
  sheetId: string
  orderNumber: string
  sheetIndex: number
}) {
  const router = useRouter()
  const safeOrderNumber = safeFileName(orderNumber)

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="outline"
        onClick={() => handleDownload(`/api/nesting/dxf/${projectId}/${sheetId}`, `${safeOrderNumber}-sheet-${sheetIndex}.dxf`)}
      >
        <Download className="h-4 w-4" />
        Скачать DXF (этот лист)
      </Button>
      <Button onClick={() => handleDownload(`/api/nesting/dxf/${projectId}`, `${safeOrderNumber}-dxf.zip`)}>
        <Archive className="h-4 w-4" />
        Скачать все DXF (ZIP)
      </Button>
      <Button
        variant="outline"
        onClick={() => handleDownload(`/api/nesting/diagnostic-package/${projectId}`, `${safeOrderNumber}-diagnostic.zip`)}
      >
        <FileSearch className="h-4 w-4" />
        Скачать диагностику
      </Button>
      <Button variant="ghost" onClick={() => router.push(`/nesting/${projectId}/parts`)}>
        <RotateCcw className="h-4 w-4" />
        Пересчитать
      </Button>
    </div>
  )
}
