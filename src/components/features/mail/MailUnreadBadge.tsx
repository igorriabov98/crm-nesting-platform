'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function MailUnreadBadge() {
  const [count, setCount] = useState(0)
  const refresh = useCallback(async () => {
    const { count } = await (createClient() as any).from('mail_threads')
      .select('id', { count: 'exact', head: true })
      .eq('is_unread', true)
      .contains('label_ids', ['INBOX'])
    setCount(count || 0)
  }, [])

  useEffect(() => {
    void refresh()
    const supabase = createClient()
    const channel = supabase.channel('mail_sidebar_count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mail_threads' }, () => void refresh())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [refresh])

  if (count === 0) return null
  return <span className="ml-auto min-w-5 rounded-full bg-blue-600 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-4 text-white">{count > 99 ? '99+' : count}</span>
}
