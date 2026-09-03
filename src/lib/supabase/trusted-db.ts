type TrustedDbError = {
  code?: string
  message: string
  details?: string
  hint?: string
}

export type TrustedDbResult = {
  data: unknown
  error: TrustedDbError | null
  count?: number | null
}

export type TrustedQuery = PromiseLike<TrustedDbResult> & {
  select: (columns?: string, options?: unknown) => TrustedQuery
  eq: (column: string, value: unknown) => TrustedQuery
  neq: (column: string, value: unknown) => TrustedQuery
  gt: (column: string, value: unknown) => TrustedQuery
  gte: (column: string, value: unknown) => TrustedQuery
  lt: (column: string, value: unknown) => TrustedQuery
  lte: (column: string, value: unknown) => TrustedQuery
  is: (column: string, value: unknown) => TrustedQuery
  in: (column: string, values: readonly unknown[]) => TrustedQuery
  order: (column: string, options?: { ascending?: boolean }) => TrustedQuery
  limit: (count: number) => TrustedQuery
  insert: (values: unknown) => TrustedQuery
  upsert: (values: unknown, options?: unknown) => TrustedQuery
  update: (values: unknown) => TrustedQuery
  delete: () => TrustedQuery
  single: () => PromiseLike<TrustedDbResult>
  maybeSingle: () => PromiseLike<TrustedDbResult>
}

export type TrustedDb = {
  from: (table: string) => TrustedQuery
  rpc: (functionName: string, args?: Record<string, unknown>) => PromiseLike<TrustedDbResult>
}

/**
 * Restricts service-role access to the small PostgREST surface used by trusted
 * server loaders and mutations. Callers still cast returned rows to their
 * explicit, selected-field DTOs rather than leaking generated table shapes.
 */
export function trustedDb(client: unknown): TrustedDb {
  return client as TrustedDb
}
