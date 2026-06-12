'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { History, PackagePlus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ACTIVE_MATERIAL_CATEGORIES,
  CATEGORY_UNITS,
  CHAIN_CORD_SUBTYPE_LABELS,
  MATERIAL_CATEGORY_LABELS,
  PIPE_SUBTYPE_LABELS,
  WIRE_UNIT,
  defaultMaterialNameForCategory,
} from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import { addReceipt, adjustInventory, deleteInventoryItem, type InventoryWithMaterial } from '@/lib/actions/inventory'
import { createMaterial, recordMaterialUsage, type MaterialWithSupplier } from '@/lib/actions/materials'
import type { MaterialCategory, MaterialVariant, Supplier } from '@/lib/types'
import type { SteelType } from '@/lib/types/database'

const MaterialSearch = dynamic(() => import('@/components/features/requests/MaterialSearch').then((mod) => mod.MaterialSearch), {
  loading: () => <div className="h-10 rounded-md border border-[#E8ECF0] bg-[#F8F9FA]" />,
})

type Props = {
  items: InventoryWithMaterial[]
  suppliers: Supplier[]
  steelTypes: SteelType[]
  resultLimit?: number
}

type UnitPair = { primary: string; secondary?: string }
type CharacteristicField = { label: string; value: string | number | null | undefined }
type NewMaterialDraft = {
  name: string
  category: MaterialCategory
  fields: Record<string, string | boolean>
}

