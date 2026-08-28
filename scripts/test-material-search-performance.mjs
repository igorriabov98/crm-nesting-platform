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
const permissionSource = await readFile(
  new URL('../src/lib/permissions/server.ts', import.meta.url),
  'utf8',
)
const currentUserSource = await readFile(
  new URL('../src/lib/auth/current-user.ts', import.meta.url),
  'utf8',
)

test('material search receives materials and variants without the serialized server-action queue', () => {
  assert.match(materialSearchSource, /fetch\(`\/api\/materials\/search\?/)
  assert.doesNotMatch(materialSearchSource, /searchMaterialsWithVariants\(/)
  assert.doesNotMatch(materialSearchSource, /getMaterialVariants/)
  assert.match(materialActionsSource, /\.in\('material_id', materialIds\)/)
  assert.match(materialActionsSource, /variantsByMaterialId/)
})

test('identical searches share completed and in-flight results', () => {
  assert.match(materialSearchSource, /const materialSearchCache = new Map/)
  assert.match(materialSearchSource, /const materialSearchInFlight = new Map/)
  assert.match(materialSearchSource, /if \(running\) return running/)
})

test('the active category is prefetched once and reused for category-label searches', () => {
  assert.match(materialSearchSource, /usesCategoryBrowse \? '@category' : query/)
  assert.match(materialSearchSource, /void loadMaterialSearchBundle\(key, effectiveQuery, category, allowCrossCategoryFallback\)/)
})

test('trusted CRM admin context skips duplicate permission queries', () => {
  assert.match(permissionSource, /getCurrentContextAdminPermissions\(context\.user\)/)
  assert.match(permissionSource, /\?\? await getCurrentUserPermissions\(context\.user\.id\)/)
  assert.match(currentUserSource, /const \[profileResult, membershipResult\] = await Promise\.all/)
})

test('read-only material search reuses live authorization without loading factory context', () => {
  assert.match(materialActionsSource, /operation === 'view'/)
  assert.match(materialActionsSource, /requireReadPermissionDataClient\('materials'\)/)
  assert.doesNotMatch(permissionSource, /supabase\.auth\.getClaims\(\)/)
  assert.match(permissionSource, /supabase\.auth\.getUser\(\)/)
  assert.match(permissionSource, /const \[userResult, membershipResult\] = await Promise\.all/)
})

test('search debounce is short enough for interactive use', () => {
  const debounce = materialSearchSource.match(/\}, (\d+)\)\n\n    return \(\) => window\.clearTimeout\(timer\)/)
  assert.ok(debounce, 'search debounce was not found')
  assert.ok(Number(debounce[1]) <= 100, `search debounce is too long: ${debounce[1]} ms`)
})

test('selected and hidden material inputs do not search in the background', () => {
  assert.match(materialSearchSource, /if \(!open \|\| disabled \|\| normalized\.length < 2\) return/)
  assert.match(materialSearchSource, /localSelection\?\.name, open, openDropdown/)
})

test('category-label searches skip the irrelevant variant full scan', () => {
  assert.match(materialActionsSource, /const shouldSearchVariantCharacteristics = !categoryLabelMatchesQuery && !matchedCategory/)
  assert.match(materialActionsSource, /if \(shouldSearchVariantCharacteristics && textFilters\.length\)/)
  assert.match(materialActionsSource, /if \(shouldSearchVariantCharacteristics && numericValue !== null\)/)
})

test('adding a sheet row gives immediate feedback and rejects duplicate clicks', () => {
  assert.match(sheetMetalSource, /if \(isAdding\) return/)
  assert.match(sheetMetalSource, /Добавляю позицию…/)
  assert.match(sheetMetalSource, /disabled=\{isAdding\}/)
})
