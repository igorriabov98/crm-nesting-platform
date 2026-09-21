import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const invalidLink = 'Ссылка недействительна, просрочена или уже использована. Запросите новое письмо для сброса пароля.'

export function createRecoveryClient(url: string, key: string, fetcher?: typeof fetch) {
  // Recovery must never read, overwrite or broadcast the normal CRM session.
  return createClient(url, key, {
    auth: {
      flowType: 'implicit',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `crm-password-recovery-${crypto.randomUUID()}`,
    },
    ...(fetcher ? { global: { fetch: fetcher } } : {}),
  })
}

export async function openPasswordRecovery(hash: string, client: SupabaseClient) {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  if (params.has('error') || params.has('error_code') || params.get('type') !== 'recovery' || !access_token || !refresh_token) {
    throw new Error(invalidLink)
  }
  const { error } = await client.auth.setSession({ access_token, refresh_token })
  if (error) throw new Error(invalidLink)
  const { data, error: userError } = await client.auth.getUser()
  if (userError || !data.user?.email) throw new Error(invalidLink)
  const userId = data.user.id
  const email = data.user.email
  let completed = false
  let saving = false
  return {
    email,
    async save(password: string, confirmation: string) {
      if (completed) throw new Error('Пароль уже изменён. Войдите с новым паролем.')
      if (saving) throw new Error('Сохранение уже выполняется')
      if (password.length < 12) throw new Error('Пароль должен содержать не менее 12 символов')
      if (password !== confirmation) throw new Error('Пароли не совпадают')
      saving = true
      try {
        const { data: current, error: currentError } = await client.auth.getUser()
        if (currentError || current.user?.id !== userId) throw new Error(invalidLink)
        const { data: updated, error: updateError } = await client.auth.updateUser({ password })
        if (updateError) {
          if (updateError.code === 'same_password') throw new Error('Новый пароль должен отличаться от предыдущего')
          if (updateError.code === 'weak_password') throw new Error('Пароль не соответствует требованиям безопасности. Выберите более сложный пароль.')
          throw new Error('Не удалось сохранить пароль. Попробуйте снова или запросите новое письмо.')
        }
        if (updated.user?.id !== userId) throw new Error('Не удалось подтвердить смену пароля. Запросите новое письмо.')
        completed = true
        // Failure to revoke the recovery session cannot undo a successful password update.
        await client.auth.signOut({ scope: 'local' }).catch(() => undefined)
      } finally {
        saving = false
      }
    },
  }
}

export type PasswordRecovery = Awaited<ReturnType<typeof openPasswordRecovery>>
