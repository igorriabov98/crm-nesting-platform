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

export function getErrorMessage(error: unknown): string {
  if (isSupabaseError(error)) {
    const parts = [error.message]
    if (error.details) parts.push(error.details)
    if (error.hint) parts.push(`Hint: ${error.hint}`)
    return parts.join(' — ')
  }

  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Произошла неизвестная ошибка'
}
