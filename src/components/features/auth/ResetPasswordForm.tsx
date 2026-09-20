'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Factory, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export function ResetPasswordForm({ initialError }: { initialError?: string }) {
  const [ready, setReady] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [fatalError, setFatalError] = useState(initialError || '')
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (initialError) return
    const supabase = createClient()
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const authError = hash.get('error_description')
    if (authError) {
      queueMicrotask(() => setFatalError('Ссылка недействительна, просрочена или уже использована'))
      return
    }
    const recoveryLink = hash.get('type') === 'recovery' || hash.has('access_token')
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) setReady(true)
    })
    if (recoveryLink) {
      void supabase.auth.getSession().then(({ data }) => {
        if (data.session) setReady(true)
        else setFatalError('Ссылка недействительна, просрочена или уже использована')
      })
    } else {
      queueMicrotask(() => setFatalError('Откройте эту страницу по ссылке из письма для сброса пароля'))
    }
    return () => listener.subscription.unsubscribe()
  }, [initialError])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    if (password.length < 12) {
      setFormError('Пароль должен содержать не менее 12 символов')
      return
    }
    if (password !== confirmation) {
      setFormError('Пароли не совпадают')
      return
    }
    setSubmitting(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setFormError(updateError.message || 'Не удалось сохранить новый пароль')
      setSubmitting(false)
      return
    }
    await supabase.auth.signOut()
    toast.success('Пароль изменён. Войдите с новым паролем.')
    window.location.replace('/login')
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
        ) : !ready ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Проверяем ссылку…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
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
