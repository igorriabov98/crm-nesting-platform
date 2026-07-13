'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'

type InlineNumberEditProps = {
  value: number | null
  displayValue: string
  allowNull?: boolean
  integer?: boolean
  min?: number
  inputClassName?: string
  disabled?: boolean
  onSave: (value: number | null) => Promise<void>
}

function toDraft(value: number | null) {
  return value === null ? '' : String(value)
}

function sameValue(a: number | null, b: number | null) {
  return a === b || (a !== null && b !== null && Number(a) === Number(b))
}

export function InlineNumberEdit({
  value,
  displayValue,
  allowNull = false,
  integer = false,
  min = 0,
  inputClassName = 'w-24',
  disabled = false,
  onSave,
}: InlineNumberEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(toDraft(value))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(toDraft(value))
  }, [editing, value])

  async function commit() {
    const trimmed = draft.trim()
    let nextValue: number | null

    if (!trimmed) {
      if (!allowNull) {
        toast.error('Введите число')
        setDraft(toDraft(value))
        setEditing(false)
        return
      }
      nextValue = null
    } else {
      const parsed = Number(trimmed)
      if (!Number.isFinite(parsed) || parsed < min || (integer && !Number.isInteger(parsed))) {
        toast.error(integer ? 'Введите целое число не меньше 0' : 'Введите число не меньше 0')
        setDraft(toDraft(value))
        setEditing(false)
        return
      }
      nextValue = parsed
    }

    if (sameValue(value, nextValue)) {
      setEditing(false)
      return
    }

    setSaving(true)
    try {
      await onSave(nextValue)
      setEditing(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить значение')
      setDraft(toDraft(value))
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!editing || disabled) {
    return (
      <button
        type="button"
        className="rounded px-1 text-left enabled:cursor-pointer enabled:hover:bg-[#F4F6F9] enabled:hover:underline disabled:cursor-default"
        disabled={disabled}
        onClick={() => setEditing(true)}
      >
        {displayValue}
      </button>
    )
  }

  return (
    <Input
      type="number"
      min={min}
      step={integer ? 1 : 'any'}
      value={draft}
      disabled={disabled || saving}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(toDraft(value))
          setEditing(false)
        }
      }}
      autoFocus
      className={inputClassName}
    />
  )
}
