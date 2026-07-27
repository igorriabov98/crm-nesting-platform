'use client'

import { useState } from 'react'
import { Mail, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MailThreadPicker } from '@/components/features/mail/MailThreadPicker'
import { LinkedMailSection } from '@/components/features/mail/LinkedMailSection'
import { linkMailThreadToProductProject } from '@/lib/actions/mail'
import type { CrmMailLink } from '@/lib/mail/types'

export function ProductProjectMail({
  projectId,
  initialLinks,
  canManage,
}: {
  projectId: string
  initialLinks: CrmMailLink[]
  canManage: boolean
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
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[#1B3A6B]"><Mail className="size-5" /> Почтовая переписка</h2>
          <p className="mt-1 text-sm text-muted-foreground">Привязанную почту видят все пользователи с доступом к проекту.</p>
        </div>
        {canManage && <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(true)}><Plus className="size-4" /> Добавить цепочку</Button>}
      </div>
      <div className="mt-4">
        <LinkedMailSection target="product_project" targetId={projectId} links={initialLinks} canUnlink={canManage} />
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Добавить переписку</DialogTitle><DialogDescription>Будет привязана вся Gmail-цепочка, включая новые ответы.</DialogDescription></DialogHeader>
          <MailThreadPicker selected={selected} onChange={setSelected} />
          <DialogFooter><Button variant="outline" className="min-h-11" onClick={() => setOpen(false)}>Отмена</Button><Button className="min-h-11" disabled={saving || selected.length === 0} onClick={() => void linkSelected()}>{saving ? 'Добавляем…' : 'Добавить в проект'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
