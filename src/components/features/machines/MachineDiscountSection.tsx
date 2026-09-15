'use client'

import { useMemo, useState } from 'react'
import { BadgePercent, CheckCircle2, Clock3, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { submitMachineDiscountRequest } from '@/lib/actions/machine-discounts'
import { calculateDiscountTotals } from '@/lib/order-discounts'
import type { MachineDetails } from '@/lib/types'

function money(value: number | null | undefined) {
  return `€${Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function MachineDiscountSection({ machine }: { machine: MachineDetails }) {
  const router = useRouter()
  const [percent, setPercent] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const numericPercent = Number(percent)
  const totals = useMemo(() => calculateDiscountTotals(
    Number(machine.items_total_before_discount || 0),
    Number(machine.total_expenses || 0),
    Number.isFinite(numericPercent) ? numericPercent : 0,
  ), [machine.items_total_before_discount, machine.total_expenses, numericPercent])
  const discount = machine.discount
  const hasGoods = (machine.machine_items || []).some((item) => !item.is_sample)
  const disabledReason = machine.is_archived
    ? 'Архивный заказ нельзя отправить на согласование.'
    : !hasGoods
      ? 'Добавьте хотя бы одно изделие.'
      : machine.has_active_invoice
        ? 'Сначала аннулируйте активный инвойс.'
        : !machine.can_manage_order_prices
          ? 'Нет права управлять ценами этого клиента.'
          : null

  const submit = async () => {
    setPending(true)
    try {
      const result = await submitMachineDiscountRequest({ machineId: machine.id, discountPercent: percent, reason })
      if (!result.success) throw new Error(result.error || 'Не удалось отправить запрос')
      toast.success('Запрос отправлен финансовому директору')
      setPercent('')
      setReason('')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отправить запрос')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="machine-discount-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="machine-discount-title" className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <BadgePercent className="h-5 w-5 text-blue-900" />Скидка на заказ
          </h3>
          <p className="mt-1 text-sm text-slate-500">Скидка применяется только к изделиям. Транспорт и прочие расходы не меняются.</p>
        </div>
        {discount?.status === 'pending' && (
          <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 text-sm font-medium text-amber-800">
            <Clock3 className="h-4 w-4" />Ожидает подтверждения
          </div>
        )}
        {discount?.status === 'approved' && (
          <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />Одобрено −{discount.discount_percent}%
          </div>
        )}
      </div>

      {discount ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span className="font-medium text-slate-950">Причина менеджера:</span> {discount.reason}
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <Summary label="Товары" value={money(discount.items_total_before_discount)} />
            <Summary label={`Скидка ${discount.discount_percent}%`} value={`−${money(discount.discount_amount)}`} />
            <Summary label="Товары со скидкой" value={money(discount.discounted_items_total)} />
            <Summary label="Расходы" value={money(machine.total_expenses)} />
            <Summary label="Итого" value={money(machine.total_cost)} strong />
          </div>
          {discount.status === 'pending' && <p className="text-sm text-amber-800">Ценовые документы временно заблокированы до решения.</p>}
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="machine-discount-percent">Скидка, %</Label>
              <Input id="machine-discount-percent" type="number" inputMode="decimal" min="0.01" max="50" step="0.01"
                value={percent} onChange={(event) => setPercent(event.target.value)} placeholder="Например, 5" className="min-h-11" disabled={Boolean(disabledReason) || pending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="machine-discount-reason">Причина скидки</Label>
              <Textarea id="machine-discount-reason" value={reason} onChange={(event) => setReason(event.target.value)}
                placeholder="Объясните финансовому директору, почему нужна скидка" rows={3} disabled={Boolean(disabledReason) || pending} />
            </div>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5" aria-live="polite">
            <Summary label="Товары" value={money(totals.itemsTotalBeforeDiscount)} />
            <Summary label={`Скидка ${numericPercent > 0 ? numericPercent : 0}%`} value={`−${money(totals.discountAmount)}`} />
            <Summary label="Товары со скидкой" value={money(totals.discountedItemsTotal)} />
            <Summary label="Расходы" value={money(totals.expensesTotal)} />
            <Summary label="Итого" value={money(totals.totalCost)} strong />
          </div>
          {disabledReason && <p className="text-sm text-amber-800">{disabledReason}</p>}
          <div className="flex justify-end">
            <Button type="button" onClick={submit}
              disabled={Boolean(disabledReason) || pending || numericPercent < 0.01 || numericPercent > 50 || reason.trim().length < 3}
              className="min-h-11">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}Отправить на согласование
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function Summary({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2"><div className="text-xs text-slate-500">{label}</div><div className={strong ? 'mt-1 font-bold tabular-nums text-emerald-700' : 'mt-1 font-semibold tabular-nums text-slate-900'}>{value}</div></div>
}
