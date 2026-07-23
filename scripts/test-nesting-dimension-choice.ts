import assert from 'node:assert/strict'
import {
  POSSIBLE_FOLDED_VIEW_HINT,
  dimensionMismatchPercent,
  getDimensionChoice,
} from '../src/lib/nesting/dimension-choice'

const frontSheet = {
  width: 1210,
  height: 770.88,
  bboxSizeX: 125,
  bboxSizeY: 708.6,
  bboxSizeZ: 1210,
  dimensionMismatch: false,
}

const frontSheetChoice = getDimensionChoice(
  {
    dimensionMismatch: true,
    suggestedUnfoldingWidth: 707.6,
    suggestedUnfoldingHeight: 1210,
  },
  frontSheet
)

assert.equal(frontSheetChoice.isConflict, true)
assert.ok(frontSheetChoice.mismatchPercent !== null)
assert.ok(Math.abs(frontSheetChoice.mismatchPercent - 8.21) < 0.01)
assert.equal(frontSheetChoice.possibleFoldedView, true)
assert.match(POSSIBLE_FOLDED_VIEW_HINT, /согнутый вид, а не развёртка/)

assert.equal(
  getDimensionChoice(
    {
      dimensionMismatch: false,
      suggestedUnfoldingWidth: 770.88,
      suggestedUnfoldingHeight: 1210,
    },
    frontSheet
  ).isConflict,
  false
)

assert.equal(
  dimensionMismatchPercent([68, 230], [65, 230]).toFixed(1),
  '4.4',
  'LEDA525 lug must keep showing the existing guarded mismatch'
)

console.log('[nesting-dimension-choice] STEP/PDF conflict and folded-view hint passed')
