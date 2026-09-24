/** Two rectangular sides have the same identity after a quarter turn. */
export function rectangularDimensions(value: unknown): [number, number] | null {
  const parts = String(value ?? '')
    .trim()
    .replace(/[хХ×*]/g, 'x')
    .split('x')
    .map((part) => Number(part.trim().replace(',', '.')))
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part) || part <= 0)) return null
  return [parts[0], parts[1]]
}

export function sameRectangularDimensions(left: unknown, right: unknown) {
  const a = rectangularDimensions(left)
  const b = rectangularDimensions(right)
  return Boolean(a && b && (
    (a[0] === b[0] && a[1] === b[1])
    || (a[0] === b[1] && a[1] === b[0])
  ))
}

export function reversedRectangularDimensionSearch(value: string) {
  const parts = rectangularDimensions(value)
  return parts ? `${parts[1]}x${parts[0]}` : null
}
