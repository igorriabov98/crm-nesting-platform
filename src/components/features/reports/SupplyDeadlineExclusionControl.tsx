'use client'

import { type FormEvent, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { setSupplyDeadlineExclusion } from '@/lib/actions/supply-deadline-report'
import type { SupplyDeadlineRow } from '@/lib/reports/supply-deadline-projection'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

export function SupplyDeadlineExclusionControl({ row }: { row: SupplyDeadlineRow }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [targetKind, setTargetKind] = useState<'item' | 'schedule'>(row.exclusion?.target_kind || (row.scheduleId ? 'schedule' : 'item'))
  const [reason, setReason] = useState(row.exclusion?.reason || '')
  const active = Boolean(row.exclusion)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const result = await setSupplyDeadlineExclusion({
        targetKind: active ? row.exclusion!.target_kind : targetKind,
        requestItemTable: row.source.table,
        requestItemId: row.source.itemId,
        scheduleId: active ? row.exclusion!.schedule_id : targetKind === 'schedule' ? row.scheduleId : null,
        active: !active,
        reason,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(active ? 'Исключение отменено' : 'Исключение сохранено')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" className="min-h-10" />}>
        {active ? 'Отменить исключение' : 'Не учитывать в просрочке'}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{active ? 'Вернуть в отчёт просрочки' : 'Исключить из просрочки'}</DialogTitle>
          <DialogDescription>
            Недовоз останется видимым. Решение и причина сохраняются в истории.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {!active && row.scheduleId && (
            <label className="grid gap-1.5 text-sm font-medium">
              Что исключить
              <select value={targetKind} onChange={(event) => setTargetKind(event.target.value === 'schedule' ? 'schedule' : 'item')}
                className="min-h-11 rounded-md border border-input bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="schedule">Только эту поставку</option>
                <option value="item">Всю позицию заявки</option>
              </select>
            </label>
          )}
          <label className="grid gap-1.5 text-sm font-medium">
            Причина решения
            <textarea value={reason} onChange={(event) => setReason(event.target.value)}
              minLength={3} maxLength={2000} required rows={4}
              className="w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Укажите причину для проверки отчёта" />
            <span className="text-xs font-normal text-muted-foreground">От 3 до 2000 символов.</span>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button type="submit" disabled={pending || reason.trim().length < 3}>
              {pending ? 'Сохраняем…' : active ? 'Вернуть в отчёт' : 'Сохранить исключение'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
