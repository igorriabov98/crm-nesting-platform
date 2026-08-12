"use client"

import React, { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type InlineEditValue = string | number | null | undefined

interface InlineEditProps<TValue extends InlineEditValue> {
  value: TValue
  onSave: (value: TValue) => Promise<unknown>
  type: 'text' | 'number' | 'date' | 'select'
  options?: { value: string; label: string }[]
  editable: boolean
  debounceMs?: number
  className?: string
  controlClassName?: string
  placeholder?: string
  fallbackText?: string
  dateDisplayFormat?: string
  compact?: boolean
}

function parseDateOnly(value: string | number | null | undefined) {
  if (typeof value !== 'string' || !value) return undefined
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function formatDateOnly(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function InlineEdit<TValue extends InlineEditValue>({
  value,
  onSave,
  type,
  options = [],
  editable,
  debounceMs = 600,
  className,
  controlClassName,
  placeholder = '',
  dateDisplayFormat = 'dd.MM.yyyy',
  fallbackText = '—',
  compact = false,
}: InlineEditProps<TValue>) {
  const [localValue, setLocalValue] = useState<TValue>(value)
  const [isSaving, setIsSaving] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const triggerSave = async (newValue: TValue) => {
    setIsSaving(true)
    try {
      const result = await onSave(newValue)
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        const message = 'error' in result && typeof result.error === 'string'
          ? result.error
          : 'Сохранение отменено'
        throw new Error(message)
      }
      toast.success('Сохранено')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Ошибка сохранения')
      setLocalValue(value)
    } finally {
      setIsSaving(false)
    }
  }

  const handleChange = (newValue: TValue) => {
    setLocalValue(newValue)

    if (timerRef.current) clearTimeout(timerRef.current)

    if (type === 'select' || type === 'date') {
      triggerSave(newValue)
      return
    }

    timerRef.current = setTimeout(() => {
      if (newValue !== value) triggerSave(newValue)
    }, debounceMs)
  }

  if (!editable) {
    let displayValue: React.ReactNode = value
    if (value === null || value === undefined || value === '') {
      displayValue = fallbackText
    } else if (type === 'date' && value) {
      const parsed = parseDateOnly(value)
      displayValue = parsed ? format(parsed, dateDisplayFormat, { locale: ru }) : fallbackText
    } else if (type === 'select') {
      const opt = options.find((option) => option.value === String(value))
      displayValue = opt ? opt.label : value
    }

    return <span className={cn('text-sm', className)}>{displayValue}</span>
  }

  return (
    <div className={cn('relative flex w-full max-w-sm items-center', className)}>
      {type === 'text' && (
        <Input
          type="text"
          value={localValue || ''}
          placeholder={placeholder}
          onChange={(event) => handleChange(event.target.value as TValue)}
          className={cn('bg-white border-[#E8ECF0] text-[#1B3A6B]', compact ? 'h-7 text-xs' : 'h-8', controlClassName)}
        />
      )}

      {type === 'number' && (
        <Input
          type="number"
          value={localValue !== null && localValue !== undefined ? localValue : ''}
          placeholder={placeholder}
          onChange={(event) => handleChange((event.target.value ? parseFloat(event.target.value) : null) as TValue)}
          className={cn('bg-white border-[#E8ECF0] text-[#1B3A6B]', compact ? 'h-7 text-xs' : 'h-8', controlClassName)}
        />
      )}

      {type === 'select' && (
        <Select
          value={localValue === null || localValue === undefined ? '' : String(localValue)}
          onValueChange={(selectedValue) => handleChange(selectedValue as TValue)}
        >
          <SelectTrigger className={cn('w-full bg-white border-[#E8ECF0] text-[#1B3A6B]', compact ? 'h-7 text-xs' : 'h-8', controlClassName)}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent className={cn('bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]', compact && 'text-xs')}>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {type === 'date' && (
        <DatePicker
          value={parseDateOnly(localValue)}
          onChange={(date) => handleChange((date ? formatDateOnly(date) : null) as TValue)}
          placeholder={placeholder}
          className={cn(compact ? 'h-7 text-xs' : 'h-8', controlClassName)}
          displayFormat={dateDisplayFormat}
          popoverClassName={compact ? 'origin-top-left scale-90 text-xs' : undefined}
        />
      )}

      {isSaving && (
        <div className="absolute -right-6">
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        </div>
      )}
    </div>
  )
}
