import { ResetPasswordForm } from '@/components/features/auth/ResetPasswordForm'

export const metadata = { title: 'Новый пароль — CRM Завода' }

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F4F6F9] p-4">
      <ResetPasswordForm initialError={error} />
    </main>
  )
}
