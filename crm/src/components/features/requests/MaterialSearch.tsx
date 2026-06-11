'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, PackageSearch, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createMaterial, getMaterialVariants, searchMaterials, type MaterialVariantWithSteelType, type MaterialWithSupplier } from '@/lib/actions/materials'
import { CHAIN_CORD_SUBTYPE_LABELS, MATERIAL_CATEGORY_LABELS, PIPE_SUBTYPE_LABELS, defaultMaterialNameForCategory } from '@/lib/constants/procurement'
import { cn } from '@/lib/utils'
import type { Material, MaterialCategory, MaterialVariant } from '@/lib/types'

export type MaterialSelectionSource = 'existing_material' | 'existing_variant' | 'new_material'

type MaterialSearchProps = {
  category?: MaterialCategory | null
  onSelect: (material: MaterialWithSupplier, variant: MaterialVariant | undefined, source: MaterialSelectionSource) => void
  onCreateRequest?: (name: string, category: MaterialCategory) => void
  placeholder?: string
  value?: string | null
  initialValue?: string | null
  selectedMaterialId?: string | null
  disabled?: boolean
  compact?: boolean
  className?: string
  allowCrossCategoryFallback?: boolean
}

const MATERIAL_SEARCH_OPEN_EVENT = 'crm:material-search-open'

