// Admin клиент — ТОЛЬКО для серверных операций
// Используется для создания пользователей (обход RLS через service_role)
// НИКОГДА не импортировать в клиентских компонентах!
import { createClient } from '@supabase/supabase-js'
import { Database } from '@/lib/types/database'

export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // ← service role, НЕ anon key
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
