'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import type { ProductOption } from '@/lib/actions/products'
import { getProductVersions, type ProductVersionWithFiles } from '@/lib/actions/product-versions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type ProductVersionSelectorProps = {
  product: ProductOption
  value?: string | null
  disabled?: boolean
  onChange: (versionId: string, version?: ProductVersionWithFiles) => void
}

const versionDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

function formatVersionDate(value: string | null) {
  if (!value) return '—'
  return versionDateFormatter.format(new Date(value))
}

function shortSummary(value: string | null) {
  if (!value) return '—'
  const trimmed = value.trim()
  if (trimmed.length <= 72) return trimmed
  return `${trimmed.slice(0, 69)}...`
}

function versionLabel(versionNumber: number | null | undefined, isCurrent: boolean) {
  const numberLabel = versionNumber ? `v${versionNumber}` : 'версия'
  return isCurrent ? `Текущая версия (${numberLabel})` : numberLabel
}

export function ProductVersionSelector({
  product,
  value,
  disabled,
  onChange,
}: ProductVersionSelectorProps) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<ProductVersionWithFiles[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const productIdRef = useRef(product.id)
  const selectedVersionId = value || product.current_product_version_id || null
  const currentVersionId = product.current_product_version_id || null

  useEffect(() => {
    productIdRef.current = product.id
    setOpen(false)
    setVersions(null)
    setIsLoading(false)
    setError(null)
  }, [product.id])

  const selectedVersion = useMemo(
    () => versions?.find((version) => version.id === selectedVersionId) || null,
    [selectedVersionId, versions],
  )
  const selectedVersionNumber = selectedVersion?.version_number || product.current_product_version_number || null
  const isArchivedSelected = Boolean(selectedVersion && selectedVersion.status !== 'current')

  async function loadVersions() {
    if (versions || isLoading) return
    const requestedProductId = product.id
    setIsLoading(true)
    setError(null)
    const result = await getProductVersions(requestedProductId)
    if (productIdRef.current !== requestedProductId) return
    setIsLoading(false)
    if (result.error || !result.data) {
      const message = result.error || 'Не удалось загрузить версии товара'
      setError(message)
      toast.error(message)
      return
    }
    setVersions(result.data)
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) void loadVersions()
  }

  function handleSelect(version: ProductVersionWithFiles) {
    onChange(version.id, version)
    setOpen(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              className="h-8 border-[#E8ECF0] bg-white px-2 text-xs font-normal text-[#374151]"
            >
              {versionLabel(selectedVersionNumber, selectedVersionId === currentVersionId)}
              <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
            </Button>
          }
        />
        <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
          <div className="max-h-72 overflow-y-auto py-1">
            {isLoading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-[#6B7280]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка версий
              </div>
            ) : error ? (
              <div className="px-3 py-3 text-sm text-[#DC2626]">{error}</div>
            ) : (versions || []).length === 0 ? (
              <div className="px-3 py-3 text-sm text-[#6B7280]">Версии не найдены</div>
            ) : (
              versions?.map((version) => {
                const isCurrent = version.status === 'current'
                const selected = version.id === selectedVersionId
                return (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => handleSelect(version)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[#F8F9FA]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[#1B3A6B]">
                        {versionLabel(version.version_number, isCurrent)}
                      </div>
                      <div className="mt-0.5 text-xs text-[#6B7280]">
                        {formatVersionDate(version.created_at)} · {shortSummary(version.change_summary)}
                      </div>
                    </div>
                    <Check className={cn('mt-0.5 h-4 w-4 shrink-0 text-[#2563EB]', selected ? 'opacity-100' : 'opacity-0')} />
                  </button>
                )
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
      {isArchivedSelected && (
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
          устаревшая версия
        </Badge>
      )}
    </div>
  )
}
