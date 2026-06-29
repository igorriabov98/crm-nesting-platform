'use client'

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { CheckCircle2, CircleAlert, Loader2, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { saveClientProductPrice } from '@/lib/actions/client-product-prices'
import { CLIENT_PRICE_COATING_LABELS, CLIENT_PRICE_COATINGS } from '@/lib/client-prices/constants'
import type { ClientPriceProductRow } from '@/lib/client-prices/types'
import type { CoatingType } from '@/lib/types'
import { cn } from '@/lib/utils'

type DraftMap = Record<string, string>

type ClientProductPricesTableProps = {
  clientId: string | null
  rows: ClientPriceProductRow[]
  canManage: boolean
  title?: string
  description?: string
  searchPlaceholder?: string
  className?: string
}

function priceKey(productId: string, coating: CoatingType) {
  return `${productId}:${coating}`
}

function formatDraftPrice(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return String(value)
}

function buildDrafts(rows: ClientPriceProductRow[]) {
  return rows.reduce<DraftMap>((acc, row) => {
    for (const coating of CLIENT_PRICE_COATINGS) {
      acc[priceKey(row.product.id, coating)] = formatDraftPrice(row.prices[coating]?.price_eur)
    }
    return acc
  }, {})
}

function parseDraft(value: string) {
  if (!value.trim()) return null
  const normalized = value.replace(',', '.')
  const numeric = Number(normalized)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
}

export function ClientProductPricesTable({
  clientId,
  rows,
  canManage,
  title = 'Цены клиента',
  description = 'Цена хранится отдельно для каждого изделия и покрытия.',
  searchPlaceholder = 'Поиск по изделию или чертежу',
  className,
}: ClientProductPricesTableProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [drafts, setDrafts] = useState<DraftMap>(() => buildDrafts(rows))
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())
  const initialDrafts = useMemo(() => buildDrafts(rows), [rows])

  useEffect(() => {
    setDrafts(initialDrafts)
    setSavedKeys(new Set())
  }, [initialDrafts])

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) => {
      const haystack = [
        row.product.name_uk,
        row.product.name_en,
        row.product.drawing_number,
      ].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [query, rows])

  async function saveDraft(productId: string, coating: CoatingType) {
    if (!clientId || !canManage) return

    const key = priceKey(productId, coating)
    const draft = drafts[key] || ''
    const initial = initialDrafts[key] || ''
    if (draft === initial) return

    const priceEur = parseDraft(draft)
    if (priceEur === null) {
      toast.error('Введите корректную цену от 0')
      return
    }

    setSavingKey(key)
    try {
      const result = await saveClientProductPrice({
        clientId,
        productId,
        coating,
        priceEur,
      })
      if (!result.success || !result.price) throw new Error(result.error || 'Не удалось сохранить цену')

      setDrafts((current) => ({
        ...current,
        [key]: formatDraftPrice(Number(result.price?.price_eur || priceEur)),
      }))
      setSavedKeys((current) => new Set(current).add(key))
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить цену')
    } finally {
      setSavingKey(null)
    }
  }

  function onPriceKeyDown(event: KeyboardEvent<HTMLInputElement>, productId: string, coating: CoatingType) {
    void productId
    void coating
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  return (
    <section className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white', className)}>
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 border-slate-200 bg-slate-50 pl-9"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[920px] w-full text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-[36%] px-4 py-3 font-semibold">Изделие</th>
              {CLIENT_PRICE_COATINGS.map((coating) => (
                <th key={coating} className="px-4 py-3 font-semibold">
                  {CLIENT_PRICE_COATING_LABELS[coating]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                  {rows.length === 0 ? 'Активных изделий пока нет.' : 'По этому поиску ничего не найдено.'}
                </td>
              </tr>
            ) : filteredRows.map((row) => (
              <tr key={row.product.id} className="transition-colors hover:bg-slate-50/80">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-slate-950">{row.product.name_uk}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{row.product.drawing_number}</span>
                    <span>{Number(row.product.unit_weight_kg || 0).toLocaleString('ru-RU')} кг</span>
                  </div>
                </td>
                {CLIENT_PRICE_COATINGS.map((coating) => {
                  const key = priceKey(row.product.id, coating)
                  const hasPrice = Boolean(row.prices[coating])
                  const isSaved = savedKeys.has(key)
                  const isSaving = savingKey === key
                  return (
                    <td key={coating} className="px-4 py-3 align-top">
                      <div className="flex min-w-52 flex-col gap-2">
                        <div className="relative">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={drafts[key] ?? ''}
                            disabled={!clientId || !canManage || isSaving}
                            onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                            onBlur={() => void saveDraft(row.product.id, coating)}
                            onKeyDown={(event) => onPriceKeyDown(event, row.product.id, coating)}
                            placeholder="0.00"
                            className="h-9 border-slate-200 bg-white pr-9 font-mono tabular-nums text-slate-950 disabled:bg-slate-50"
                          />
                          {isSaving && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
                        </div>
                        <div className="flex items-center gap-2">
                          {isSaved ? (
                            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" />
                              обновлено
                            </Badge>
                          ) : hasPrice ? (
                            <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                              задана
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-500">
                              <CircleAlert className="h-3 w-3" />
                              нет цены
                            </Badge>
                          )}
                        </div>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
