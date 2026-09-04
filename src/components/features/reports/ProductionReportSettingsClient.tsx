'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useState, useTransition } from 'react'
import { CalendarPlus, Gauge, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  deleteFactoryCalendarException,
  deleteProductionSectionCapacity,
  saveFactoryCalendarException,
  saveProductionSectionCapacity,
  type ProductionReportSettingsData,
} from '@/lib/actions/production-reports'
import { ROUTES } from '@/lib/constants/routes'

const selectClass = 'h-9 w-full rounded-md border border-input bg-white px-3 text-sm text-[#12315F] outline-none focus-visible:ring-2 focus-visible:ring-[#1E40AF]/30'
const stageLabels: Record<string, string> = {
  assembly: 'Сборка/Сварка', cleaning: 'Слесарка/Зачистка', painting: 'Малярка', packaging: 'Упаковка',
}

type CalendarDraft = { id: string | null; date: string; isWorking: boolean; reason: string }
type CapacityDraft = { id: string | null; sectionId: string; validFrom: string; validTo: string; tons: string }

export function ProductionReportSettingsClient({ data }: { data: ProductionReportSettingsData }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft>({ id: null, date: '', isWorking: false, reason: '' })
  const [capacityDraft, setCapacityDraft] = useState<CapacityDraft>({ id: null, sectionId: data.sections[0]?.id || '', validFrom: '', validTo: '', tons: '' })
  const factoryId = data.selectedFactoryId

  function refreshWith(message: string) {
    toast.success(message)
    router.refresh()
  }

  function submitCalendar(event: FormEvent) {
    event.preventDefault()
    if (!factoryId) return
    startTransition(async () => {
      const result = await saveFactoryCalendarException({
        id: calendarDraft.id,
        factory_id: factoryId,
        exception_date: calendarDraft.date,
        is_working: calendarDraft.isWorking,
        reason: calendarDraft.reason,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить исключение')
        return
      }
      setCalendarDraft({ id: null, date: '', isWorking: false, reason: '' })
      refreshWith('Исключение календаря сохранено')
    })
  }

  function submitCapacity(event: FormEvent) {
    event.preventDefault()
    if (!factoryId) return
    startTransition(async () => {
      const result = await saveProductionSectionCapacity({
        id: capacityDraft.id,
        factory_id: factoryId,
        section_id: capacityDraft.sectionId,
        valid_from: capacityDraft.validFrom,
        valid_to: capacityDraft.validTo || null,
        tons_per_workday: Number(capacityDraft.tons),
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить мощность')
        return
      }
      setCapacityDraft({ id: null, sectionId: data.sections[0]?.id || '', validFrom: '', validTo: '', tons: '' })
      refreshWith('Период мощности сохранён')
    })
  }

  function removeCalendar(id: string) {
    if (!window.confirm('Удалить исключение календаря?')) return
    startTransition(async () => {
      const result = await deleteFactoryCalendarException(id)
      if (!result.success) {
        toast.error(result.error || 'Не удалось удалить исключение')
        return
      }
      refreshWith('Исключение удалено')
    })
  }

  function removeCapacity(id: string) {
    if (!window.confirm('Удалить период мощности?')) return
    startTransition(async () => {
      const result = await deleteProductionSectionCapacity(id)
      if (!result.success) {
        toast.error(result.error || 'Не удалось удалить период')
        return
      }
      refreshWith('Период мощности удалён')
    })
  }

  return (
    <div className="space-y-5">
      <label className="block max-w-sm space-y-1.5 text-sm font-medium text-[#334155]">
        <span>Завод</span>
        <select
          className={selectClass}
          value={factoryId || ''}
          disabled={pending || data.factories.length <= 1}
          onChange={(event) => router.push(`${ROUTES.REPORTS_PRODUCTION_SETTINGS}?factory=${event.target.value}`)}
        >
          {data.factories.map((factory) => <option key={factory.id} value={factory.id}>{factory.name}</option>)}
        </select>
      </label>

      <section className="grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
        <form onSubmit={submitCalendar} className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold text-[#12315F]"><CalendarPlus className="size-4 text-[#1E40AF]" />{calendarDraft.id ? 'Изменить исключение' : 'Исключение календаря'}</h2>
            {calendarDraft.id ? <Button type="button" variant="ghost" size="icon-sm" onClick={() => setCalendarDraft({ id: null, date: '', isWorking: false, reason: '' })}><X /><span className="sr-only">Отменить редактирование</span></Button> : null}
          </div>
          <p className="mt-1 text-xs text-[#64748B]">По умолчанию рабочие дни — понедельник–пятница.</p>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm text-[#334155]">Дата<Input type="date" required value={calendarDraft.date} onChange={(event) => setCalendarDraft((current) => ({ ...current, date: event.target.value }))} /></label>
            <label className="grid gap-1 text-sm text-[#334155]">Статус<select className={selectClass} value={calendarDraft.isWorking ? 'working' : 'off'} onChange={(event) => setCalendarDraft((current) => ({ ...current, isWorking: event.target.value === 'working' }))}><option value="off">Нерабочий день</option><option value="working">Рабочий день</option></select></label>
            <label className="grid gap-1 text-sm text-[#334155]">Причина<Input required value={calendarDraft.reason} onChange={(event) => setCalendarDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Например: перенос рабочего дня" /></label>
            <Button type="submit" disabled={pending || !factoryId} className="mt-1 bg-[#12315F] text-white hover:bg-[#1B3A6B]">{pending ? <Loader2 className="animate-spin" /> : <Plus />}{calendarDraft.id ? 'Сохранить' : 'Добавить'}</Button>
          </div>
        </form>

        <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 font-semibold text-[#12315F]">Настроенные исключения</div>
          {data.calendar.length === 0 ? <div className="px-4 py-10 text-center text-sm text-[#64748B]">Исключений пока нет.</div> : (
            <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="border-b border-[#E2E8F0] text-left text-xs uppercase text-[#64748B]"><tr><th className="px-4 py-2">Дата</th><th className="px-4 py-2">Статус</th><th className="px-4 py-2">Причина</th><th className="px-4 py-2 text-right">Действия</th></tr></thead><tbody className="divide-y divide-[#E2E8F0]">{data.calendar.map((row) => <tr key={row.id}><td className="px-4 py-3 font-medium text-[#12315F]">{row.work_date.split('-').reverse().join('.')}</td><td className="px-4 py-3">{row.is_working ? 'Рабочий' : 'Нерабочий'}</td><td className="px-4 py-3 text-[#64748B]">{row.reason}</td><td className="px-4 py-3"><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="icon-sm" disabled={pending} onClick={() => setCalendarDraft({ id: row.id, date: row.work_date, isWorking: row.is_working, reason: row.reason })}><Pencil /><span className="sr-only">Изменить</span></Button><Button type="button" variant="ghost" size="icon-sm" disabled={pending} onClick={() => removeCalendar(row.id)}><Trash2 /><span className="sr-only">Удалить</span></Button></div></td></tr>)}</tbody></table></div>
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
        <form onSubmit={submitCapacity} className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold text-[#12315F]"><Gauge className="size-4 text-[#1E40AF]" />{capacityDraft.id ? 'Изменить мощность' : 'Мощность участка'}</h2>
            {capacityDraft.id ? <Button type="button" variant="ghost" size="icon-sm" onClick={() => setCapacityDraft({ id: null, sectionId: data.sections[0]?.id || '', validFrom: '', validTo: '', tons: '' })}><X /><span className="sr-only">Отменить редактирование</span></Button> : null}
          </div>
          <p className="mt-1 text-xs text-[#64748B]">Периоды одного участка не могут пересекаться.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-[#334155] sm:col-span-2">Участок<select className={selectClass} required value={capacityDraft.sectionId} onChange={(event) => setCapacityDraft((current) => ({ ...current, sectionId: event.target.value }))}>{data.sections.map((section) => <option key={section.id} value={section.id}>{stageLabels[section.stage] || section.stage} · {section.name}</option>)}</select></label>
            <label className="grid gap-1 text-sm text-[#334155]">Начало<Input type="date" required value={capacityDraft.validFrom} onChange={(event) => setCapacityDraft((current) => ({ ...current, validFrom: event.target.value }))} /></label>
            <label className="grid gap-1 text-sm text-[#334155]">Окончание<Input type="date" value={capacityDraft.validTo} onChange={(event) => setCapacityDraft((current) => ({ ...current, validTo: event.target.value }))} /></label>
            <label className="grid gap-1 text-sm text-[#334155] sm:col-span-2">Тонн на рабочий день<Input type="number" min="0.001" step="0.001" required value={capacityDraft.tons} onChange={(event) => setCapacityDraft((current) => ({ ...current, tons: event.target.value }))} /></label>
            <Button type="submit" disabled={pending || !factoryId || data.sections.length === 0} className="mt-1 bg-[#12315F] text-white hover:bg-[#1B3A6B] sm:col-span-2">{pending ? <Loader2 className="animate-spin" /> : <Plus />}{capacityDraft.id ? 'Сохранить' : 'Добавить'}</Button>
          </div>
        </form>

        <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
          <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 font-semibold text-[#12315F]">Периоды мощности</div>
          {data.capacities.length === 0 ? <div className="px-4 py-10 text-center text-sm text-[#64748B]">Мощность пока не настроена. Отчёт покажет план и факт без статуса перегрузки.</div> : (
            <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="border-b border-[#E2E8F0] text-left text-xs uppercase text-[#64748B]"><tr><th className="px-4 py-2">Участок</th><th className="px-4 py-2">Период</th><th className="px-4 py-2 text-right">т/день</th><th className="px-4 py-2 text-right">Действия</th></tr></thead><tbody className="divide-y divide-[#E2E8F0]">{data.capacities.map((row) => <tr key={row.id}><td className="px-4 py-3 font-medium text-[#12315F]">{row.sectionName}</td><td className="px-4 py-3 text-[#64748B]">{row.valid_from.split('-').reverse().join('.')} — {row.valid_to ? row.valid_to.split('-').reverse().join('.') : 'без окончания'}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{Number(row.tons_per_workday).toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td><td className="px-4 py-3"><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="icon-sm" disabled={pending} onClick={() => setCapacityDraft({ id: row.id, sectionId: row.section_id, validFrom: row.valid_from, validTo: row.valid_to || '', tons: String(row.tons_per_workday) })}><Pencil /><span className="sr-only">Изменить</span></Button><Button type="button" variant="ghost" size="icon-sm" disabled={pending} onClick={() => removeCapacity(row.id)}><Trash2 /><span className="sr-only">Удалить</span></Button></div></td></tr>)}</tbody></table></div>
          )}
        </div>
      </section>
    </div>
  )
}
