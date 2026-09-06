import { ZodError } from 'zod'

type SupabaseError = {
  message: string
  code?: string
  details?: string
  hint?: string
}

function isSupabaseError(error: unknown): error is SupabaseError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as SupabaseError).message === 'string'
  )
}

function safeDatabaseMessage(message: string, code?: string) {
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Недостаточно прав для этого действия'
  }
  if (code === '42P17' || /infinite recursion|policy for relation/i.test(message)) {
    return 'Не удалось сохранить связь. Обновите страницу и повторите попытку'
  }
  if (code === '22P02' || /invalid input syntax for type uuid|invalid_format/i.test(message)) {
    return 'Проверьте выбранные данные и повторите попытку'
  }
  if (code === '23503' || /foreign key constraint/i.test(message)) {
    return 'Связанные данные не найдены. Обновите страницу'
  }
  if (code === '23505' || /duplicate key value/i.test(message)) {
    return 'Эта запись уже существует'
  }
  if (/violates .*constraint|relation .* does not exist|operator does not exist/i.test(message)) {
    return 'Не удалось сохранить данные. Повторите попытку'
  }
  return message
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues[0]?.message || 'Проверьте заполнение формы'
  }

  if (isSupabaseError(error)) {
    const message = safeDatabaseMessage(error.message, error.code)
    if (message !== error.message) return message
    const parts = [message]
    if (error.details) parts.push(error.details)
    if (error.hint) parts.push(`Hint: ${error.hint}`)
    return parts.join(' — ')
  }

  if (error instanceof Error) return safeDatabaseMessage(error.message)
  if (typeof error === 'string') return safeDatabaseMessage(error)
  return 'Произошла неизвестная ошибка'
}
