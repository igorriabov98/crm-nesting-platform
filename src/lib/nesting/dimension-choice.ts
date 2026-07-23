export const POSSIBLE_FOLDED_VIEW_HINT =
  'PDF-значение меньше габарита согнутого тела — возможно, взят согнутый вид, а не развёртка'

type DimensionChoicePart = {
  width: number
  height: number
  bboxSizeX?: number | null
  bboxSizeY?: number | null
  bboxSizeZ?: number | null
  dimensionMismatch?: boolean
}

type DimensionChoiceMatch = {
  dimensionMismatch?: boolean
  suggestedUnfoldingWidth?: number | null
  suggestedUnfoldingHeight?: number | null
}

export type DimensionChoice =
  | {
      isConflict: false
      mismatchPercent: null
      possibleFoldedView: false
    }
  | {
      isConflict: true
      mismatchPercent: number
      possibleFoldedView: boolean
    }

export function getDimensionChoice(
  match: DimensionChoiceMatch,
  part: DimensionChoicePart | undefined
): DimensionChoice {
  const pdfDimensions = positivePair(
    match.suggestedUnfoldingWidth,
    match.suggestedUnfoldingHeight
  )
  const stepDimensions = part ? positivePair(part.width, part.height) : null
  const isConflict = Boolean(
    pdfDimensions &&
      stepDimensions &&
      (match.dimensionMismatch === true || part?.dimensionMismatch === true)
  )

  if (!isConflict || !pdfDimensions || !stepDimensions) {
    return {
      isConflict: false,
      mismatchPercent: null,
      possibleFoldedView: false,
    }
  }

  return {
    isConflict: true,
    mismatchPercent: dimensionMismatchPercent(stepDimensions, pdfDimensions),
    possibleFoldedView: part
      ? isPossibleFoldedView(part, stepDimensions, pdfDimensions)
      : false,
  }
}

export function dimensionMismatchPercent(
  currentDimensions: [number, number],
  proposedDimensions: [number, number]
): number {
  const current = sortedPair(currentDimensions)
  const proposed = sortedPair(proposedDimensions)
  const sideDelta = Math.max(
    relativeDelta(current[0], proposed[0]),
    relativeDelta(current[1], proposed[1])
  )
  const currentArea = current[0] * current[1]
  const proposedArea = proposed[0] * proposed[1]
  const areaDelta = Math.abs(currentArea - proposedArea) / Math.max(currentArea, proposedArea)

  return Math.max(sideDelta, areaDelta) * 100
}

function isPossibleFoldedView(
  part: DimensionChoicePart,
  stepDimensions: [number, number],
  pdfDimensions: [number, number]
): boolean {
  const bboxDimensions = [part.bboxSizeX, part.bboxSizeY, part.bboxSizeZ]
    .filter(isPositiveFinite)
    .sort((left, right) => right - left)
    .slice(0, 2)

  if (bboxDimensions.length !== 2) return false

  const folded = sortedPair([bboxDimensions[0], bboxDimensions[1]])
  const step = sortedPair(stepDimensions)
  const pdf = sortedPair(pdfDimensions)

  return pdf.some((value, index) => value < folded[index] && value < step[index])
}

function positivePair(
  width: number | null | undefined,
  height: number | null | undefined
): [number, number] | null {
  return isPositiveFinite(width) && isPositiveFinite(height)
    ? [width, height]
    : null
}

function sortedPair(values: [number, number]): [number, number] {
  return values[0] <= values[1] ? values : [values[1], values[0]]
}

function relativeDelta(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(left, right)
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
