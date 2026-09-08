'use client'

import { useState } from 'react'
import { FileSpreadsheet, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

export function SupplyDateOrderExportButton({
  dateKey,
  factoryId,
  itemCount,
}: {
  dateKey: string
  factoryId: string | null
  itemCount: number
}) {
  const [isExporting, setIsExporting] = useState(false)
  const hasItems = itemCount > 0

  const download = async () => {
    if (!hasItems || isExporting) return
    setIsExporting(true)
    try {
      const search = new URLSearchParams({ date: dateKey })
      if (factoryId) search.set('factory', factoryId)
      const response = await fetch(`/api/reports/supply/date-order.xlsx?${search}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(await responseError(response))

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = responseFilename(response) || `zakaz-materialov-${dateKey}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
      toast.success('Excel-файл сформирован')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сформировать Excel-файл')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-11 shrink-0 gap-2 px-3 sm:px-4"
      disabled={!hasItems || isExporting}
      aria-label={hasItems
        ? `Скачать заказ: ${itemCount} незаказанных материалов`
        : 'Все материалы на эту дату уже заказаны'}
      title={hasItems
        ? 'Скачать все незаказанные материалы этой даты'
        : 'Все материалы на эту дату уже заказаны'}
      onClick={download}
    >
      {isExporting
        ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        : <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
      <span>{isExporting ? 'Формирование…' : hasItems ? 'Скачать заказ' : 'Всё заказано'}</span>
      {hasItems && !isExporting && (
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary">
          {itemCount}
        </span>
      )}
    </Button>
  )
}

async function responseError(response: Response) {
  try {
    const body = await response.json() as { error?: string }
    return body.error || 'Не удалось сформировать Excel-файл'
  } catch {
    return 'Не удалось сформировать Excel-файл'
  }
}

function responseFilename(response: Response) {
  const contentDisposition = response.headers.get('Content-Disposition')
  return contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1] || null
}
