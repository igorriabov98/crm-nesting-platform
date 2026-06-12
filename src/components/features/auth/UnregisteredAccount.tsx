'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ROUTES } from '@/lib/constants/routes'
import { useUserStore } from '@/lib/hooks/useUser'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function UnregisteredAccount() {
  const router = useRouter()
  const reset = useUserStore((state) => state.reset)
  const [isPending, startTransition] = useTransition()

  const signOut = () => {
    startTransition(async () => {
      const supabase = createClient()
      await supabase.auth.signOut()
      reset()
      router.replace(ROUTES.LOGIN)
      router.refresh()
    })
  }

  return (
    <Card className="w-full max-w-md border-[#FCA5A5] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <CardHeader className="space-y-4 pb-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-red-50 text-[#DC2626]">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <div>
          <CardTitle className="text-2xl font-bold text-[#1B3A6B]">Аккаунт не зарегистрирован в CRM</CardTitle>
          <CardDescription className="mt-2 text-[#6B7280]">
            Вход в Supabase выполнен, но профиль пользователя не найден в базе CRM.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-center text-sm text-[#6B7280]">
          Обратитесь к администратору, чтобы восстановить профиль, или выйдите и войдите под другим аккаунтом.
        </p>
        <Button
          type="button"
          onClick={signOut}
          disabled={isPending}
          className="w-full bg-[#1B3A6B] font-medium text-white hover:bg-[#152D54]"
        >
          {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
          Выйти
        </Button>
      </CardContent>
    </Card>
  )
}