export function MaterialSearch({
  category,
  onSelect,
  onCreateRequest,
  placeholder = 'Поиск материала...',
  value,
  initialValue,
  selectedMaterialId,
  disabled = false,
  compact = false,
  className,
  allowCrossCategoryFallback = false,
}: MaterialSearchProps) {
  const [query, setQuery] = useState(value || initialValue || '')
  const [materials, setMaterials] = useState<MaterialWithSupplier[]>([])
  const [variants, setVariants] = useState<Record<string, MaterialVariantWithSteelType[]>>({})
  const [open, setOpen] = useState(false)
  const [localSelection, setLocalSelection] = useState<{ id: string; name: string } | null>(null)
  const [dropdownRect, setDropdownRect] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)
  const [isPending, startTransition] = useTransition()
  const cache = useRef(new Map<string, MaterialWithSupplier[]>())
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const queryRef = useRef(query)
  const suppressedQueryRef = useRef<string | null>(null)
  const instanceId = useId()
  const portalTarget = typeof document === 'undefined' ? null : document.body

  const openDropdown = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(MATERIAL_SEARCH_OPEN_EVENT, { detail: instanceId }))
    }
    setOpen(true)
  }, [instanceId])

  useEffect(() => {
    queryRef.current = query
  }, [query])

  useEffect(() => {
    const closeOtherDropdown = (event: Event) => {
      const openEvent = event as CustomEvent<string | null>
      if (openEvent.detail !== instanceId) setOpen(false)
    }

    window.addEventListener(MATERIAL_SEARCH_OPEN_EVENT, closeOtherDropdown)
    return () => window.removeEventListener(MATERIAL_SEARCH_OPEN_EVENT, closeOtherDropdown)
  }, [instanceId])

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(value || initialValue || ''), 0)
    return () => window.clearTimeout(timer)
  }, [initialValue, value])

  useEffect(() => {
    if (!open) return

    const updateDropdownRect = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const viewportMargin = 12
      const dropdownGap = 8
      const preferredHeight = compact ? 240 : 320
      const minUsefulBelow = 160
      const spaceBelow = window.innerHeight - rect.bottom - viewportMargin - dropdownGap
      const spaceAbove = rect.top - viewportMargin - dropdownGap
      const opensUp = spaceBelow < minUsefulBelow && spaceAbove > spaceBelow
      const maxHeight = Math.max(
        120,
        Math.min(preferredHeight, opensUp ? spaceAbove : spaceBelow),
      )
      setDropdownRect({
        left: rect.left,
        top: opensUp
          ? Math.max(viewportMargin, rect.top - maxHeight - dropdownGap)
          : Math.min(rect.bottom + dropdownGap, window.innerHeight - viewportMargin - maxHeight),
        width: Math.max(rect.width, compact ? 360 : 420),
        maxHeight,
      })
    }

    updateDropdownRect()
    window.addEventListener('resize', updateDropdownRect)
    window.addEventListener('scroll', updateDropdownRect, true)
    return () => {
      window.removeEventListener('resize', updateDropdownRect)
      window.removeEventListener('scroll', updateDropdownRect, true)
    }
  }, [compact, open])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  useEffect(() => {
    const normalized = normalizeMaterialName(query)
    if (disabled || normalized.length < 2) return
    if (suppressedQueryRef.current === normalized) {
      const timer = window.setTimeout(() => setOpen(false), 0)
      return () => window.clearTimeout(timer)
    }

    const key = `${category ?? 'all'}:${normalized}`
    const timer = window.setTimeout(() => {
      if (normalizeMaterialName(queryRef.current) !== normalized) return
      if (suppressedQueryRef.current === normalized) return
      if (cache.current.has(key)) {
        setMaterials(cache.current.get(key) || [])
        openDropdown()
        return
      }

      startTransition(async () => {
        let result = await searchMaterials(normalized, category)
        if (allowCrossCategoryFallback && category && !result.data?.length) {
          result = await searchMaterials(normalized, null)
        }
        if (normalizeMaterialName(queryRef.current) !== normalized) return
        if (suppressedQueryRef.current === normalized) return
        if (result.data) {
          cache.current.set(key, result.data)
          setMaterials(result.data)
          openDropdown()
        }
      })
    }, 300)

    return () => window.clearTimeout(timer)
  }, [allowCrossCategoryFallback, category, disabled, localSelection?.name, openDropdown, query, selectedMaterialId, value])

  useEffect(() => {
    const load = async () => {
      const missing = materials.filter((material) => !variants[material.id])
      if (!missing.length) return

      const loaded = await Promise.all(missing.map(async (material) => {
        const result = await getMaterialVariants(material.id, material.category)
        return [material.id, result.data || []] as const
      }))
      setVariants((current) => ({ ...current, ...Object.fromEntries(loaded) }))
    }

    void load()
  }, [category, materials, variants])

  const normalizedQuery = normalizeMaterialName(query)
  const selectedMatchesQuery = Boolean(
    (selectedMaterialId || localSelection?.id) &&
      normalizedQuery &&
      normalizeMaterialName(selectedMaterialId ? value || '' : localSelection?.name || '') === normalizedQuery,
  )
  const visibleMaterials = useMemo(
    () => materials
      .filter((material) => !category || allowCrossCategoryFallback || material.category === category),
    [allowCrossCategoryFallback, category, materials],
  )
  const createName = category ? defaultMaterialNameForCategory(category) ?? query.trim() : query.trim()
  const canCreate = useMemo(() => Boolean(category) && normalizedQuery.length >= 2 && !disabled, [category, disabled, normalizedQuery])
  const shouldShowDropdown = open && (!selectedMatchesQuery || visibleMaterials.length > 0 || canCreate)

  const selectMaterial = (material: MaterialWithSupplier, variant: MaterialVariant | undefined, source: MaterialSelectionSource) => {
    setLocalSelection({ id: material.id, name: material.name })
    setQuery(material.name)
    suppressedQueryRef.current = normalizeMaterialName(material.name)
    setMaterials([])
    setOpen(false)
    onSelect(material, variant, source)
  }

  const createNew = () => {
    const name = createName
    if (!name || disabled || !category) return

    if (onCreateRequest) {
      suppressedQueryRef.current = normalizeMaterialName(name)
      setMaterials([])
      setOpen(false)
      onCreateRequest(name, category)
      return
    }

    startTransition(async () => {
      const result = await createMaterial({ name, category })
      if (result.success && result.data) {
        const material = { ...(result.data as Material), supplier_name: null } satisfies MaterialWithSupplier
        selectMaterial(material, undefined, 'new_material')
      }
    })
  }

  return (
    <div ref={rootRef} className={cn('relative min-w-[220px]', className)}>
      <div className="relative">
        <PackageSearch className={cn('pointer-events-none absolute left-2 h-4 w-4 text-slate-400', compact ? 'top-2' : 'top-2.5')} />
        <Input
          value={query}
          disabled={disabled}
          onChange={(event) => {
            const nextValue = event.target.value
            setLocalSelection(null)
            suppressedQueryRef.current = null
            setQuery(nextValue)
            if (nextValue.trim().length < 2) {
              setMaterials([])
              setOpen(false)
              return
            }
            openDropdown()
          }}
          onFocus={() => {
            suppressedQueryRef.current = null
            if (query.trim().length >= 2 && !disabled) {
              openDropdown()
            } else {
              setOpen(false)
            }
          }}
          placeholder={placeholder}
          className={cn('bg-white pl-8 text-sm', compact ? 'h-8' : 'h-9')}
        />
        {isPending && <Loader2 className={cn('absolute right-2 h-4 w-4 animate-spin text-slate-400', compact ? 'top-2' : 'top-2.5')} />}
      </div>

      {portalTarget && shouldShowDropdown && !disabled && query.trim().length >= 2 && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] max-h-[320px] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-2xl"
          style={{
            left: dropdownRect?.left ?? 0,
            top: dropdownRect?.top ?? 0,
            width: dropdownRect?.width ?? (compact ? 360 : 420),
            maxHeight: dropdownRect?.maxHeight ?? (compact ? 240 : 320),
          }}
        >
          {visibleMaterials.map((material) => {
            const materialVariants = variants[material.id]
            const hasVariants = Boolean(materialVariants?.length)
            const header = (
              <>
                <div className="font-medium text-slate-900">{material.name}</div>
                {!category && (
                  <div className="mt-0.5 text-xs text-slate-500">
                    <span className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                      {MATERIAL_CATEGORY_LABELS[material.category] ?? material.category}
                    </span>
                  </div>
                )}
              </>
            )

            return (
              <div key={material.id} className="rounded-md border border-slate-100 p-2">
                {hasVariants ? (
                  <div className="px-1 py-1 text-left">{header}</div>
                ) : (
                  <button type="button" className="block w-full rounded px-1 py-1 text-left hover:bg-slate-50" onClick={() => selectMaterial(material, undefined, 'existing_material')}>
                    {header}
                  </button>
                )}

                {materialVariants === undefined && (
                  <div className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-500">Загружаю варианты...</div>
                )}

                {materialVariants !== undefined && !hasVariants && (
                  <div className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-500">Вариантов с характеристиками нет</div>
                )}

                {(materialVariants || []).slice(0, 8).map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    className="mt-2 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 hover:border-blue-300 hover:bg-blue-50"
                    onClick={() => selectMaterial(material, variant, 'existing_variant')}
                  >
                    <span className="font-medium">{variantLabel(variant)}</span>
                    <span className="ml-2 text-xs text-slate-400">заказывали {variant.times_used} раз</span>
                  </button>
                ))}
              </div>
            )
          })}

          {visibleMaterials.length === 0 && <div className="px-2 py-3 text-sm text-slate-500">Материалы не найдены</div>}
          {canCreate && category && (
            <Button type="button" variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={createNew}>
              <Plus className="mr-2 h-4 w-4" />
              Добавить материал «{createName}»
            </Button>
          )}
        </div>,
        portalTarget,
      )}
    </div>
  )
}

