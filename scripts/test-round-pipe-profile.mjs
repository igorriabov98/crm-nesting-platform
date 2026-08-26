import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')

const pipeProfile = read('src/lib/materials/pipe-profile.ts')
const materialDraft = read('src/lib/long-stock-material-draft.ts')
const materials = read('src/lib/actions/materials.ts')
const requests = read('src/components/features/requests/PipeSection.tsx')
const requestActions = read('src/lib/actions/technologist-requests.ts')
const cuttingPlans = read('src/lib/actions/long-stock-cutting-plans.ts')
const supplyRequest = read('src/lib/actions/supply-request.ts')
const inventory = read('src/components/features/inventory/InventoryPage.tsx')

assert.match(pipeProfile, /Для круглой трубы укажите один наружный диаметр, а не размер вида 40×40/)
assert.match(pipeProfile, /pieceDescription: null/)
assert.match(materialDraft, /diameter_mm: pipeProfile\.diameterMm/)
assert.match(materials, /requireCanonicalPipeProfile\(c\)/)
assert.match(materials, /same\(roundPipeOuterDiameterMm\(row\), input\.diameter_mm\)/)

assert.match(requests, /const showsSection = isRegularPipe && !isRound/)
assert.match(requests, /row\.pipe_type === 'wire' \|\| row\.pipe_type === 'round'/)
assert.match(requests, />Сечение, мм</)
assert.match(requests, />Диаметр, мм</)
assert.match(requestActions, /validatePipeProfileGeometry\(row, \{ requireComplete: false \}\)/)
assert.match(requestActions, /roundPipeOuterDiameterMm\(row\) !== null/)

assert.match(cuttingPlans, /const pipeProfile = requireCanonicalPipeProfile\(variant\)/)
assert.match(cuttingPlans, /size: pipeProfile\.pieceDescription/)
assert.match(cuttingPlans, /diameter_mm: pipeProfile\.diameterMm/)
assert.match(supplyRequest, /requestDiameter !== null && variantDiameter !== null && numbersMatch\(requestDiameter, variantDiameter\)/)

assert.match(inventory, /Наружный диаметр, мм/)
assert.match(inventory, /Наружный диаметр: \$\{formatMillimeters\(field\.value\)\}/)
assert.match(inventory, /row\.variant\?\.pipe_type === 'wire' \|\| row\.variant\?\.pipe_type === 'round'/)

console.log('Round pipe outer-diameter profile checks passed')
