import assert from 'node:assert/strict'
import test from 'node:test'
import { sheetMetalVariantMatchesRequest } from './supply-request-sheet-metal'

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

test('sheet stock without an explicit steel type is never an exact match', () => {
  assert.equal(sheetMetalVariantMatchesRequest({ ...request, steel_type_id: null }, {
    steel_type_id: null,
    sheet_size: '1200x1200',
    thickness_mm: 30,
  }), false)
})
