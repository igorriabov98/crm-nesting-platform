'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, Boxes, Factory, History, PackagePlus, Plus, Scale, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DetailingCreateDialog } from '@/components/features/inventory/DetailingCreateDialog'
import { ROUTES } from '@/lib/constants/routes'
import {
  adjustDetailingStock,
  archiveDetailingPart,
  receiveDetailingStock,
  type DetailingPartCard,
  type DetailingWarehouseData,
} from '@/lib/actions/detailing'

const MOVEMENT_LABELS: Record<string, string> = {
  initial_receipt: 'Начальное поступление', receipt: 'Поступление', adjustment: 'Корректировка',
  reserve: 'Бронь', unreserve: 'Снятие брони', transfer_out: 'Перемещение: отправка',
  transfer_in: 'Перемещение: приёмка', write_off: 'Списание', rollback: 'Откат списания',
}

type StockDialog = { mode: 'receipt' | 'adjust'; part: DetailingPartCard; factoryId: string } | null

function kg(value: number) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)} кг`
}

export function DetailingWarehousePage({
  data,
  activeFactoryId,
}: {
  data: DetailingWarehouseData
  activeFactoryId: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [stockDialog, setStockDialog] = useState<StockDialog>(null)
  const [stockQuantity, setStockQuantity] = useState('')
  const [stockComment, setStockComment] = useState('')
  const activeFactory = data.factories.find((factory) => factory.id === activeFactoryId) || null
  const inventoryFactoryQuery = activeFactoryId ? `factory=${encodeURIComponent(activeFactoryId)}&` : ''
  const inventoryMainHref = activeFactoryId
    ? `${ROUTES.INVENTORY}?factory=${encodeURIComponent(activeFactoryId)}`
    : ROUTES.INVENTORY

  const filteredParts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru')
    if (!query) return data.parts
    return data.parts.filter((part) => [part.name, part.drawingNumber, ...part.compatibilities.map((item) => item.productName)].join(' ').toLocaleLowerCase('ru').includes(query))
  }, [data.parts, search])

  const submitStock = () => {
    if (!stockDialog) return
    startTransition(async () => {
      const result = stockDialog.mode === 'receipt'
        ? await receiveDetailingStock({ partId: stockDialog.part.id, factoryId: stockDialog.factoryId, quantity: Number(stockQuantity), comment: stockComment })
        : await adjustDetailingStock({ partId: stockDialog.part.id, factoryId: stockDialog.factoryId, onHandQuantity: Number(stockQuantity), comment: stockComment })
      if (!result.success) {
        toast.error(result.error || 'Не удалось изменить остаток')
        return
      }
      toast.success(stockDialog.mode === 'receipt' ? 'Поступление добавлено' : 'Остаток скорректирован')
      setStockDialog(null); setStockQuantity(''); setStockComment(''); router.refresh()
    })
  }

  const archive = (part: DetailingPartCard) => {
    if (!window.confirm(`Архивировать карточку «${part.name}»? Это возможно только при нулевых остатках и бронях.`)) return
    startTransition(async () => {
      const result = await archiveDetailingPart(part.id)
      if (!result.success) {
        toast.error(result.error || 'Не удалось архивировать карточку')
        return
      }
      toast.success('Карточка архивирована'); router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#E8ECF0] bg-white p-4">
        <div className="mb-4 flex flex-col gap-3 border-b border-[#E8ECF0] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-[#1B3A6B]">
            <Factory className="h-4 w-4" />
            Склад завода{activeFactory ? `: ${activeFactory.name}` : ''}
          </div>
          <div className="inline-flex w-fit rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-1">
            {data.factories.map((factory) => (
              <Link
                key={factory.id}
                href={`${ROUTES.INVENTORY_DETAILING}?factory=${encodeURIComponent(factory.id)}`}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${factory.id === activeFactoryId ? 'bg-white text-[#1B3A6B] shadow-sm' : 'text-[#6B7280] hover:text-[#1B3A6B]'}`}
              >
                {factory.name}
              </Link>
            ))}
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2 border-b border-[#E8ECF0] pb-4">
          <Link href={inventoryMainHref} className="rounded-lg px-3 py-2 text-sm font-medium text-[#6B7280] hover:bg-[#F3F6FA] hover:text-[#1B3A6B]">Склад</Link>
          <Link href={`${ROUTES.INVENTORY}?${inventoryFactoryQuery}mode=future_business_scrap`} className="rounded-lg px-3 py-2 text-sm font-medium text-[#6B7280] hover:bg-[#F3F6FA] hover:text-[#1B3A6B]">Будущий деловой отход</Link>
          <Link href={`${ROUTES.INVENTORY}?${inventoryFactoryQuery}mode=business_scrap`} className="rounded-lg px-3 py-2 text-sm font-medium text-[#6B7280] hover:bg-[#F3F6FA] hover:text-[#1B3A6B]">Деловой отход</Link>
          <span className="rounded-lg bg-[#EAF1FB] px-3 py-2 text-sm font-semibold text-[#1B3A6B]">Деталировка</span>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 flex-1">
            <label htmlFor="detailing-search" className="mb-1 block text-sm font-medium text-[#374151]">Поиск детали</label>
            <Input id="detailing-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, номер чертежа или изделие" />
          </div>
          <Button className="h-10 bg-[#1B3A6B] px-4" onClick={() => setShowCreate(true)} disabled={!activeFactory}><Plus />Добавить деталировку</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[#DCE5F1] bg-[#F7FAFE] p-4"><Boxes className="mb-2 h-5 w-5 text-[#1B3A6B]" /><div className="text-2xl font-semibold text-[#1B3A6B]">{data.parts.length}</div><div className="text-sm text-[#6B7280]">активных карточек</div></div>
        <div className="rounded-xl border border-[#DDEDE5] bg-[#F4FAF6] p-4"><PackagePlus className="mb-2 h-5 w-5 text-[#2F855A]" /><div className="text-2xl font-semibold text-[#236244]">{data.parts.reduce((sum, part) => sum + part.balances.reduce((value, balance) => value + balance.availableQuantity, 0), 0)}</div><div className="text-sm text-[#567062]">доступно, шт.</div></div>
        <div className="rounded-xl border border-[#F2E4C8] bg-[#FFFAF0] p-4"><Scale className="mb-2 h-5 w-5 text-[#A66B13]" /><div className="text-2xl font-semibold text-[#81510C]">{kg(data.parts.reduce((sum, part) => sum + part.balances.reduce((value, balance) => value + balance.availableWeightKg, 0), 0))}</div><div className="text-sm text-[#7A684C]">доступный вес</div></div>
      </div>

      {filteredParts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-white p-10 text-center text-sm text-[#6B7280]">Подходящие карточки не найдены.</div>
      ) : filteredParts.map((part) => (
        <article key={part.id} className="overflow-hidden rounded-xl border border-[#E1E7EF] bg-white shadow-sm">
          <header className="flex flex-col gap-3 border-b border-[#E8ECF0] bg-[#FBFCFE] p-4 md:flex-row md:items-start md:justify-between">
            <div><div className="text-lg font-semibold text-[#1B3A6B]">{part.name}</div><div className="mt-1 font-mono text-sm text-[#4B5563]">Чертёж: {part.drawingNumber}</div></div>
            <div className="flex items-center gap-2"><span className="rounded-full bg-[#EAF1FB] px-3 py-1 text-sm font-medium text-[#1B3A6B]">{kg(part.unitWeightKg)} / шт.</span><Button variant="ghost" size="icon" aria-label={`Архивировать ${part.name}`} onClick={() => archive(part)} disabled={isPending}><Archive /></Button></div>
          </header>
          <div className="grid gap-5 p-4 xl:grid-cols-[1fr_1.4fr]">
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#6B7280]">Подходит к изделиям</h3>
              <div className="space-y-2">
                {part.compatibilities.map((compatibility) => <div key={compatibility.productId} className="rounded-lg border border-[#E8ECF0] p-3"><div className="font-medium text-[#243B5A]">{compatibility.productName}</div><div className="mt-1 text-xs text-[#6B7280]">{compatibility.productDrawingNumber} · {compatibility.allVersions ? 'все версии' : compatibility.versions.map((version) => `версия ${version.versionNumber}`).join(', ')}</div></div>)}
              </div>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#6B7280]">Остатки по заводам</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {data.factories.map((factory) => {
                  const balance = part.balances.find((item) => item.factoryId === factory.id)
                  return <div key={factory.id} className="rounded-lg border border-[#DCE3EC] p-3">
                    <div className="mb-3 flex items-center gap-2 font-semibold text-[#1B3A6B]"><Factory className="h-4 w-4" />{factory.name}</div>
                    <dl className="grid grid-cols-3 gap-2 text-center"><div><dt className="text-xs text-[#6B7280]">Остаток</dt><dd className="mt-1 font-semibold">{balance?.onHandQuantity || 0}</dd><dd className="text-xs text-[#6B7280]">{kg(balance?.onHandWeightKg || 0)}</dd></div><div><dt className="text-xs text-[#6B7280]">Бронь</dt><dd className="mt-1 font-semibold text-[#A66B13]">{balance?.reservedQuantity || 0}</dd><dd className="text-xs text-[#6B7280]">{kg(balance?.reservedWeightKg || 0)}</dd></div><div><dt className="text-xs text-[#6B7280]">Доступно</dt><dd className="mt-1 font-semibold text-[#236244]">{balance?.availableQuantity || 0}</dd><dd className="text-xs text-[#6B7280]">{kg(balance?.availableWeightKg || 0)}</dd></div></dl>
                    <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => { setStockDialog({ mode: 'receipt', part, factoryId: factory.id }); setStockQuantity(''); setStockComment('') }}><PackagePlus />Поступление</Button>{balance && <Button size="sm" variant="outline" onClick={() => { setStockDialog({ mode: 'adjust', part, factoryId: factory.id }); setStockQuantity(String(balance.onHandQuantity)); setStockComment('') }}><Settings2 />Корректировка</Button>}</div>
                  </div>
                })}
              </div>
            </section>
          </div>
          <details className="border-t border-[#E8ECF0] p-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[#1B3A6B]"><History className="h-4 w-4" />История движений ({part.movements.length})</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs uppercase text-[#6B7280]"><tr><th className="py-2">Дата</th><th>Завод</th><th>Операция</th><th>Количество</th><th>Бронь</th><th>После</th><th>Комментарий</th></tr></thead><tbody>{part.movements.map((movement) => <tr key={movement.id} className="border-t border-[#EDF0F4]"><td className="py-2">{new Date(movement.createdAt).toLocaleString('ru-RU')}</td><td>{data.factories.find((factory) => factory.id === movement.factoryId)?.name || '—'}</td><td>{MOVEMENT_LABELS[movement.movementType] || movement.movementType}</td><td>{movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta}</td><td>{movement.reservedDelta > 0 ? '+' : ''}{movement.reservedDelta}</td><td>{movement.onHandAfter} / {movement.reservedAfter}</td><td>{movement.comment || '—'}</td></tr>)}</tbody></table></div></details>
        </article>
      ))}

      <DetailingCreateDialog
        data={data}
        activeFactoryId={activeFactoryId}
        open={showCreate}
        onOpenChange={setShowCreate}
      />

      <Dialog open={Boolean(stockDialog)} onOpenChange={(open) => !open && setStockDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle>{stockDialog?.mode === 'receipt' ? 'Поступление деталировки' : 'Корректировка остатка'}</DialogTitle><DialogDescription>{stockDialog?.part.name} · {stockDialog?.part.drawingNumber} · {data.factories.find((factory) => factory.id === stockDialog?.factoryId)?.name}</DialogDescription></DialogHeader><label className="text-sm font-medium">{stockDialog?.mode === 'receipt' ? 'Принято, шт.' : 'Новый фактический остаток, шт.'}<Input className="mt-1" type="number" min="0" step="1" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} /></label><label className="text-sm font-medium">Комментарий {stockDialog?.mode === 'adjust' ? '(обязательно)' : ''}<Input className="mt-1" value={stockComment} onChange={(event) => setStockComment(event.target.value)} /></label><DialogFooter><Button variant="outline" onClick={() => setStockDialog(null)}>Отмена</Button><Button disabled={isPending} onClick={submitStock}>{isPending ? 'Сохранение…' : 'Сохранить'}</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  )
}