export function InventoryPage({ items, suppliers, steelTypes, resultLimit }: Props) {
  const router = useRouter()
  const rows = items
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [stockMode, setStockMode] = useState<'main' | 'business_scrap'>('main')
  const [receiptCategory, setReceiptCategory] = useState<MaterialCategory>('sheet_metal')
  const [receiptMaterial, setReceiptMaterial] = useState<{ id: string; name: string; category: MaterialCategory } | null>(null)
  const [receiptVariant, setReceiptVariant] = useState<MaterialVariant | null>(null)
  const [receiptQuantity, setReceiptQuantity] = useState('')
  const [receiptSecondaryQuantity, setReceiptSecondaryQuantity] = useState('')
  const [receiptPieceLength, setReceiptPieceLength] = useState('')
  const [receiptSteelTypeId, setReceiptSteelTypeId] = useState('')
  const [receiptUnitWeightKg, setReceiptUnitWeightKg] = useState('')
  const [receiptComment, setReceiptComment] = useState('')
  const [receiptSupplierId, setReceiptSupplierId] = useState('')
  const [newMaterialDraft, setNewMaterialDraft] = useState<NewMaterialDraft | null>(null)
  const [materialSearchVersion, setMaterialSearchVersion] = useState(0)
  const [adjustRow, setAdjustRow] = useState<InventoryWithMaterial | null>(null)
  const [adjustTotal, setAdjustTotal] = useState('')
  const [adjustSecondaryTotal, setAdjustSecondaryTotal] = useState('')
  const [adjustComment, setAdjustComment] = useState('')
  const [isPending, startTransition] = useTransition()

  const receiptUnits = getUnitsForReceipt(receiptCategory, receiptVariant)
  const calculatedPieceCount = receiptAutoCalculatesPieces(receiptCategory, receiptVariant)
    ? calculatePieceCount(receiptQuantity, receiptPieceLength)
    : null
  const receiptNeedsSteelType = needsReceiptSteelType(receiptCategory, receiptVariant)
  const receiptNeedsUnitWeight = needsReceiptUnitWeight(receiptCategory)
  const showSheetMetalColumns = category === 'sheet_metal'
  const showCircleColumns = category === 'circle'
  const showPipeColumns = category === 'pipe'

  const mainStockCount = useMemo(() => rows.filter((row) => !row.is_business_scrap).length, [rows])
  const businessScrapCount = useMemo(() => rows.filter((row) => row.is_business_scrap).length, [rows])
  const filtered = useMemo(() => rows.filter((row) => {
    if (stockMode === 'business_scrap' ? !row.is_business_scrap : row.is_business_scrap) return false
    if (search && !inventoryMatchesSearch(row, search)) return false
    if (category !== 'all' && row.material?.category !== category) return false
    if (onlyAvailable && row.available_quantity <= 0) return false
    return true
  }), [category, onlyAvailable, rows, search, stockMode])
  const showPieceLengthColumn = filteredHasPieceLength(filtered)

  const resetReceiptForm = (keepCategory = true) => {
    setReceiptMaterial(null)
    setReceiptVariant(null)
    setReceiptQuantity('')
    setReceiptSecondaryQuantity('')
    setReceiptPieceLength('')
    setReceiptSteelTypeId('')
    setReceiptUnitWeightKg('')
    setReceiptComment('')
    setReceiptSupplierId('')
    setNewMaterialDraft(null)
    if (!keepCategory) setReceiptCategory('sheet_metal')
  }

  const startCreateMaterial = (name: string, draftCategory: MaterialCategory) => {
    const draftName = defaultMaterialNameForCategory(draftCategory) ?? name
    setReceiptMaterial(null)
    setReceiptVariant(null)
    setReceiptQuantity('')
    setReceiptSecondaryQuantity('')
    setReceiptPieceLength('')
    setReceiptSteelTypeId('')
    setReceiptUnitWeightKg('')
    setReceiptCategory(draftCategory)
    setNewMaterialDraft({ name: draftName, category: draftCategory, fields: defaultDraftFields(draftCategory) })
  }

  const updateDraftField = (field: string, value: string | boolean) => {
    setNewMaterialDraft((current) => current ? {
      ...current,
      fields: { ...current.fields, [field]: value },
    } : current)
  }

  const saveNewMaterial = () => {
    if (!newMaterialDraft) return
    const validationError = validateDraft(newMaterialDraft)
    if (validationError) {
      toast.error(validationError)
      return
    }

    startTransition(async () => {
      const materialResult = await createMaterial({
        name: newMaterialDraft.name,
        category: newMaterialDraft.category,
      })
      if (!materialResult.success || !materialResult.data) {
        toast.error(materialResult.error || 'Не удалось создать материал')
        return
      }

      const variantResult = await recordMaterialUsage({
        material_id: materialResult.data.id,
        category: newMaterialDraft.category,
        characteristics: draftToCharacteristics(newMaterialDraft, steelTypes),
      })
      if (!variantResult.success || !variantResult.data) {
        toast.error(variantResult.error || 'Не удалось создать характеристики материала')
        return
      }

      const selected = { ...(materialResult.data as MaterialWithSupplier), supplier_name: null }
      setReceiptMaterial({ id: selected.id, name: selected.name, category: selected.category })
      setReceiptCategory(selected.category)
      setReceiptVariant(variantResult.data)
      setReceiptQuantity('')
      setReceiptSecondaryQuantity('')
      setReceiptPieceLength('')
      setReceiptSteelTypeId('')
      setReceiptUnitWeightKg('')
      setNewMaterialDraft(null)
      setMaterialSearchVersion((version) => version + 1)
      toast.success('Материал добавлен')
      router.refresh()
    })
  }

  const submitReceipt = () => {
    if (!receiptMaterial) return toast.error('Выберите материал')
    if (!receiptSupplierId) return toast.error('Выберите поставщика')
    if (receiptCategory === 'pipe' && !receiptVariant?.pipe_type) {
      toast.error('Для трубы выберите вариант материала с подтипом')
      return
    }
    if (receiptNeedsSteelType && !receiptSteelTypeId) {
      toast.error('Выберите марку стали для расчета веса трубы')
      return
    }
    const unitWeightKg = Number(receiptUnitWeightKg || 0)
    if (receiptNeedsUnitWeight && (!Number.isFinite(unitWeightKg) || unitWeightKg <= 0)) {
      toast.error('Введите вес одной позиции')
      return
    }

    const quantity = Number(receiptQuantity || 0)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error('Введите количество прихода')
      return
    }

    const secondaryQuantity = calculatedPieceCount !== null
      ? calculatedPieceCount
      : receiptUnits.secondary ? Number(receiptSecondaryQuantity || 0) : null
    if (receiptUnits.secondary && (secondaryQuantity === null || !Number.isFinite(secondaryQuantity) || secondaryQuantity <= 0)) {
      toast.error(`Введите количество (${receiptUnits.secondary})`)
      return
    }

    const needsPieceLength = receiptNeedsPieceLength(receiptCategory, receiptVariant)
    const pieceLength = needsPieceLength && receiptPieceLength
      ? Number(receiptPieceLength)
      : null
    if (needsPieceLength && pieceLength === null) {
      toast.error('Введите длину куска')
      return
    }
    if (pieceLength !== null && (!Number.isFinite(pieceLength) || pieceLength <= 0)) {
      toast.error('Введите длину куска')
      return
    }

    const metadataComment = buildReceiptComment({
      category: receiptCategory,
      variant: receiptVariant,
      comment: receiptComment,
    })

    startTransition(async () => {
      let materialVariantId = receiptVariant?.id ?? null
      if (receiptNeedsSteelType && receiptVariant) {
        const steelName = steelTypes.find((steelType) => steelType.id === receiptSteelTypeId)?.name ?? null
        if (!steelName) {
          toast.error('Выберите марку стали для расчета веса трубы')
          return
        }

        const variantResult = await recordMaterialUsage({
          material_id: receiptMaterial.id,
          category: 'pipe',
          characteristics: {
            pipe_type: receiptVariant.pipe_type,
            steel_type_id: receiptSteelTypeId,
            material_grade: steelName,
            size: receiptVariant.piece_description,
            wall_thickness_mm: receiptVariant.wall_thickness_mm,
            diameter_mm: receiptVariant.diameter_mm,
          },
        })
        if (!variantResult.success || !variantResult.data) {
          toast.error(variantResult.error || 'Не удалось создать вариант трубы с маркой стали')
          return
        }
        materialVariantId = variantResult.data.id
      }
      if (receiptNeedsUnitWeight && unitWeightKg) {
        const variantResult = await recordMaterialUsage({
          material_id: receiptMaterial.id,
          category: 'components',
          characteristics: {
            diameter_mm: receiptVariant?.diameter_mm ?? null,
            specification: receiptVariant?.specification ?? null,
            default_unit: receiptVariant?.default_unit ?? 'шт',
            unit_weight_kg: unitWeightKg,
          },
        })
        if (!variantResult.success || !variantResult.data) {
          toast.error(variantResult.error || 'Не удалось создать вариант комплектации с весом')
          return
        }
        materialVariantId = variantResult.data.id
      }

      const result = await addReceipt({
        material_id: receiptMaterial.id,
        material_variant_id: materialVariantId,
        quantity,
        unit: receiptUnits.primary,
        secondary_quantity: secondaryQuantity,
        secondary_unit: receiptUnits.secondary ?? null,
        supplier_id: receiptSupplierId,
        piece_length_mm: pieceLength,
        comment: metadataComment,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось оприходовать материал')
        return
      }
      toast.success('Приход сохранён')
      resetReceiptForm()
      setMaterialSearchVersion((version) => version + 1)
      router.refresh()
    })
  }

  const openAdjust = (row: InventoryWithMaterial) => {
    setAdjustRow(row)
    setAdjustTotal(String(row.total_quantity))
    setAdjustSecondaryTotal(row.total_secondary_quantity === null ? '' : String(row.total_secondary_quantity))
    setAdjustComment('')
  }

  const submitAdjust = () => {
    if (!adjustRow) return
    startTransition(async () => {
    const result = await adjustInventory({
      inventory_id: adjustRow.id,
      material_id: adjustRow.material_id,
        new_total: Number(adjustTotal || 0),
        new_secondary_total: adjustRow.secondary_unit ? Number(adjustSecondaryTotal || 0) : null,
        comment: adjustComment,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось скорректировать остаток')
        return
      }
      toast.success('Остаток скорректирован')
      setAdjustRow(null)
      router.refresh()
    })
  }

  const deleteRow = (row: InventoryWithMaterial) => {
    const confirmed = window.confirm(`Удалить "${row.material?.name || 'материал'}" со склада? История останется, строка исчезнет из остатков.`)
    if (!confirmed) return

    startTransition(async () => {
      const result = await deleteInventoryItem(row.id)
      if (!result.success) {
        toast.error(result.error || 'Не удалось удалить материал со склада')
        return
      }
      toast.success('Материал удалён со склада')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#E8ECF0] bg-white p-4">
        <div className="mb-4 inline-flex rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-1">
          <button
            type="button"
            onClick={() => setStockMode('main')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${stockMode === 'main' ? 'bg-white text-[#1B3A6B] shadow-sm' : 'text-[#6B7280]'}`}
          >
            Основной склад ({mainStockCount})
          </button>
          <button
            type="button"
            onClick={() => setStockMode('business_scrap')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${stockMode === 'business_scrap' ? 'bg-white text-[#1B3A6B] shadow-sm' : 'text-[#6B7280]'}`}
          >
            Деловой отход ({businessScrapCount})
          </button>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-[#374151]">Поиск</label>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название материала" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[#374151]">Категория</label>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 rounded-md border border-[#E8ECF0] bg-white px-3 text-sm">
              <option value="all">Все категории</option>
              {ACTIVE_MATERIAL_CATEGORIES.map((item) => <option key={item} value={item}>{MATERIAL_CATEGORY_LABELS[item]}</option>)}
            </select>
          </div>
          <label className="flex h-10 items-center gap-2 text-sm text-[#374151]">
            <input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} />
            Только с остатком
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-[#E8ECF0] bg-white p-4">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-[#1B3A6B]">
          <PackagePlus className="h-5 w-5" />
          Приход на склад
        </h2>

        <div className="grid gap-4 lg:grid-cols-[220px_minmax(320px,1fr)]">
          <div>
            <label className="mb-1 block text-sm font-medium text-[#374151]">Категория</label>
            <select
              value={receiptCategory}
              onChange={(event) => {
                const nextCategory = event.target.value as MaterialCategory
                resetReceiptForm(true)
                setReceiptCategory(nextCategory)
              }}
              className="h-10 w-full rounded-md border border-[#E8ECF0] bg-white px-3 text-sm"
            >
              {ACTIVE_MATERIAL_CATEGORIES.map((item) => (
                <option key={item} value={item}>{MATERIAL_CATEGORY_LABELS[item]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[#374151]">Материал</label>
            <MaterialSearch
              key={`${receiptCategory}-${materialSearchVersion}`}
              category={receiptCategory}
              value={receiptMaterial?.name || ''}
              placeholder="Начните вводить название материала..."
              onSelect={(material, variant) => {
                if (material.category !== receiptCategory) {
                  toast.error('Выберите материал из выбранной категории')
                  return
                }
                setReceiptMaterial({ id: material.id, name: material.name, category: material.category })
                setReceiptVariant(variant ?? null)
                setReceiptQuantity('')
                setReceiptSecondaryQuantity('')
                setReceiptPieceLength('')
                setReceiptSteelTypeId((variant as (MaterialVariant & { steel_type_id?: string | null }) | undefined)?.steel_type_id ?? '')
                setReceiptUnitWeightKg(variant?.unit_weight_kg ? String(variant.unit_weight_kg) : '')
                setReceiptSupplierId(material.default_supplier_id || '')
                setNewMaterialDraft(null)
              }}
              onCreateRequest={startCreateMaterial}
            />
          </div>
        </div>

        {newMaterialDraft ? (
          <NewMaterialForm
            draft={newMaterialDraft}
            onNameChange={(name) => setNewMaterialDraft((current) => current ? { ...current, name } : current)}
            onFieldChange={updateDraftField}
            onCancel={() => setNewMaterialDraft(null)}
            onSave={saveNewMaterial}
            isPending={isPending}
            steelTypes={steelTypes}
          />
        ) : receiptMaterial ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg bg-[#F8F9FA] p-3">
              <h3 className="text-sm font-semibold text-[#1B3A6B]">
                {receiptMaterial.name} — {MATERIAL_CATEGORY_LABELS[receiptMaterial.category] ?? receiptMaterial.category}
              </h3>
              <CharacteristicsBlock category={receiptMaterial.category} variant={receiptVariant} steelTypes={steelTypes} />
              {receiptNeedsSteelType && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm text-amber-800">Для расчета веса выберите марку стали.</p>
                  <div className="mt-3 max-w-xs">
                    <SteelTypeSelect value={receiptSteelTypeId} steelTypes={steelTypes} onChange={setReceiptSteelTypeId} />
                  </div>
                </div>
              )}
              {receiptNeedsUnitWeight && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm text-amber-800">Для расчета веса укажите вес одной позиции.</p>
                  <div className="mt-3 max-w-xs">
                    <label className="mb-1 block text-sm font-medium text-[#374151]">Вес 1 шт, кг</label>
                    <Input type="number" min="0" step="0.001" value={receiptUnitWeightKg} onChange={(event) => setReceiptUnitWeightKg(event.target.value)} placeholder="Например: 0.05" />
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[minmax(180px,240px)_minmax(180px,240px)_minmax(260px,1fr)_160px]">
              <div>
                <label className="mb-1 block text-sm font-medium text-[#374151]">Поставщик</label>
                <select
                  value={receiptSupplierId}
                  onChange={(event) => setReceiptSupplierId(event.target.value)}
                  className="h-10 w-full rounded-md border border-[#E8ECF0] bg-white px-3 text-sm"
                >
                  <option value="">Выберите поставщика</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[#374151]">{receiptQuantityLabel(receiptCategory, receiptVariant)}</label>
                <Input type="number" min="0" step="0.01" value={receiptQuantity} onChange={(event) => setReceiptQuantity(event.target.value)} placeholder="0" />
              </div>
              {receiptUnits.secondary && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#374151]">Приход, {receiptUnits.secondary}</label>
                  {calculatedPieceCount !== null ? (
                    <Input type="number" value={Number.isFinite(calculatedPieceCount) && calculatedPieceCount > 0 ? formatAmount(calculatedPieceCount) : ''} readOnly placeholder="Считается автоматически" />
                  ) : (
                    <Input type="number" min="0" step="1" value={receiptSecondaryQuantity} onChange={(event) => setReceiptSecondaryQuantity(event.target.value)} placeholder="0" />
                  )}
                </div>
              )}
              {receiptNeedsPieceLength(receiptCategory, receiptVariant) && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#374151]">Длина куска, мм</label>
                  <Input type="number" min="0" step="0.01" value={receiptPieceLength} onChange={(event) => setReceiptPieceLength(event.target.value)} placeholder="Например: 6000" />
                  <span className="mt-1 block text-sm text-gray-500">Количество штук считается автоматически по приходу и длине куска.</span>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-[#374151]">Комментарий</label>
                <Input placeholder="Накладная / поставщик / примечание" value={receiptComment} onChange={(event) => setReceiptComment(event.target.value)} />
              </div>
              <div className="flex items-end">
                <Button className="w-full" onClick={submitReceipt} disabled={isPending}>Оприходовать</Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[#6B7280]">Выберите категорию и материал, чтобы увидеть характеристики и поля прихода.</p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
        {resultLimit && rows.length >= resultLimit && (
          <div className="border-b border-[#E8ECF0] px-4 py-2 text-sm text-[#6B7280]">
            Показаны последние {resultLimit} складских строк по обновлению.
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] text-[#6B7280]">
              <tr>
                <th className="min-w-[260px] px-4 py-3">Материал</th>
                <th className="min-w-[150px] px-4 py-3">Категория</th>
                {showSheetMetalColumns ? (
                  <>
                    <th className="min-w-[140px] px-4 py-3">Тип стали</th>
                    <th className="min-w-[140px] px-4 py-3">Размер</th>
                    <th className="min-w-[120px] px-4 py-3">Толщина</th>
                  </>
                ) : showCircleColumns ? (
                  <>
                    <th className="min-w-[140px] px-4 py-3">Тип стали</th>
                    <th className="min-w-[120px] px-4 py-3">Диаметр</th>
                    <th className="min-w-[130px] px-4 py-3">Калибровка</th>
                  </>
                ) : showPipeColumns ? (
                  <>
                    <th className="min-w-[140px] px-4 py-3">Подтип</th>
                    <th className="min-w-[140px] px-4 py-3">Размер</th>
                    <th className="min-w-[140px] px-4 py-3">Толщина</th>
                    <th className="min-w-[120px] px-4 py-3">Диаметр</th>
                  </>
                ) : (
                  <th className="min-w-[220px] px-4 py-3">Характеристики</th>
                )}
                <th className="px-4 py-3">Всего</th>
                <th className="px-4 py-3">Забронировано</th>
                <th className="px-4 py-3">Доступно</th>
                <th className="px-4 py-3">Вес, кг</th>
                {showPieceLengthColumn && <th className="min-w-[130px] px-4 py-3">Длина куска</th>}
                <th className="px-4 py-3">Ед.</th>
                <th className="min-w-[180px] px-4 py-3">Обновлено</th>
                <th className="px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {filtered.map((row) => (
                <tr key={row.id} className={row.available_quantity <= 0 ? 'bg-red-50/60' : 'bg-white'}>
                  <td className="px-4 py-3 font-medium text-[#1B3A6B]">
                    <div>{row.material?.name || 'Материал'}</div>
                    {row.is_business_scrap && (
                      <div className="mt-1 text-xs font-normal text-amber-700">
                        Деловой отход после раскроя{row.source_piece_length_mm ? ` из ${formatPieceLength(row.source_piece_length_mm)}` : ''}{row.source_machine_name ? ` для машины ${row.source_machine_name}` : ''}
                      </div>
                    )}
                    {row.is_legacy_variant && (
                      <div className="mt-1 text-xs font-normal text-amber-700">
                        Остаток без привязки к характеристикам
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">{categoryLabel(row.material?.category)}</td>
                  {showSheetMetalColumns ? (
                    <>
                      <td className="px-4 py-3 text-[#6B7280]">{characteristicCell(row, steelTypeName(row.variant, steelTypes) ?? row.variant?.material_grade)}</td>
                      <td className="px-4 py-3 text-[#6B7280]">{characteristicCell(row, row.variant?.sheet_size)}</td>
                      <td className="px-4 py-3 text-[#6B7280]">{characteristicCell(row, row.variant?.thickness_mm)}</td>
                    </>
                  ) : showCircleColumns ? (
                    <>
                      <td className="px-4 py-3 text-[#6B7280]">{characteristicCell(row, steelTypeName(row.variant, steelTypes) ?? circleSteelGrade(row.variant))}</td>
                      <td className="px-4 py-3 text-[#6B7280]">{characteristicCell(row, row.variant?.diameter_mm)}</td>
                      <td className="px-4 py-3 text-[#6B7280]">{row.variant ? (row.variant.is_calibrated ? 'Да' : 'Нет') : legacyCharacteristicsText(row)}</td>
                    </>
                  ) : showPipeColumns ? (
                    <>
                      <td className="px-4 py-3 text-[#6B7280]">{row.variant?.pipe_type ? PIPE_SUBTYPE_LABELS[row.variant.pipe_type] ?? row.variant.pipe_type : legacyCharacteristicsText(row)}</td>
                      <td className="px-4 py-3 text-[#6B7280]">{row.variant?.pipe_type === 'wire' ? '—' : characteristicCell(row, row.variant?.piece_description)}</td>
                      <td className="px-4 py-3 text-[#6B7280]">{row.variant?.pipe_type === 'wire' ? '—' : characteristicCell(row, row.variant?.wall_thickness_mm)}</td>
                      <td className="px-4 py-3 text-[#6B7280]">{row.variant?.pipe_type === 'wire' ? characteristicCell(row, row.variant?.diameter_mm) : '—'}</td>
                    </>
                  ) : (
                    <td className="px-4 py-3 text-[#6B7280]">{inventoryCharacteristicsSummary(row, steelTypes)}</td>
                  )}
                  <td className="px-4 py-3">{quantityText(row.total_quantity, row.unit, row.total_secondary_quantity, row.secondary_unit)}</td>
                  <td className="px-4 py-3">{quantityText(row.reserved_quantity, row.unit, row.reserved_secondary_quantity, row.secondary_unit)}</td>
                  <td className="px-4 py-3 font-semibold">{quantityText(row.available_quantity, row.unit, row.available_secondary_quantity, row.secondary_unit)}</td>
                  <td className="px-4 py-3">{formatWeight(row.calculated_weight_kg)}</td>
                  {showPieceLengthColumn && <td className="px-4 py-3">{formatPieceLength(row.piece_length_mm)}</td>}
                  <td className="px-4 py-3">{row.unit}{row.secondary_unit ? ` / ${row.secondary_unit}` : ''}</td>
                  <td className="px-4 py-3 text-[#6B7280]">{new Date(row.updated_at).toLocaleString('ru-RU')}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => openAdjust(row)}>
                        <SlidersHorizontal className="mr-1 h-4 w-4" />
                        Корректировка
                      </Button>
                      <Link href={`${ROUTES.INVENTORY}/${row.material_id}/history`}>
                        <Button type="button" size="sm" variant="ghost">
                          <History className="mr-1 h-4 w-4" />
                          История
                        </Button>
                      </Link>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => deleteRow(row)}
                        disabled={isPending}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Удалить
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={(showPipeColumns ? 13 : showSheetMetalColumns || showCircleColumns ? 12 : 10) + (showPieceLengthColumn ? 1 : 0)} className="px-4 py-8 text-center text-[#9CA3AF]">Остатков не найдено</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {adjustRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Корректировка остатка</h2>
            <p className="mt-1 text-sm text-[#6B7280]">{adjustRow.material?.name}</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-[#374151]">Новое количество ({adjustRow.unit})</label>
                <Input type="number" step="0.01" value={adjustTotal} onChange={(event) => setAdjustTotal(event.target.value)} />
              </div>
              {adjustRow.secondary_unit && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-[#374151]">Новое количество ({adjustRow.secondary_unit})</label>
                  <Input type="number" step="0.01" value={adjustSecondaryTotal} onChange={(event) => setAdjustSecondaryTotal(event.target.value)} />
                </div>
              )}
              <Input value={adjustComment} onChange={(event) => setAdjustComment(event.target.value)} placeholder="Причина корректировки" />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAdjustRow(null)}>Отмена</Button>
              <Button onClick={submitAdjust} disabled={isPending}>Сохранить</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NewMaterialForm({
  draft,
  onNameChange,
  onFieldChange,
  onCancel,
  onSave,
  isPending,
  steelTypes,
}: {
  draft: NewMaterialDraft
  onNameChange: (name: string) => void
  onFieldChange: (field: string, value: string | boolean) => void
  onCancel: () => void
  onSave: () => void
  isPending: boolean
  steelTypes: SteelType[]
}) {
  const isPipeWire = draft.category === 'pipe' && draft.fields.pipe_type === 'wire'

  return (
    <div className="mt-4 rounded-lg border border-dashed border-[#BFD0E8] bg-[#F8FBFF] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[#1B3A6B]">
          Новый материал — {MATERIAL_CATEGORY_LABELS[draft.category] ?? draft.category}
        </h3>
        <p className="mt-1 text-sm text-[#6B7280]">Заполните характеристики, чтобы материал сразу появился с правильным вариантом.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-[#374151]">Название</label>
          <Input value={draft.name} onChange={(event) => onNameChange(event.target.value)} />
        </div>

        {draft.category === 'sheet_metal' && (
          <>
            <SteelTypeSelect value={draft.fields.steel_type_id} steelTypes={steelTypes} onChange={(value) => onFieldChange('steel_type_id', value)} />
            <DraftInput label="Размер" value={draft.fields.sheet_size} onChange={(value) => onFieldChange('sheet_size', value)} placeholder="2000x650" />
            <DraftInput label="Толщина, мм" type="number" value={draft.fields.thickness_mm} onChange={(value) => onFieldChange('thickness_mm', value)} />
          </>
        )}

        {draft.category === 'circle' && (
          <>
            <SteelTypeSelect value={draft.fields.steel_type_id} steelTypes={steelTypes} onChange={(value) => onFieldChange('steel_type_id', value)} />
            <DraftInput label="Диаметр, мм" type="number" value={draft.fields.diameter_mm} onChange={(value) => onFieldChange('diameter_mm', value)} />
            <label className="flex items-center gap-2 pt-7 text-sm text-[#374151]">
              <input type="checkbox" checked={Boolean(draft.fields.is_calibrated)} onChange={(event) => onFieldChange('is_calibrated', event.target.checked)} />
              Калибровка
            </label>
          </>
        )}

        {draft.category === 'pipe' && (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-[#374151]">Подтип</label>
              <select
                value={String(draft.fields.pipe_type || '')}
                onChange={(event) => onFieldChange('pipe_type', event.target.value)}
                className="h-10 w-full rounded-md border border-[#E8ECF0] bg-white px-3 text-sm"
              >
                {Object.entries(PIPE_SUBTYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            {!isPipeWire && <SteelTypeSelect value={draft.fields.steel_type_id} steelTypes={steelTypes} onChange={(value) => onFieldChange('steel_type_id', value)} />}
            {!isPipeWire && <DraftInput label="Размер" value={draft.fields.size} onChange={(value) => onFieldChange('size', value)} placeholder="40x40" />}
            {!isPipeWire && <DraftInput label="Толщина стенки, мм" type="number" value={draft.fields.wall_thickness_mm} onChange={(value) => onFieldChange('wall_thickness_mm', value)} />}
            {isPipeWire && <DraftInput label="Диаметр, мм" type="number" value={draft.fields.diameter_mm} onChange={(value) => onFieldChange('diameter_mm', value)} />}
          </>
        )}

        {draft.category === 'knives' && (
          <>
            <SteelTypeSelect value={draft.fields.steel_type_id} steelTypes={steelTypes} onChange={(value) => onFieldChange('steel_type_id', value)} />
            <DraftInput label="Длина, мм" type="number" value={draft.fields.standard_length_mm} onChange={(value) => onFieldChange('standard_length_mm', value)} />
            <DraftInput label="Ширина, мм" type="number" value={draft.fields.width_mm} onChange={(value) => onFieldChange('width_mm', value)} />
            <DraftInput label="Высота, мм" type="number" value={draft.fields.height_mm} onChange={(value) => onFieldChange('height_mm', value)} />
          </>
        )}

        {draft.category === 'paint' && (
          <>
            <DraftInput label="RAL" value={draft.fields.ral_code} onChange={(value) => onFieldChange('ral_code', value)} />
            <DraftInput label="Покрытие" value={draft.fields.finish} onChange={(value) => onFieldChange('finish', value)} placeholder="матовый / глянец / шагрень" />
          </>
        )}

        {draft.category === 'components' && (
          <>
            <DraftInput label="Диаметр, мм" type="number" value={draft.fields.diameter_mm} onChange={(value) => onFieldChange('diameter_mm', value)} />
            <DraftInput label="Спецификация" value={draft.fields.specification} onChange={(value) => onFieldChange('specification', value)} />
            <DraftInput label="Вес 1 шт, кг" type="number" value={draft.fields.unit_weight_kg} onChange={(value) => onFieldChange('unit_weight_kg', value)} placeholder="Например: 0.05" />
          </>
        )}

        {draft.category === 'mesh' && (
          <>
            <DraftInput label="Характеристика решетки" value={draft.fields.mesh_description} onChange={(value) => onFieldChange('mesh_description', value)} />
            <DraftInput label="Длина, мм" type="number" value={draft.fields.mesh_length_mm} onChange={(value) => onFieldChange('mesh_length_mm', value)} />
            <DraftInput label="Ширина, мм" type="number" value={draft.fields.mesh_width_mm} onChange={(value) => onFieldChange('mesh_width_mm', value)} />
          </>
        )}

        {draft.category === 'chain_cord' && (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-[#374151]">Тип</label>
              <select
                value={String(draft.fields.chain_cord_type || 'chain')}
                onChange={(event) => onFieldChange('chain_cord_type', event.target.value)}
                className="h-10 w-full rounded-md border border-[#E8ECF0] bg-white px-3 text-sm"
              >
                {Object.entries(CHAIN_CORD_SUBTYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <DraftInput label="Параметры" value={draft.fields.chain_cord_parameters} onChange={(value) => onFieldChange('chain_cord_parameters', value)} />
          </>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Отмена</Button>
        <Button type="button" onClick={onSave} disabled={isPending}>Сохранить материал</Button>
      </div>
    </div>
  )
}

function DraftInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string | boolean | undefined
  onChange: (value: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[#374151]">{label}</label>
      <Input type={type} value={typeof value === 'boolean' ? String(value) : String(value ?? '')} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  )
}

function SteelTypeSelect({
  value,
  steelTypes,
  onChange,
}: {
  value: string | boolean | undefined
  steelTypes: SteelType[]
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[#374151]">Тип стали</label>
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-[#E8ECF0] bg-white px-3 text-sm"
      >
        <option value="">— не выбрано —</option>
        {steelTypes.map((steelType) => (
          <option key={steelType.id} value={steelType.id}>{steelType.name}</option>
        ))}
      </select>
    </div>
  )
}

function CharacteristicsBlock({ category, variant, steelTypes }: { category: MaterialCategory; variant: MaterialVariant | null; steelTypes: SteelType[] }) {
  const fields = characteristicFields(category, variant, steelTypes)
  if (!variant) return <p className="mt-2 text-sm text-[#6B7280]">Вариант не выбран. Характеристики не заполнены.</p>
  if (!fields.length) return <p className="mt-2 text-sm text-[#6B7280]">У выбранного варианта нет заполненных характеристик.</p>

  return (
    <div className="mt-2 grid gap-2 text-sm md:grid-cols-2 lg:grid-cols-3">
      {fields.map((field) => (
        <div key={field.label}>
          <span className="text-[#6B7280]">{field.label}: </span>
          <span className="font-medium text-[#374151]">{field.value}</span>
        </div>
      ))}
    </div>
  )
}

function characteristicFields(category: MaterialCategory, variant: MaterialVariant | null, steelTypes: SteelType[] = []): CharacteristicField[] {
  if (!variant) return []
  const fields: CharacteristicField[] = []
  const push = (label: string, value: CharacteristicField['value']) => {
    if (value !== null && value !== undefined && value !== '') fields.push({ label, value })
  }

  if (category === 'sheet_metal') {
    push('Тип стали', steelTypeName(variant, steelTypes) ?? variant.material_grade)
    push('Размер', variant.sheet_size)
    push('Толщина, мм', variant.thickness_mm)
  } else if (category === 'circle') {
    push('Диаметр, мм', variant.diameter_mm)
    push('Тип стали', steelTypeName(variant, steelTypes) ?? circleSteelGrade(variant))
    push('Калибровка', variant.is_calibrated ? 'Да' : 'Нет')
  } else if (category === 'pipe') {
    push('Подтип', variant.pipe_type ? PIPE_SUBTYPE_LABELS[variant.pipe_type] ?? variant.pipe_type : null)
    if (variant.pipe_type !== 'wire') {
      push('Тип стали', steelTypeName(variant, steelTypes) ?? variant.material_grade)
      push('Размер', variant.piece_description)
      push('Толщина стенки, мм', variant.wall_thickness_mm)
    }
    if (variant.pipe_type === 'wire') push('Диаметр, мм', variant.diameter_mm)
  } else if (category === 'knives') {
    push('Тип стали', steelTypeName(variant, steelTypes) ?? variant.material_grade ?? variant.knife_material)
    push('Размер (ДxШxВ)', variant.knife_dimensions)
    push('Длина, мм', variant.knife_dimensions ? null : variant.standard_length_mm)
    push('Ширина, мм', variant.knife_dimensions ? null : variant.width_mm)
    push('Высота, мм', variant.knife_dimensions ? null : variant.height_mm)
  } else if (category === 'paint') {
    push('RAL', variant.ral_code)
    push('Покрытие', variant.finish)
  } else if (category === 'components') {
    push('Диаметр, мм', variant.diameter_mm)
    push('Спецификация', variant.specification)
    push('Вес 1 шт, кг', variant.unit_weight_kg)
  } else if (category === 'mesh') {
    push('Характеристика решетки', variant.mesh_description)
    push('Длина, мм', variant.mesh_length_mm)
    push('Ширина, мм', variant.mesh_width_mm)
  } else if (category === 'chain_cord') {
    push('Тип', variant.chain_cord_type ? CHAIN_CORD_SUBTYPE_LABELS[variant.chain_cord_type] ?? variant.chain_cord_type : null)
    push('Параметры', variant.chain_cord_parameters)
  }

  return fields
}

function getUnitsForCategory(category: string): UnitPair {
  return CATEGORY_UNITS[category] ?? { primary: 'шт' }
}

function getUnitsForReceipt(category: MaterialCategory, variant: MaterialVariant | null): UnitPair {
  if (category === 'pipe' && variant?.pipe_type === 'wire') return { primary: WIRE_UNIT }
  return getUnitsForCategory(category)
}

function receiptNeedsPieceLength(category: MaterialCategory, variant: MaterialVariant | null) {
  return (category === 'pipe' && variant?.pipe_type !== 'wire') || category === 'knives'
}

function needsReceiptSteelType(category: MaterialCategory, variant: MaterialVariant | null) {
  const steelTypeId = (variant as (MaterialVariant & { steel_type_id?: string | null }) | null)?.steel_type_id
  return category === 'pipe' && Boolean(variant?.pipe_type) && variant?.pipe_type !== 'wire' && !steelTypeId
}

function needsReceiptUnitWeight(category: MaterialCategory) {
  return category === 'components'
}

function receiptAutoCalculatesPieces(category: MaterialCategory, variant: MaterialVariant | null) {
  return (category === 'pipe' && variant?.pipe_type !== 'wire') || category === 'knives'
}

function receiptQuantityLabel(category: MaterialCategory, variant: MaterialVariant | null) {
  if (category === 'pipe' && variant?.pipe_type !== 'wire') return 'Приход, длина мм'
  if (category === 'knives') return 'Приход, длина мм'
  return `Приход, ${getUnitsForReceipt(category, variant).primary}`
}

function calculatePieceCount(quantity: string, pieceLength: string) {
  const quantityMm = Number(quantity || 0)
  const lengthMm = Number(pieceLength || 0)
  if (!Number.isFinite(quantityMm) || !Number.isFinite(lengthMm) || quantityMm <= 0 || lengthMm <= 0) return null
  return quantityMm / lengthMm
}

function categoryLabel(category?: MaterialCategory | null) {
  if (!category) return '—'
  return MATERIAL_CATEGORY_LABELS[category] ?? category
}

function quantityText(primary: number | null | undefined, unit: string, secondary?: number | null, secondaryUnit?: string | null) {
  const primaryText = `${formatAmount(primary)} ${unit}`
  if (secondary === null || secondary === undefined || !secondaryUnit) return primaryText
  return `${primaryText} / ${formatAmount(secondary)} ${secondaryUnit}`
}

function formatWeight(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${formatAmount(value)} кг`
}

function formatPieceLength(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${formatAmount(value)} мм`
}

function filteredHasPieceLength(rows: InventoryWithMaterial[]) {
  return rows.some((row) => row.piece_length_mm !== null && row.piece_length_mm !== undefined)
}

function steelTypeName(variant: MaterialVariant | null | undefined, steelTypes: SteelType[]) {
  const steelTypeId = (variant as (MaterialVariant & { steel_type_id?: string | null }) | null | undefined)?.steel_type_id
  if (!steelTypeId) return null
  return steelTypes.find((steelType) => steelType.id === steelTypeId)?.name ?? null
}

function normalizeInventorySearch(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[\u0445\u00d7*]/g, 'x')
}

function inventoryMatchesSearch(row: InventoryWithMaterial, value: string) {
  const query = normalizeInventorySearch(value)
  if (!query) return true

  const exactCategory = ACTIVE_MATERIAL_CATEGORIES.find((item) => normalizeInventorySearch(categoryLabel(item)) === query)
  if (exactCategory) return row.material?.category === exactCategory

  return inventorySearchText(row).includes(query)
}

function inventorySearchText(row: InventoryWithMaterial) {
  const values: string[] = [
    row.material?.name,
    row.unit,
    row.secondary_unit,
    row.supplier_name,
    row.variant ? inventoryCharacteristicsSummary(row, []) : null,
    row.variant ? inventoryVariantSearchAliases(row.variant) : null,
  ].filter((value): value is string => Boolean(value))

  return normalizeInventorySearch(values.join(' '))
}

function inventoryVariantSearchAliases(variant: MaterialVariant) {
  const values: string[] = []
  if (variant.category === 'knives') {
    const dimensions = variant.knife_dimensions
      || [variant.standard_length_mm, variant.width_mm, variant.height_mm].filter(Boolean).join('x')
    if (dimensions) values.push(dimensions)
  }
  return values.join(' ')
}

function circleSteelGrade(variant: MaterialVariant | null | undefined) {
  if (!variant) return null
  return variant.material_grade ?? (variant as MaterialVariant & { steel_grade?: string | null }).steel_grade
}

function characteristicCell(row: InventoryWithMaterial, value: string | number | null | undefined) {
  if (value !== null && value !== undefined && value !== '') return value
  return row.variant ? '—' : legacyCharacteristicsText(row)
}

function legacyCharacteristicsText(row: InventoryWithMaterial) {
  if (!row.is_legacy_variant) return '—'
  const count = row.variant_options?.length || 0
  if (count > 1) return `${count} варианта, остаток без привязки`
  if (count === 1) return 'legacy'
  return 'без характеристик'
}

function inventoryCharacteristicsSummary(row: InventoryWithMaterial, steelTypes: SteelType[] = []) {
  const category = row.material?.category
  const variant = row.variant
  if (!category) return '—'
  if (!variant) return legacyCharacteristicsText(row)
  const values = characteristicFields(category, variant, steelTypes).map((field) => String(field.value))
  if ((category === 'pipe' || category === 'knives') && row.piece_length_mm !== null && row.piece_length_mm !== undefined) {
    values.push(`Длина куска: ${formatAmount(row.piece_length_mm)} мм`)
  }
  if (values.length) return values.join(', ')
  return legacyCharacteristicsText(row)
}

function buildReceiptComment(values: { category: MaterialCategory; variant: MaterialVariant | null; comment: string }) {
  const parts: string[] = []
  if (values.category === 'pipe' && values.variant?.pipe_type) parts.push(`Подтип трубы: ${values.variant.pipe_type}`)
  if (values.comment.trim()) parts.push(values.comment.trim())
  return parts.join(' | ')
}

function formatAmount(value: number | null | undefined) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0))
}

function defaultDraftFields(category: MaterialCategory): Record<string, string | boolean> {
  if (category === 'circle') return { diameter_mm: '', steel_type_id: '', is_calibrated: false }
  if (category === 'pipe') return { pipe_type: 'square', steel_type_id: '', size: '', wall_thickness_mm: '', diameter_mm: '' }
  if (category === 'knives') return { steel_type_id: '', standard_length_mm: '', width_mm: '', height_mm: '' }
  if (category === 'paint') return { ral_code: '', finish: '' }
  if (category === 'components') return { diameter_mm: '', specification: '', unit_weight_kg: '' }
  if (category === 'mesh') return { mesh_description: '', mesh_length_mm: '', mesh_width_mm: '' }
  if (category === 'chain_cord') return { chain_cord_type: 'chain', chain_cord_parameters: '' }
  return { steel_type_id: '', sheet_size: '', thickness_mm: '' }
}

function validateDraft(draft: NewMaterialDraft) {
  if (!draft.name.trim()) return 'Введите название материала'
  if (draft.category === 'sheet_metal') {
    if (!String(draft.fields.steel_type_id || '').trim()) return 'Выберите тип стали'
    if (!String(draft.fields.sheet_size || '').trim()) return 'Введите размер листа'
    if (!positiveNumber(draft.fields.thickness_mm)) return 'Введите толщину листа'
  }
  if (draft.category === 'circle') {
    if (!String(draft.fields.steel_type_id || '').trim()) return 'Выберите тип стали'
    if (!positiveNumber(draft.fields.diameter_mm)) return 'Введите диаметр круга'
  }
  if (draft.category === 'pipe') {
    const pipeType = String(draft.fields.pipe_type || '').trim()
    if (!pipeType) return 'Выберите подтип трубы'
    if (pipeType === 'wire') {
      if (!positiveNumber(draft.fields.diameter_mm)) return 'Введите диаметр проволоки'
    } else {
      if (!String(draft.fields.steel_type_id || '').trim()) return 'Выберите тип стали'
      if (!String(draft.fields.size || '').trim()) return 'Введите размер трубы'
      if (!positiveNumber(draft.fields.wall_thickness_mm)) return 'Введите толщину стенки трубы'
    }
  }
  if (draft.category === 'components') {
    if (!positiveNumber(draft.fields.unit_weight_kg)) return 'Введите вес одной позиции'
  }
  return null
}

function draftToCharacteristics(draft: NewMaterialDraft, steelTypes: SteelType[]) {
  const fields = draft.fields
  const steelTypeId = String(fields.steel_type_id || '')
  const steelName = steelTypes.find((steelType) => steelType.id === steelTypeId)?.name ?? null
  if (draft.category === 'sheet_metal') {
    return {
      steel_type_id: steelTypeId || null,
      material_grade: steelName,
      sheet_size: fields.sheet_size,
      thickness_mm: fields.thickness_mm,
    }
  }
  if (draft.category === 'circle') {
    return {
      diameter_mm: fields.diameter_mm,
      steel_type_id: steelTypeId || null,
      steel_grade: steelName,
      is_calibrated: Boolean(fields.is_calibrated),
    }
  }
  if (draft.category === 'pipe') {
    if (fields.pipe_type === 'wire') {
      return {
        pipe_type: fields.pipe_type,
        diameter_mm: fields.diameter_mm,
      }
    }
    return {
      pipe_type: fields.pipe_type,
      steel_type_id: steelTypeId || null,
      material_grade: steelName,
      size: fields.size,
      wall_thickness_mm: fields.wall_thickness_mm,
    }
  }
  if (draft.category === 'knives') {
    return {
      steel_type_id: steelTypeId || null,
      steel_grade: steelName,
      standard_length_mm: fields.standard_length_mm,
      width_mm: fields.width_mm,
      height_mm: fields.height_mm,
    }
  }
  if (draft.category === 'paint') return { ral_code: fields.ral_code, finish: fields.finish }
  if (draft.category === 'components') return { diameter_mm: fields.diameter_mm, specification: fields.specification, default_unit: 'шт', unit_weight_kg: fields.unit_weight_kg }
  if (draft.category === 'mesh') return { mesh_description: fields.mesh_description, mesh_length_mm: fields.mesh_length_mm, mesh_width_mm: fields.mesh_width_mm }
  if (draft.category === 'chain_cord') return { chain_cord_type: fields.chain_cord_type, chain_cord_parameters: fields.chain_cord_parameters }
  return fields
}

function positiveNumber(value: string | boolean | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
}
