export type KnifeProfileSource = {
  width_mm?: number | string | null
  height_mm?: number | string | null
  knife_dimensions?: string | null
}

function positiveNumber(value: unknown) {
  const number = Number(String(value ?? '').trim().replace(',', '.'))
  return Number.isFinite(number) && number > 0 ? number : null
}

export function knifeProfileDimensions(source: KnifeProfileSource) {
  const parsed = String(source.knife_dimensions ?? '')
    .trim()
    .toLowerCase()
    .replace(/[х×*]/gu, 'x')
    .split('x')
    .map(positiveNumber)
    .filter((value): value is number => value !== null)

  return {
    widthMm: positiveNumber(source.width_mm) ?? parsed.at(-2) ?? null,
    heightMm: positiveNumber(source.height_mm) ?? parsed.at(-1) ?? null,
  }
}

export function formatKnifeProfileDimensions(
  source: KnifeProfileSource,
  separator = '×',
) {
  const { widthMm, heightMm } = knifeProfileDimensions(source)
  return widthMm && heightMm ? `${widthMm}${separator}${heightMm}` : ''
}
