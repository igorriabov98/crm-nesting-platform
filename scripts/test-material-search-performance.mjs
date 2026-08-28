import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const materialSearchSource = await readFile(
  new URL('../src/components/features/requests/MaterialSearch.tsx', import.meta.url),
  'utf8',
)
const materialActionsSource = await readFile(
  new URL('../src/lib/actions/materials.ts', import.meta.url),
  'utf8',
)
const sheetMetalSource = await readFile(
  new URL('../src/components/features/requests/SheetMetalSection.tsx', import.meta.url),
  'utf8',
)

test('material search receives materials and variants in one server action', () => {
  assert.match(materialSearchSource, /searchMaterialsWithVariants/)
  assert.doesNotMatch(materialSearchSource, /getMaterialVariants/)
  assert.match(materialActionsSource, /\.in\('material_id', materialIds\)/)
  assert.match(materialActionsSource, /variantsByMaterialId/)
})

test('identical searches share completed and in-flight results', () => {
  assert.match(materialSearchSource, /const materialSearchCache = new Map/)
  assert.match(materialSearchSource, /const materialSearchInFlight = new Map/)
  assert.match(materialSearchSource, /if \(running\) return running/)
})

test('search debounce is short enough for interactive use', () => {
  const debounce = materialSearchSource.match(/\}, (\d+)\)\n\n    return \(\) => window\.clearTimeout\(timer\)/)
  assert.ok(debounce, 'search debounce was not found')
  assert.ok(Number(debounce[1]) <= 100, `search debounce is too long: ${debounce[1]} ms`)
})

test('adding a sheet row gives immediate feedback and rejects duplicate clicks', () => {
  assert.match(sheetMetalSource, /if \(isAdding\) return/)
  assert.match(sheetMetalSource, /Добавляю позицию…/)
  assert.match(sheetMetalSource, /disabled=\{isAdding\}/)
})
