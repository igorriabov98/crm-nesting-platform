export type CompletionFutureBusinessScrap = {
  inventoryId: string
  lengthMm: number
  state: 'future' | 'available'
}

export type CompletionFutureBusinessScrapGroup = {
  lengthMm: number
  pieceCount: number
  state: CompletionFutureBusinessScrap['state']
}

export function groupCompletionFutureBusinessScraps(
  scraps: CompletionFutureBusinessScrap[],
): CompletionFutureBusinessScrapGroup[] {
  const groups = new Map<string, CompletionFutureBusinessScrapGroup>()
  scraps.forEach((scrap) => {
    const key = `${scrap.state}:${scrap.lengthMm}`
    const current = groups.get(key)
    groups.set(key, {
      lengthMm: scrap.lengthMm,
      pieceCount: (current?.pieceCount || 0) + 1,
      state: scrap.state,
    })
  })
  return [...groups.values()].sort((left, right) => (
    Number(right.state === 'future') - Number(left.state === 'future') || right.lengthMm - left.lengthMm
  ))
}

export function completionFutureBusinessScrapTotalLength(
  scraps: CompletionFutureBusinessScrap[],
) {
  return scraps.reduce((total, scrap) => total + scrap.lengthMm, 0)
}

export function formatCompletionLengthMm(value: number) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} мм`
}
