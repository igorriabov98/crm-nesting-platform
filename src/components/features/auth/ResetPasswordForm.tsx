'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Factory, Loader2 } from 'lucide-react'
import { createRecoveryClient, openPasswordRecovery, type PasswordRecovery } from '@/lib/auth/password-recovery'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export function ResetPasswordForm({ initialError }: { initialError?: string }) {
  const [recovery, setRecovery] = useState<PasswordRecovery | null>(null)
  const initialization = useRef<Promise<PasswordRecovery> | null>(null)
  const [completed, setCompleted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [fatalError, setFatalError] = useState(initialError || '')
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (initialError) return
    let active = true
    if (!initialization.current) {
      const hash = window.location.hash
      window.history.replaceState(null, '', window.location.pathname)
      initialization.current = openPasswordRecovery(hash, createRecoveryClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ))
    }
    void initialization.current.then(
      (session) => { if (active) setRecovery(session) },
      (error) => { if (active) setFatalError(error instanceof Error ? error.message : 'Не удалось проверить ссылку. Запросите новое письмо.') },
    )
    return () => { active = false }
  }, [initialError])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!recovery || submitting || completed) return
    setFormError('')
    setSubmitting(true)
    try {
      await recovery.save(password, confirmation)
      setPassword('')
      setConfirmation('')
      setCompleted(true)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось сохранить пароль. Попробуйте снова.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-md border-[#E8ECF0] bg-white shadow-sm">
      <CardHeader className="space-y-4 pb-6 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-xl bg-[#1B3A6B] text-white shadow-lg shadow-[#1B3A6B]/15">
          <Factory className="size-7" />
        </div>
        <div>
          <CardTitle className="text-2xl font-bold text-[#1B3A6B]">Новый пароль</CardTitle>
          <CardDescription className="mt-1">Задайте новый пароль для входа в CRM</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {fatalError ? (
          <div className="space-y-4">
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{fatalError}</p>
            <Link className="inline-flex min-h-10 w-full items-center justify-center rounded-md border px-4 text-sm font-medium text-[#1B3A6B] hover:bg-slate-50" href="/login">Вернуться ко входу</Link>
          </div>
        ) : completed ? (
          <div className="space-y-4">
            <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">Пароль изменён для {recovery?.email}. Войдите с этим email и новым паролем.</p>
            <Link className="inline-flex min-h-10 w-full items-center justify-center rounded-md border px-4 text-sm font-medium text-[#1B3A6B] hover:bg-slate-50" href="/login">Перейти ко входу</Link>
          </div>
        ) : !recovery ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Проверяем ссылку…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-slate-600">Аккаунт: <strong>{recovery.email}</strong></p>
            {formError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{formError}</p>}
            <label className="grid gap-1.5 text-sm font-medium text-[#1B3A6B]">
              Новый пароль
              <Input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-[#1B3A6B]">
              Повторите пароль
              <Input type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            </label>
            <p className="text-xs text-slate-500">Не менее 12 символов.</p>
            <Button type="submit" disabled={submitting} className="w-full bg-[#1B3A6B] text-white hover:bg-[#152D54]">
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Сохранить новый пароль
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
