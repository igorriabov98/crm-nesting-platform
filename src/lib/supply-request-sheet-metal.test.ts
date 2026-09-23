import assert from 'node:assert/strict'
import test from 'node:test'
import { sheetBusinessScrapMatchesRequest, sheetMetalVariantMatchesRequest } from './supply-request-sheet-metal'

const request = {
  steel_type_id: 's235-id',
  sheet_size: '1200х1200',
  thickness_mm: 30,
}

test('sheet stock must match the request steel type, size, and thickness', () => {
  assert.equal(sheetMetalVariantMatchesRequest(request, {
    steel_type_id: 's235-id',
    sheet_size: '1200 × 1200',
    thickness_mm: 30,
  }), true)
  assert.equal(sheetMetalVariantMatchesRequest({ ...request, sheet_size: '2500х1250' }, {
    steel_type_id: 's235-id', sheet_size: '1250x2500', thickness_mm: 30,
  }), true)
  assert.equal(sheetMetalVariantMatchesRequest(request, {
    steel_type_id: 's355-id',
    sheet_size: '1200x1200',
    thickness_mm: 30,
  }), false)
  assert.equal(sheetMetalVariantMatchesRequest(request, {
    steel_type_id: 's235-id',
    sheet_size: '1500x3000',
    thickness_mm: 30,
  }), false)
  assert.equal(sheetMetalVariantMatchesRequest(request, {
    steel_type_id: 's235-id',
    sheet_size: '1200x1200',
    thickness_mm: 20,
  }), false)
})

test('business scrap uses sheet category, steel type and thickness regardless of size', () => {
  const matching = { category: 'sheet_metal' as const, steel_type_id: 's235-id', thickness_mm: 30 }
  assert.equal(sheetBusinessScrapMatchesRequest(request, matching), true)
  assert.equal(sheetBusinessScrapMatchesRequest(request, { ...matching, category: 'pipe' }), false)
  assert.equal(sheetBusinessScrapMatchesRequest(request, { ...matching, steel_type_id: 's355-id' }), false)
  assert.equal(sheetBusinessScrapMatchesRequest(request, { ...matching, thickness_mm: 20 }), false)
})

test('sheet stock without an explicit steel type is never an exact match', () => {
  assert.equal(sheetMetalVariantMatchesRequest({ ...request, steel_type_id: null }, {
    steel_type_id: null,
    sheet_size: '1200x1200',
    thickness_mm: 30,
  }), false)
})
