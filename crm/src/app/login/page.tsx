import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/constants/routes'
import { LoginForm } from '@/components/features/auth/LoginForm'
import { UnregisteredAccount } from '@/components/features/auth/UnregisteredAccount'

export const metadata = {
  title: 'Вход — CRM Завода',
}

export default async function LoginPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()

    if (profile) redirect(ROUTES.DASHBOARD)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F4F6F9] p-4">
      {user ? <UnregisteredAccount /> : <LoginForm />}
    </main>
  )
}
