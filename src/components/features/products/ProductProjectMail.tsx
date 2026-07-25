'use client'

import { useState } from 'react'
import { Link2, Mail, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MailThreadPicker } from '@/components/features/mail/MailThreadPicker'
import { linkMailThreadToProductProject, unlinkMailThreadFromProductProject } from '@/lib/actions/mail'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

type ProjectMailLink = {
  id: string
  linked_at: string
  thread: {
    id: string
    gmail_thread_id: string
    subject: string
    snippet: string
    last_message_at: string
    message_count: number
    has_attachments: boolean
  } | null
}

export function ProductProjectMail({
  projectId,
  initialLinks,
}: {
  projectId: string
  initialLinks: ProjectMailLink[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  async function linkSelected() {
    setSaving(true)
    const results = await Promise.all(selected.map((threadId) => linkMailThreadToProductProject(threadId, projectId)))
    setSaving(false)
    const failed = results.find((result) => !result.success)
    if (failed) return toast.error(failed.error)
    toast.success('Переписка добавлена в проект')
    setSelected([])
    setOpen(false)
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-lg font-semibold text-[#1B3A6B]"><Mail className="size-5" /> Почтовая переписка</h2><p className="mt-1 text-sm text-muted-foreground">Привязанные цепочки видят все пользователи с доступом к проекту.</p></div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}><Plus className="size-4" /> Добавить письмо</Button>
      </div>
      <div className="mt-4 space-y-2">
        {initialLinks.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Переписка пока не привязана.</div> : initialLinks.map((link) => link.thread && (
          <div key={link.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Link2 className="size-5" /></span>
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{link.thread.subject}</p><p className="truncate text-sm text-muted-foreground">{link.thread.snippet}</p><p className="mt-1 text-xs text-muted-foreground">{link.thread.message_count} сообщений {link.thread.has_attachments ? '· есть вложения' : ''}</p></div>
            <a href={`/mail?thread=${encodeURIComponent(link.thread.id)}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}><Mail className="size-4" /> Открыть</a>
            <Button type="button" variant="ghost" size="icon" aria-label="Удалить связь" onClick={async () => {
              const result = await unlinkMailThreadFromProductProject(link.id, projectId)
              if (!result.success) toast.error(result.error)
              else { toast.success('Связь удалена'); router.refresh() }
            }}><Trash2 className="size-4 text-red-600" /></Button>
          </div>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Добавить переписку</DialogTitle><DialogDescription>Будет привязана вся Gmail-цепочка, включая новые ответы.</DialogDescription></DialogHeader>
          <MailThreadPicker selected={selected} onChange={setSelected} />
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button><Button disabled={saving || selected.length === 0} onClick={() => void linkSelected()}>{saving ? 'Добавляем…' : 'Добавить в проект'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
