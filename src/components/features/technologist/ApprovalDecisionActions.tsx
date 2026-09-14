'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  approveTechnologistRequest,
  beginTechnologistRequestRevision,
  returnTechnologistRequest,
} from '@/lib/actions/technologist-request-approvals'

export function ApprovalDecisionActions({
  requestId,
  versionId,
  canEdit,
  canReview,
  pending,
}: {
  requestId: string
  versionId: string | null
  canEdit: boolean
  canReview: boolean
  pending: boolean
}) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [returnOpen, setReturnOpen] = useState(false)
  const [reason, setReason] = useState('')

  function edit() {
    startTransition(async () => {
      const result = await beginTechnologistRequestRevision(requestId)
      if (!result.success) { toast.error(result.error || 'Не удалось открыть редактирование'); return }
      toast.success('Текущая версия сохранена в истории')
      router.push(result.href!)
    })
  }

  function approve() {
    if (!versionId) return
    startTransition(async () => {
      const result = await approveTechnologistRequest(versionId)
      if (!result.success) { toast.error(result.error || 'Не удалось одобрить заявку'); return }
      toast.success('Заявка одобрена и передана снабжению')
      router.refresh()
    })
  }

  function returnForRevision() {
    if (!versionId) return
    startTransition(async () => {
      const result = await returnTechnologistRequest({ versionId, reason })
      if (!result.success) { toast.error(result.error || 'Не удалось вернуть заявку'); return }
      toast.success('Заявка возвращена технологу')
      setReturnOpen(false)
      setReason('')
      router.refresh()
    })
  }

  if (!canEdit && !(canReview && pending)) return null
  return <>
    <div className="flex flex-col gap-3 sm:flex-row" aria-label="Действия с заявкой">
      {canEdit && <Button variant="outline" className="min-h-11" disabled={busy} onClick={edit}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}
        Редактировать заявку
      </Button>}
      {canReview && pending && <>
        <Button className="min-h-11" disabled={busy} onClick={approve}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Одобрить заявку
        </Button>
        <Button variant="destructive" className="min-h-11" disabled={busy} onClick={() => setReturnOpen(true)}>
          <RotateCcw className="mr-2 h-4 w-4" />Вернуть на доработку
        </Button>
      </>}
    </div>
    <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Вернуть заявку на доработку?</DialogTitle>
          <DialogDescription>Причина будет сохранена в истории версии и отправлена автору заявки.</DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Опишите, что нужно исправить"
          aria-label="Причина возврата"
          rows={5}
        />
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setReturnOpen(false)}>Отмена</Button>
          <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={returnForRevision}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Вернуть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
