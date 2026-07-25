'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Mail, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { getMailAccountStatus, getMailThreads } from '@/lib/actions/mail'
import type { MailThreadListItem } from '@/lib/mail/types'
import { cn } from '@/lib/utils'

export function MailThreadPicker({
  selected,
  onChange,
  compact = false,
}: {
  selected: string[]
  onChange: (ids: string[]) => void
  compact?: boolean
}) {
  const [items, setItems] = useState<MailThreadListItem[]>([])
  const [query, setQuery] = useState('')
  const [connected, setConnected] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      try {
        const status = await getMailAccountStatus()
        if (!active) return
        setConnected(status.connected)
        if (status.connected) {
          const page = await getMailThreads({ folder: 'ALL', query })
          if (active) setItems(page.items.slice(0, compact ? 8 : 20))
        }
      } finally {
        if (active) setLoading(false)
      }
    }, query ? 250 : 0)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [query, compact])

  if (connected === false) {
    return <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Чтобы добавить переписку, сначала подключите Gmail в разделе «Почта».</div>
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Найти письмо по теме или тексту" />
      </div>
      <div className={cn('overflow-y-auto rounded-xl border', compact ? 'max-h-64' : 'max-h-80')}>
        {loading ? <div className="flex justify-center p-6"><Loader2 className="size-5 animate-spin" /></div> : items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Переписка не найдена</div>
        ) : items.map((item) => {
          const checked = selected.includes(item.id)
          return (
            <button key={item.id} type="button" onClick={() => onChange(checked ? selected.filter((id) => id !== item.id) : [...selected, item.id])} className={cn('flex min-h-14 w-full cursor-pointer items-center gap-3 border-b px-3 text-left last:border-b-0 hover:bg-muted/60', checked && 'bg-blue-50')}>
              <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md border', checked && 'border-blue-600 bg-blue-600 text-white')}>{checked ? <Check className="size-4" /> : <Mail className="size-3.5" />}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.subject}</span><span className="block truncate text-xs text-muted-foreground">{item.snippet}</span></span>
            </button>
          )
        })}
      </div>
      {selected.length > 0 && <p className="text-xs font-medium text-blue-700">Выбрано цепочек: {selected.length}</p>}
    </div>
  )
}
