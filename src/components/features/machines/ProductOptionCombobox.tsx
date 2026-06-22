'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import type { ProductOption } from '@/lib/actions/products'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

type ProductOptionComboboxProps = {
  products: ProductOption[]
  value?: string | null
  disabled?: boolean
  placeholder?: string
  onChange: (productId: string) => void
}

function productLabel(product: ProductOption) {
  return `${product.name_uk} · ${product.uktzed} · ${product.drawing_number}`
}

function normalizedProductSearch(product: ProductOption) {
  return [
    product.name_uk,
    product.name_en,
    product.uktzed,
    product.drawing_number,
    product.characteristics,
  ]
    .join(' ')
    .toLowerCase()
}

export function ProductOptionCombobox({
  products,
  value,
  disabled,
  placeholder = 'Выберите активный продукт',
  onChange,
}: ProductOptionComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selectedProduct = products.find((product) => product.id === value)
  const normalizedSearch = search.trim().toLowerCase()

  const filteredProducts = useMemo(() => {
    if (!normalizedSearch) return products
    return products.filter((product) => normalizedProductSearch(product).includes(normalizedSearch))
  }, [normalizedSearch, products])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setSearch('')
  }

  function handleSelect(productId: string) {
    onChange(productId)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={disabled}
            aria-label="Выбрать товар из базы продукции"
            className={cn(
              'h-9 w-full justify-between bg-white px-3 text-left font-normal text-[#1B3A6B] hover:bg-[#F8F9FA]',
              !selectedProduct && 'text-[#9CA3AF]',
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {selectedProduct ? productLabel(selectedProduct) : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 max-w-[calc(100vw-2rem)] p-0 bg-white border-[#E8ECF0] shadow-lg">
        <Command shouldFilter={false} className="rounded-lg bg-white">
          <CommandInput autoFocus value={search} onValueChange={setSearch} placeholder="Поиск товара, чертежа или УКТЗЕД" />
          <CommandList>
            <CommandEmpty>Товар не найден</CommandEmpty>
            <CommandGroup>
              {filteredProducts.map((product) => (
                <CommandItem
                  key={product.id}
                  value={product.id}
                  onSelect={() => handleSelect(product.id)}
                  className="items-start py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[#1B3A6B]">{product.name_uk}</p>
                    <p className="mt-0.5 truncate text-xs text-[#6B7280]">
                      {product.uktzed} · {product.drawing_number}
                    </p>
                  </div>
                  <Check className={cn('ml-auto h-4 w-4 shrink-0 text-[#2563EB]', value === product.id ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
