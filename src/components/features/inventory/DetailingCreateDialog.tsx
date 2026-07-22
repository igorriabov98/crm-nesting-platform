'use client'

import { useMemo, useState, useTransition } from 'react'
import { Check, Factory, PackagePlus, Search, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  createDetailingPart,
  type DetailingProductOption,
  type DetailingWarehouseData,
} from '@/lib/actions/detailing'

type CompatibilityDraft = {
  productId: string
  allVersions: boolean
  versionIds: string[]
}

type DetailingCreateDialogProps = {
  data: DetailingWarehouseData
  activeFactoryId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function productLabel(product: DetailingProductOption) {
  return `${product.name} · ${product.drawingNumber}`
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('ru')
}

export function DetailingCreateDialog({ data, activeFactoryId, open, onOpenChange }: DetailingCreateDialogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [drawingNumber, setDrawingNumber] = useState('')
  const [unitWeightKg, setUnitWeightKg] = useState('')
  const [initialQuantity, setInitialQuantity] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [compatibilities, setCompatibilities] = useState<CompatibilityDraft[]>([])
  const activeFactory = data.factories.find((factory) => factory.id === activeFactoryId) || null

  const filteredProducts = useMemo(() => {
    const query = normalizeSearch(productSearch)
    if (!query) return data.products

    return data.products.filter((product) =>
      [
        product.name,
        product.drawingNumber,
        ...product.versions.flatMap((version) => [version.versionNumber, version.drawingNumber]),
      ]
        .join(' ')
        .toLocaleLowerCase('ru')
        .includes(query)
    )
  }, [data.products, productSearch])

  const selectedProducts = useMemo(
    () => compatibilities
      .map((compatibility) => ({
        compatibility,
        product: data.products.find((product) => product.id === compatibility.productId),
      }))
      .filter((item): item is { compatibility: CompatibilityDraft; product: DetailingProductOption } => Boolean(item.product)),
    [compatibilities, data.products]
  )

  const canSubmit = Boolean(
    name.trim()
      && drawingNumber.trim()
      && Number(unitWeightKg) > 0
      && activeFactory
      && Number.isInteger(Number(initialQuantity))
      && Number(initialQuantity) > 0
      && compatibilities.length > 0
      && compatibilities.every((item) => item.allVersions || item.versionIds.length > 0)
  )

  const toggleProduct = (productId: string) => {
    setCompatibilities((current) => {
      if (current.some((item) => item.productId === productId)) {
        return current.filter((item) => item.productId !== productId)
      }
      return [...current, { productId, allVersions: true, versionIds: [] }]
    })
  }

  const updateCompatibility = (
    productId: string,
    updater: (compatibility: CompatibilityDraft) => CompatibilityDraft
  ) => {
    setCompatibilities((current) => current.map((item) => (
      item.productId === productId ? updater(item) : item
    )))
  }

  const reset = () => {
    setName('')
    setDrawingNumber('')
    setUnitWeightKg('')
    setInitialQuantity('')
    setProductSearch('')
    setCompatibilities([])
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const submit = () => {
    if (!canSubmit || !activeFactory) return

    startTransition(async () => {
      const result = await createDetailingPart({
        name,
        drawingNumber,
        unitWeightKg: Number(unitWeightKg),
        factoryId: activeFactory.id,
        initialQuantity: Number(initialQuantity),
        compatibilities,
      })

      if (!result.success) {
        toast.error(result.error || 'Не удалось создать карточку')
        return
      }

      toast.success('Карточка детали создана, начальное поступление записано')
      handleOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[min(92dvh,880px)] sm:w-[calc(100vw-2rem)] sm:max-w-3xl"
      >
        <header className="relative shrink-0 border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-4 pr-16 sm:px-6 sm:py-5 sm:pr-20">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#E7EEF8] text-[#1B3A6B]">
              <PackagePlus className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-semibold leading-6 text-[#172B4D] sm:text-xl">
                Новая карточка деталировки
              </DialogTitle>
              <DialogDescription className="mt-1 max-w-2xl text-sm leading-5 text-[#64748B]">
                Заполните данные детали, укажите начальный остаток и отметьте совместимые изделия.
              </DialogDescription>
            </div>
          </div>
          <DialogClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-3 top-3 h-11 w-11 rounded-full text-[#475569] hover:bg-[#E7EEF8] hover:text-[#1B3A6B] sm:right-5 sm:top-4"
                aria-label="Закрыть окно"
              />
            }
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </DialogClose>
        </header>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white px-4 py-5 sm:px-6 sm:py-6">
            <div className="space-y-5">
              <section aria-labelledby="detailing-main-data-title" className="rounded-xl border border-[#E2E8F0] bg-white p-4 sm:p-5">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1B3A6B] text-xs font-semibold text-white">1</span>
                  <div>
                    <h3 id="detailing-main-data-title" className="font-semibold text-[#172B4D]">Данные детали</h3>
                    <p className="text-xs leading-5 text-[#64748B]">Название, чертёж и вес одной штуки</p>
                  </div>
                </div>
                <div className="grid min-w-0 gap-4 md:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <label htmlFor="detailing-part-name" className="block text-sm font-medium text-[#334155]">Название детали</label>
                    <Input
                      id="detailing-part-name"
                      className="h-11"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Например, кронштейн опоры"
                      autoComplete="off"
                    />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <label htmlFor="detailing-drawing-number" className="block text-sm font-medium text-[#334155]">Номер чертежа</label>
                    <Input
                      id="detailing-drawing-number"
                      className="h-11"
                      value={drawingNumber}
                      onChange={(event) => setDrawingNumber(event.target.value)}
                      placeholder="Например, ЛЕДА.123.04"
                      autoComplete="off"
                    />
                  </div>
                  <div className="min-w-0 space-y-1.5 md:max-w-sm">
                    <label htmlFor="detailing-unit-weight" className="block text-sm font-medium text-[#334155]">Вес одной детали, кг</label>
                    <Input
                      id="detailing-unit-weight"
                      className="h-11"
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={unitWeightKg}
                      onChange={(event) => setUnitWeightKg(event.target.value)}
                      placeholder="0,000"
                    />
                  </div>
                </div>
              </section>

              <section aria-labelledby="detailing-first-batch-title" className="rounded-xl border border-[#E2E8F0] bg-[#FBFCFE] p-4 sm:p-5">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1B3A6B] text-xs font-semibold text-white">2</span>
                  <div>
                    <h3 id="detailing-first-batch-title" className="font-semibold text-[#172B4D]">Начальный остаток</h3>
                    <p className="text-xs leading-5 text-[#64748B]">Количество сразу появится на текущем складе</p>
                  </div>
                </div>
                <div className="grid min-w-0 gap-4 md:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <div className="text-sm font-medium text-[#334155]">Текущий склад</div>
                    <div className="flex min-h-11 items-center gap-3 rounded-lg border border-[#C9D7E8] bg-white px-3 py-2.5" aria-label={`Текущий склад: ${activeFactory?.name || 'не выбран'}`}>
                      <Factory className="h-5 w-5 shrink-0 text-[#1B3A6B]" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#1B3A6B]">{activeFactory?.name || 'Склад не выбран'}</div>
                        <div className="text-xs leading-4 text-[#64748B]">Определён текущей страницей склада</div>
                      </div>
                    </div>
                    <p className="text-xs leading-5 text-[#64748B]">Деталировка автоматически поступит на этот склад.</p>
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <label htmlFor="detailing-first-quantity" className="block text-sm font-medium text-[#334155]">Начальное количество, шт.</label>
                    <Input
                      id="detailing-first-quantity"
                      className="h-11"
                      type="number"
                      min="1"
                      step="1"
                      value={initialQuantity}
                      onChange={(event) => setInitialQuantity(event.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
              </section>

              <section aria-labelledby="detailing-compatible-products-title" className="rounded-xl border border-[#D9E2EF] bg-white p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1B3A6B] text-xs font-semibold text-white">3</span>
                    <div>
                      <h3 id="detailing-compatible-products-title" className="font-semibold text-[#172B4D]">Совместимые изделия</h3>
                      <p className="text-xs leading-5 text-[#64748B]">Найдите и отметьте минимум одно изделие</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-[#E7EEF8] px-3 py-1 text-xs font-semibold text-[#1B3A6B]">
                    Выбрано: {compatibilities.length}
                  </span>
                </div>

                <div className="space-y-2">
                  <label htmlFor="detailing-product-search" className="block text-sm font-medium text-[#334155]">Поиск изделия</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" aria-hidden="true" />
                    <Input
                      id="detailing-product-search"
                      className="h-11 pl-10"
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="Название, номер чертежа или версия"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="mt-3 max-h-60 space-y-2 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2" role="group" aria-label="Выбор совместимых изделий">
                  {filteredProducts.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-[#64748B]">
                      Изделия по запросу не найдены. Проверьте название или номер чертежа.
                    </div>
                  ) : filteredProducts.map((product) => {
                    const selected = compatibilities.some((item) => item.productId === product.id)
                    return (
                      <label
                        key={product.id}
                        className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                          selected
                            ? 'border-[#9CB4D4] bg-[#EAF1FB]'
                            : 'border-transparent bg-white hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-[#1B3A6B]"
                          checked={selected}
                          onChange={() => toggleProduct(product.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[#243B5A]">{product.name}</span>
                          <span className="block truncate text-xs text-[#64748B]">Чертёж: {product.drawingNumber}</span>
                        </span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-[#1B3A6B]" aria-hidden="true" />}
                      </label>
                    )
                  })}
                </div>

                {selectedProducts.length > 0 && (
                  <div className="mt-5 space-y-3">
                    <div className="text-sm font-semibold text-[#334155]">Настройка выбранных изделий</div>
                    {selectedProducts.map(({ compatibility, product }) => (
                      <article key={product.id} className="min-w-0 rounded-xl border border-[#D9E2EF] bg-[#FBFCFE] p-3 sm:p-4">
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="break-words text-sm font-semibold text-[#243B5A]">{productLabel(product)}</div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-9 shrink-0 text-[#64748B] hover:text-[#B42318]"
                            onClick={() => toggleProduct(product.id)}
                          >
                            Убрать
                          </Button>
                        </div>
                        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm text-[#334155]">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[#1B3A6B]"
                            checked={compatibility.allVersions}
                            onChange={(event) => updateCompatibility(product.id, (item) => ({
                              ...item,
                              allVersions: event.target.checked,
                              versionIds: event.target.checked ? [] : item.versionIds,
                            }))}
                          />
                          Подходит для всех версий изделия
                        </label>
                        {!compatibility.allVersions && (
                          <fieldset className="mt-3">
                            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-[#64748B]">Выберите версии</legend>
                            {product.versions.length === 0 ? (
                              <p className="rounded-lg border border-dashed border-[#CBD5E1] bg-white p-3 text-sm text-[#64748B]">У изделия нет доступных версий.</p>
                            ) : (
                              <div className="grid min-w-0 gap-2 md:grid-cols-2">
                                {product.versions.map((version) => (
                                  <label key={version.id} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#334155]">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 shrink-0 accent-[#1B3A6B]"
                                      checked={compatibility.versionIds.includes(version.id)}
                                      onChange={(event) => updateCompatibility(product.id, (item) => ({
                                        ...item,
                                        versionIds: event.target.checked
                                          ? [...item.versionIds, version.id]
                                          : item.versionIds.filter((id) => id !== version.id),
                                      }))}
                                    />
                                    <span className="min-w-0 break-words">Версия {version.versionNumber} · {version.drawingNumber}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </fieldset>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>

          <footer className="shrink-0 border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-4 sm:px-6">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-[#64748B] sm:max-w-sm">
                Все поля обязательны. Для выбранной детали укажите все версии или отметьте нужные.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" className="h-11 sm:min-w-24" onClick={() => handleOpenChange(false)}>
                  Отмена
                </Button>
                <Button type="submit" className="h-11 bg-[#1B3A6B] px-5 hover:bg-[#153158] sm:min-w-44" disabled={isPending || !canSubmit}>
                  {isPending ? 'Сохранение…' : 'Создать карточку'}
                </Button>
              </div>
            </div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  )
}
