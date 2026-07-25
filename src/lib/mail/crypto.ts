import 'server-only'

export function maskSecret(value: string | null | undefined) {
  if (!value) return null
  return `••••••••${value.slice(-4)}`
}
