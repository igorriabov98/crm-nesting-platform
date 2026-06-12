'use server'

import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { SteelType } from '@/lib/types/database'

type DbResult<T = unknown> = { data: T | null; error: { message?: string } | null; count?: number | null }
type LooseQuery<T = unknown> = PromiseLike<DbResult<T>> & {
  select: (columns?: string, options?: { count?: 'exact'; head?: boolean }) => LooseQuery<T>
  insert: (values: Record<string, unknown>) => LooseQuery<T>
  update: (values: Record<string, unknown>) => LooseQuery<T>
  delete: () => LooseQuery<T>
  eq: (column: string, value: unknown) => LooseQuery<T>
  order: (column: string) => LooseQuery<T>
  single: () => Promise<DbResult<T>>
}
type LooseDb = {
  from: <T = unknown>(table: string) => LooseQuery<T>
}

async function getDb() {
  return await createServerSupabaseClient() as unknown as LooseDb
}

export async function getSteelTypes(): Promise<SteelType[]> {
  const supabase = await getDb()
  const { data, error } = await supabase
    .from<SteelType[]>('steel_types')
    .select('*')
    .order('name')

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createSteelType(
  name: string,
  density_g_cm3: number
): Promise<SteelType> {
  const supabase = await getDb()
  const { data, error } = await supabase
    .from<SteelType>('steel_types')
    .insert({
      name: name.trim(),
      density_kg_mm3: density_g_cm3 / 1_000_000,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Не удалось создать марку стали')
  return data
}

export async function updateSteelTypeDensity(
  id: string,
  density_g_cm3: number
): Promise<void> {
  const supabase = await getDb()
  const { error } = await supabase
    .from('steel_types')
    .update({ density_kg_mm3: density_g_cm3 / 1_000_000 })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function deleteSteelType(id: string): Promise<void> {
  const supabase = await getDb()
  const tables = [
    'request_sheet_metal',
    'request_circle',
    'request_pipe',
    'request_knives',
  ] as const

  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('steel_type_id', id)

    if (error) throw new Error(error.message)
    if (count && count > 0) {
      throw new Error('Марка стали используется в заявках — удаление невозможно')
    }
  }

  const { error } = await supabase
    .from('steel_types')
    .delete()
    .eq('id', id)

  if (error) throw new Error(error.message)
}
