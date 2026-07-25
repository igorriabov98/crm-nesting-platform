import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from '@/lib/supabase/admin'

export async function storeMailVaultSecret(input: {
  secretId?: string | null
  secret: string
  name: string
  description: string
}) {
  const { data, error } = await (createAdminClient() as any).rpc('mail_vault_store_secret', {
    p_secret_id: input.secretId || null,
    p_secret: input.secret,
    p_name: input.name,
    p_description: input.description,
  })
  if (error) throw new Error(`Supabase Vault: ${error.message}`)
  if (typeof data !== 'string' || !data) throw new Error('Supabase Vault не вернул идентификатор секрета')
  return data
}

export async function readMailVaultSecret(secretId: string) {
  const { data, error } = await (createAdminClient() as any).rpc('mail_vault_read_secret', {
    p_secret_id: secretId,
  })
  if (error) throw new Error(`Supabase Vault: ${error.message}`)
  if (typeof data !== 'string' || !data) throw new Error('Секрет Supabase Vault отсутствует')
  return data
}

export async function deleteMailVaultSecret(secretId: string | null | undefined) {
  if (!secretId) return
  const { error } = await (createAdminClient() as any).rpc('mail_vault_delete_secret', {
    p_secret_id: secretId,
  })
  if (error) throw new Error(`Supabase Vault: ${error.message}`)
}
