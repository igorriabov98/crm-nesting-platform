import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProductWithFiles } from '@/lib/actions/products'
import { filterAndSortProducts, type ProductSortKey } from './product-list-view'

const products = [
  { id: 'a', name_uk: 'Ящик', name_en: 'Box', uktzed: '10', drawing_number: 'B-10', unit_weight_kg: 12, product_files: [{}, {}], status: 'draft' },
  { id: 'b', name_uk: 'Відро', name_en: 'Bucket', uktzed: '2', drawing_number: 'A-2', unit_weight_kg: 3, product_files: [{}], status: 'active' },
  { id: 'c', name_uk: 'Ковш', name_en: 'Scoop', uktzed: '3', drawing_number: 'A-11', unit_weight_kg: 25, product_files: [{}, {}, {}], status: 'archived' },
] as ProductWithFiles[]

function ids(key: ProductSortKey, direction: 'asc' | 'desc') {
  return filterAndSortProducts(products, '', key, direction).map((product) => product.id)
}

test('searches Ukrainian and English names and drawing numbers', () => {
  assert.deepEqual(filterAndSortProducts(products, 'відро', 'name', 'asc').map((p) => p.id), ['b'])
  assert.deepEqual(filterAndSortProducts(products, 'SCOOP', 'name', 'asc').map((p) => p.id), ['c'])
  assert.deepEqual(filterAndSortProducts(products, 'b-10', 'name', 'asc').map((p) => p.id), ['a'])
})

test('sorts every column in both directions using displayed values and numeric amounts', () => {
  const ascending: Record<ProductSortKey, string[]> = {
    name: ['b', 'c', 'a'],
    uktzed: ['b', 'c', 'a'],
    drawing: ['b', 'c', 'a'],
    weight: ['b', 'a', 'c'],
    files: ['b', 'a', 'c'],
    status: ['b', 'c', 'a'],
  }
  for (const key of Object.keys(ascending) as ProductSortKey[]) {
    assert.deepEqual(ids(key, 'asc'), ascending[key], `${key} ascending`)
    assert.deepEqual(ids(key, 'desc'), [...ascending[key]].reverse(), `${key} descending`)
  }
})
