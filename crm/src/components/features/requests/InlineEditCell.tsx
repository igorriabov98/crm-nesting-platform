'use client'

import { useEffect, useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type InlineEditCellProps = {
  value: string | number | null | undefined
  onSave: (value: string | number | null) => Promise<void>
  disabled?: boolean
  type?: 'text' | 'number'
  step?: string
  className?: string
  placeholder?: string
  display?: string
  suggestions?: Array<string | number>
}

export function InlineEditCell({
  value,
  onSave,
  disabled = false,
  type = 'text',
  step,
  className,
  placeholder = '—',
  display,
  suggestions,
}: InlineEditCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const id = useId()
  const datalistId = suggestions?.length ? `inline-edit-${id}` : undefined

  useEffect(() => {
    setDraft(value ?? '')
  }, [value])

  const commit = async () => {
    if (disabled || saving) return
    const nextValue = draft === '' ? null : type === 'number' ? Number(draft) : String(draft)
    if (nextValue === value || (nextValue === null && (value === null || value === undefined))) {
      setEditing(false)
      return
    }

    setSaving(true)
    try {
      await onSave(nextValue)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing && !disabled) {
    return (
      <>
        <Input
          autoFocus
          type={type}
          step={step}
          list={datalistId}
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void commit()
            if (event.key === 'Escape') {
              setDraft(value ?? '')
              setEditing(false)
            }
          }}
          className={cn('h-9 min-w-[112px] bg-white text-sm', className)}
        />
        {datalistId && (
          <datalist id={datalistId}>
            {suggestions?.map((suggestion) => <option key={String(suggestion)} value={String(suggestion)} />)}
          </datalist>
        )}
      </>
    )
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && setEditing(true)}
      className={cn(
        'block min-h-9 w-full min-w-[112px] max-w-[260px] truncate rounded-md px-2 py-2 text-left text-sm leading-5 hover:bg-slate-50',
        disabled && 'cursor-not-allowed text-slate-500 hover:bg-transparent',
        className
      )}
    >
      {display ?? (value !== null && value !== undefined && value !== '' ? String(value) : placeholder)}
    </button>
  )
}