function steelLabel(variant: MaterialVariantWithSteelType) {
  return variant.steel_types?.name || variant.material_grade
}

function variantLabel(variant: MaterialVariantWithSteelType) {
  if (String(variant.category) === 'sheet_metal') {
    return [steelLabel(variant), variant.thickness_mm && `${variant.thickness_mm} мм`, variant.sheet_size].filter(Boolean).join(' • ') || 'вариант'
  }
  if (String(variant.category) === 'circle') {
    return [variant.diameter_mm && `Ø${variant.diameter_mm}`, steelLabel(variant), variant.is_calibrated ? 'калибр.' : null].filter(Boolean).join(' • ') || 'вариант'
  }
  if (String(variant.category) === 'pipe') {
    const subtype = variant.pipe_type && PIPE_SUBTYPE_LABELS[variant.pipe_type]
    if (variant.pipe_type === 'wire') return [subtype, variant.diameter_mm && `Ø${variant.diameter_mm}`].filter(Boolean).join(' • ') || 'вариант'
    return [subtype, steelLabel(variant), variant.piece_description, variant.wall_thickness_mm && `${variant.wall_thickness_mm} мм`].filter(Boolean).join(' • ') || 'вариант'
  }
  if (String(variant.category) === 'knives') {
    const dimensions = variant.knife_dimensions
      || [variant.standard_length_mm, variant.width_mm, variant.height_mm].filter(Boolean).join('x')
    return [dimensions, variant.knife_material ?? steelLabel(variant)].filter(Boolean).join(' • ') || 'вариант'
  }
  if (variant.category === 'sheet_metal') return [variant.material_grade, variant.thickness_mm && `${variant.thickness_mm} мм`, variant.sheet_size].filter(Boolean).join(' • ') || 'вариант'
  if (variant.category === 'round_tube') return [variant.length_m && `${variant.length_m} м`, variant.piece_description].filter(Boolean).join(' • ') || 'вариант'
  if (variant.category === 'circle') return [variant.diameter_mm && `Ø${variant.diameter_mm}`, variant.material_grade, variant.is_calibrated ? 'калибр.' : null].filter(Boolean).join(' • ') || 'вариант'
  if (variant.category === 'pipe') {
    const subtype = variant.pipe_type && PIPE_SUBTYPE_LABELS[variant.pipe_type]
    if (variant.pipe_type === 'wire') return [subtype, variant.diameter_mm && `Ø${variant.diameter_mm}`].filter(Boolean).join(' • ') || 'вариант'
    return [subtype, variant.piece_description, variant.wall_thickness_mm && `${variant.wall_thickness_mm} мм`].filter(Boolean).join(' • ') || 'вариант'
  }
  if (variant.category === 'knives') {
    const dimensions = variant.knife_dimensions
      || [variant.standard_length_mm, variant.width_mm, variant.height_mm].filter(Boolean).join('x')
    return [dimensions, variant.knife_material ?? variant.material_grade].filter(Boolean).join(' • ') || 'вариант'
  }
  if (variant.category === 'components') {
    return [variant.diameter_mm && `Ø${variant.diameter_mm}`, variant.specification, variant.default_unit].filter(Boolean).join(' • ') || 'вариант'
  }
  if (variant.category === 'paint') return [variant.ral_code, variant.finish].filter(Boolean).join(' • ') || 'вариант'
  if (variant.category === 'mesh') return [variant.mesh_description, variant.mesh_length_mm && `${variant.mesh_length_mm} мм`, variant.mesh_width_mm && `${variant.mesh_width_mm} мм`].filter(Boolean).join(' • ') || 'вариант'
  if (variant.category === 'chain_cord') return [variant.chain_cord_type && CHAIN_CORD_SUBTYPE_LABELS[variant.chain_cord_type], variant.chain_cord_parameters].filter(Boolean).join(' • ') || 'вариант'
  return 'вариант'
}

function normalizeMaterialName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[\u0445\u00d7*]/g, 'x')
}
