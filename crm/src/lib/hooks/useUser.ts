'use client'

// Хук для получения текущего авторизованного пользователя
// Загружает профиль из таблицы users (не auth.users) вместе с данными завода
// Кэширует результат в Zustand store для переиспользования без дополнительных запросов
import { useEffect } from 'react'
import { create } from 'zustand'
import { createClient } from '@/lib/supabase/client'
import type { CurrentUser } from '@/lib/types'

// Zustand store для хранения данных текущего пользователя
interface UserStore {
  user: CurrentUser | null
  loading: boolean
  error: string | null
  setUser: (user: CurrentUser | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

export const useUserStore = create<UserStore>((set) => ({
  user: null,
  loading: true,
  error: null,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => set({ user: null, loading: false, error: null }),
}))

/**
 * Хук для получения текущего пользователя.
 * Загружает профиль один раз и кэширует в Zustand.
 * Использовать в клиентских компонентах.
 */
export function useUser() {
  const { user, loading, error, setUser, setLoading, setError } = useUserStore()

  useEffect(() => {
    // Если данные уже загружены — не перезапрашиваем
    if (user !== null) return

    const supabase = createClient()

    async function loadUser() {
      setLoading(true)
      setError(null)

      try {
        // Получаем сессию из auth
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser()

        if (!authUser) {
          setUser(null)
          return
        }

        // Загружаем профиль из таблицы users с данными завода
        const { data, error: profileError } = await supabase
          .from('users')
          .select('*, factory:factories(*)')
          .eq('id', authUser.id)
          .single()

        if (profileError) {
          setError('Ошибка загрузки профиля пользователя')
          return
        }

        setUser(data as CurrentUser)
      } catch {
        setError('Непредвиденная ошибка при загрузке профиля')
      } finally {
        setLoading(false)
      }
    }

    loadUser()

    // Подписка на изменения сессии (логин/логаут)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setUser(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [user, setUser, setLoading, setError])

  return { user, loading, error }
}
