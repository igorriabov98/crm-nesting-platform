type FeatureFlagLookupResult = {
  data: { enabled?: unknown } | null
  error?: unknown
}

export async function readFeatureFlagSafely(
  lookup: () => PromiseLike<FeatureFlagLookupResult>,
): Promise<boolean> {
  try {
    const result = await lookup()
    if (result.error) return false
    return result.data?.enabled === true
  } catch {
    return false
  }
}
