'use client'

import { useActionState, useEffect, useRef } from 'react'
import { CalendarDays, CheckCircle2, Send } from 'lucide-react'
import { createDepartmentRequest, type DepartmentRequestActionState } from '@/lib/actions/department-requests'
import { DEPARTMENT_REQUEST_TARGETS, type DepartmentRequestTarget } from '@/lib/department-requests'
import { LoadingButton } from '@/components/ui/loading-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const initialState: DepartmentRequestActionState = { ok: false, message: '' }

export function CreateDepartmentRequestForm({ target }: { target: DepartmentRequestTarget }) {
  const [state, formAction, pending] = useActionState(createDepartmentRequest, initialState)
  const formRef = useRef<HTMLFormElement>(null)
  const config = DEPARTMENT_REQUEST_TARGETS[target]

  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <input type="hidden" name="target" value={target} />

      <div className="space-y-2">
        <Label htmlFor="request-title">Коротко, что нужно сделать</Label>
        <Input
          id="request-title"
          name="title"
          required
          minLength={3}
          maxLength={160}
          placeholder="Например: найти изготовление нестандартной детали"
          className="h-11 bg-white"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="request-description">Описание задачи</Label>
        <Textarea
          id="request-description"
          name="description"
          required
          minLength={3}
          maxLength={5000}
          rows={6}
          placeholder="Опишите результат, который вы ожидаете, и важные условия"
          className="min-h-36 resize-y bg-white"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="request-priority">Приоритет</Label>
          <select
            id="request-priority"
            name="priority"
            defaultValue="normal"
            className="flex h-11 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="low">Низкий</option>
            <option value="normal">Обычный</option>
            <option value="high">Высокий</option>
            <option value="urgent">Срочный</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="request-due-date">Желаемый срок</Label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <Input id="request-due-date" name="dueDate" type="date" className="h-11 bg-white pl-9" />
          </div>
        </div>
      </div>

      {state.message && (
        <div
          role="status"
          aria-live="polite"
          className={state.ok
            ? 'flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800'
            : 'rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800'}
        >
          {state.ok && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {state.message}
        </div>
      )}

      <LoadingButton
        type="submit"
        size="lg"
        loading={pending}
        loadingText="Отправляем…"
        className="h-11 w-full bg-[#1B3A6B] text-white hover:bg-[#152f59]"
      >
        <Send className="h-4 w-4" />
        Отправить {config.recipientLabel}
      </LoadingButton>
    </form>
  )
}
