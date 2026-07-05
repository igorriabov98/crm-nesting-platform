'use client'

import { useMemo, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Factory, RefreshCw, Settings2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ensureProductionFactStandardSections, type ProductionFactSettingsData } from '@/lib/actions/production-fact'
import { resolveProductionFactStandardStages } from '@/lib/constants/production-fact'
import { cn } from '@/lib/utils'

const selectClassName = 'flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

function stageStatusLabel(missingCount: number) {
  return missingCount === 0 ? 'Готово' : `Не хватает: ${missingCount}`
}

export function ProductionFactSettingsPage({ data }: { data: ProductionFactSettingsData }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const selectedFactory = data.factories.find((factory) => factory.id === data.selectedFactoryId)
  const resolvedStages = useMemo(() => resolveProductionFactStandardStages(data.sections), [data.sections])

  function updateFactory(factoryId: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (factoryId) params.set('factory', factoryId)
    else params.delete('factory')
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  function handleEnsureSections() {
    if (!data.selectedFactoryId) return
    startTransition(async () => {
      const result = await ensureProductionFactStandardSections({ factory_id: data.selectedFactoryId! })
      if (!result.success) {
        toast.error(result.error || 'Не удалось обновить настройки')
        return
      }
      toast.success('Стандартные участки проверены')
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[#1B3A6B]">
            <Settings2 className="size-5" />
            Настройки факта производства
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,320px)_auto] lg:items-end">
            <label className="space-y-1 text-sm font-medium text-[#334155]">
              <span>Завод</span>
              <select
                className={selectClassName}
                value={data.selectedFactoryId || ''}
                onChange={(event) => updateFactory(event.target.value)}
                disabled={data.factories.length <= 1}
              >
                {data.factories.map((factory) => (
                  <option key={factory.id} value={factory.id}>{factory.name}</option>
                ))}
              </select>
            </label>
            <Button type="button" onClick={handleEnsureSections} disabled={!data.selectedFactoryId || isPending} className="w-fit">
              <RefreshCw className={cn('size-4', isPending && 'animate-spin')} />
              Проверить стандартные участки
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#DBEAFE] bg-[#EFF6FF] px-3 py-2 text-sm text-[#1E3A8A]">
            <ShieldCheck className="size-4" />
            Настройка доступна только директорам. Рабочая страница начальника производства использует эти участки без технических полей.
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3 xl:grid-cols-2">
        {resolvedStages.map((stage) => {
          const missing = (stage.parent ? 0 : 1) + stage.sections.filter((section) => !section.section).length
          const isCutting = stage.definition.key === 'cutting'
          return (
            <Card key={stage.definition.key} className="bg-white">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-[#12315F]">
                  <span className="flex items-center gap-2">
                    <Factory className="size-4 text-[#1E40AF]" />
                    {stage.definition.label}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      missing === 0 ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]' : 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]',
                    )}
                  >
                    {stageStatusLabel(missing)}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-[#64748B]">Участок</span>
                    <span className="font-medium text-[#111827]">{stage.parent?.name || stage.definition.label}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {stage.sections.map((section) => (
                    <div key={section.key} className="flex items-center justify-between gap-3 rounded-md border border-[#E2E8F0] px-3 py-2 text-sm">
                      <span className="text-[#64748B]">Подучасток</span>
                      <span className="font-medium text-[#111827]">{section.section?.name || section.label}</span>
                    </div>
                  ))}
                </div>
                {isCutting ? (
                  <div className="flex items-center gap-2 rounded-md border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2 text-sm text-[#047857]">
                    <CheckCircle2 className="size-4" />
                    Заготовка связана с текущей складской логикой через production_stage_type = cutting.
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )
        })}
      </section>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-[#12315F]">Активные строки завода {selectedFactory?.name || ''}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-[#E2E8F0]">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAFC] text-left text-xs uppercase text-[#64748B]">
                <tr>
                  <th className="px-3 py-2">Участок</th>
                  <th className="px-3 py-2">Подучасток</th>
                  <th className="px-3 py-2">Складская привязка</th>
                  <th className="px-3 py-2">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] bg-white">
                {data.sections.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-[#64748B]">Участков пока нет</td>
                  </tr>
                ) : data.sections.map((section) => {
                  const parent = section.parent_id ? data.sections.find((item) => item.id === section.parent_id) : null
                  return (
                    <tr key={section.id}>
                      <td className="px-3 py-2 font-medium text-[#111827]">{parent?.name || section.name}</td>
                      <td className="px-3 py-2 text-[#334155]">{parent ? section.name : '—'}</td>
                      <td className="px-3 py-2">
                        {section.production_stage_type === 'cutting' ? (
                          <Badge variant="outline" className="border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]">Заготовка</Badge>
                        ) : (
                          <span className="text-[#94A3B8]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {section.is_active && !section.archived_at ? (
                          <Badge variant="outline" className="border-[#DBEAFE] text-[#1E40AF]">Активен</Badge>
                        ) : (
                          <Badge variant="outline">Архив</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
