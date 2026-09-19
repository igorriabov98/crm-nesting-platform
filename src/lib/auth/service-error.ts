/** Transport failures and throttling are retryable, not a denied session. */
export function isAuthServiceUnavailable(error: { status?: number } | null | undefined): boolean {
  return !!error && (!error.status || error.status === 408 || error.status === 429 || error.status >= 500)
}
