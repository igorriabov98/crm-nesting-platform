'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
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
import { cn } from '@/lib/utils'

export const industrial = {
  shell: 'space-y-5 [font-family:var(--font-industrial-sans),var(--font-sans)] text-slate-950',
  hero:
    'relative overflow-hidden rounded-2xl border border-slate-800/70 bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_55%,#334155_100%)] p-5 text-white shadow-[0_18px_55px_rgba(15,23,42,0.22)]',
  heroGlow: 'pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-amber-400/20 blur-3xl',
  eyebrow: 'text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-amber-300',
  title: 'mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl',
  description: 'mt-2 max-w-3xl text-sm leading-6 text-slate-300',
  panel: 'rounded-2xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.07)]',
  panelMuted: 'rounded-2xl border border-slate-200 bg-slate-50/80 shadow-[0_10px_26px_rgba(15,23,42,0.05)]',
  selectTrigger:
    'h-10 min-w-48 justify-between border-slate-300 bg-white text-slate-900 shadow-sm hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-amber-500/30',
  input:
    'h-10 border-slate-300 bg-white text-slate-950 placeholder:text-slate-400 focus-visible:ring-amber-500/30',
  label: 'text-xs font-semibold uppercase tracking-[0.12em] text-slate-500',
  tableHead: 'bg-slate-950 text-xs uppercase tracking-[0.12em] text-slate-200',
  mono: '[font-family:var(--font-industrial-mono),var(--font-geist-mono),monospace]',
  action:
    'border-slate-300 bg-white text-slate-800 hover:border-amber-300 hover:bg-amber-50 hover:text-slate-950',
  primary:
    'border-amber-500 bg-amber-500 text-slate-950 hover:bg-amber-400 focus-visible:ring-amber-500/40',
  danger:
    'border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100',
}

export type IndustrialPickerOption = {
  value: string
  label: string
  description?: string
  badge?: string
  search?: string
}

export function resolveLabel(
  options: IndustrialPickerOption[],
  value: string | null | undefined,
  fallback = 'Не выбрано',
) {
  if (!value) return fallback
  return options.find((option) => option.value === value)?.label || fallback
}

export function IndustrialSelectText({
  children,
  muted = false,
}: {
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <span className={cn('min-w-0 flex-1 truncate text-left text-sm', muted ? 'text-slate-400' : 'text-slate-900')}>
      {children}
    </span>
  )
}

export function IndustrialMetricCard({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  tone?: 'default' | 'warning' | 'success' | 'critical'
}) {
  const toneClass = {
    default: 'border-slate-200 bg-white text-slate-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    critical: 'border-red-200 bg-red-50 text-red-700',
  }[tone]
  const iconClass = {
    default: 'bg-slate-950 text-amber-300',
    warning: 'bg-amber-500 text-slate-950',
    success: 'bg-emerald-600 text-white',
    critical: 'bg-red-600 text-white',
  }[tone]

  return (
    <div className={cn('rounded-2xl border p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]', toneClass)}>
      <div className="flex items-center gap-3">
        <div className={cn('flex size-10 items-center justify-center rounded-xl shadow-sm', iconClass)}>{icon}</div>
        <div className="min-w-0">
          <div className={cn('text-2xl font-semibold tabular-nums', industrial.mono)}>{value}</div>
          <div className="mt-0.5 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</div>
        </div>
      </div>
    </div>
  )
}

export function IndustrialStatusBadge({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'warning' | 'success' | 'critical' | 'info' | 'premium'
}) {
  const toneClass = {
    default: 'border-slate-200 bg-slate-100 text-slate-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    critical: 'border-red-200 bg-red-50 text-red-700',
    info: 'border-blue-200 bg-blue-50 text-blue-700',
    premium: 'border-amber-300 bg-slate-950 text-amber-300',
  }[tone]

  return (
    <span className={cn('inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold', toneClass)}>
      {children}
    </span>
  )
}

export function IndustrialSearchPicker({
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  onValueChange,
}: {
  value: string
  options: IndustrialPickerOption[]
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  disabled?: boolean
  onValueChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selected = options.find((option) => option.value === value)
  const query = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!query) return options
    return options.filter((option) => {
      const haystack = [option.label, option.description, option.badge, option.search].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [options, query])

  function closePicker() {
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen)
      if (!nextOpen) setSearch('')
    }}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={placeholder}
            className={cn('h-10 w-full justify-between px-3', industrial.selectTrigger)}
          >
            <span className={cn('min-w-0 flex-1 truncate text-left', !selected && 'text-slate-400')}>
              {selected ? selected.label : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 size-4 text-slate-400" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-(--anchor-width) min-w-80 max-w-[calc(100vw-2rem)] border-slate-200 bg-white p-0 shadow-2xl">
        <Command shouldFilter={false} className="rounded-xl bg-white">
          <CommandInput value={search} onValueChange={setSearch} placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filtered.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    onValueChange(option.value)
                    closePicker()
                  }}
                  className="items-start gap-3 rounded-lg py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-950">{option.label}</div>
                    {(option.description || option.badge) && (
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {[option.description, option.badge].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <Check className={cn('mt-0.5 size-4 shrink-0 text-amber-600', value === option.value ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
