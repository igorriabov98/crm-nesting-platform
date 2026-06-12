// Серверный клиент Supabase
// Используется в серверных компонентах и Server Actions
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Database } from '@/lib/types/database'

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              const { sameSite, ...rest } = options || {}
              cookieStore.set(name, value, {
                ...rest,
                sameSite: sameSite as 'strict' | 'lax' | 'none' | undefined,
              })
            })
          } catch {
            // setAll может вызываться из серверных компонентов (readonly cookies)
            // Игнорируем ошибку — сессия обновляется через middleware
          }
        },
      },
    }
  )
}
