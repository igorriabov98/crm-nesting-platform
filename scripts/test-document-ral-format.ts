import assert from 'node:assert/strict'
import type { DocumentItem } from '@/lib/actions/document-generation'
import { formatDocumentItemName } from '@/lib/pdf/format'

function item(overrides: Partial<DocumentItem> = {}): DocumentItem {
  return {
    sort_order: 0,
    product_name_en: 'Tipper bucket for forklift truck VUC-750 DF',
    product_name_uk: 'Ковш відкидний для вилкового автонавантажувача VUC-750 DF',
    product_uktzed: '8431200090',
    quantity: 1,
    price: 100,
    total: 100,
    weight: 10,
    net_weight: 10,
    coating: 'none',
    ral_number: '',
    ...overrides,
  }
}

const powder = item({ coating: 'powder_coating', ral_number: '5010' })
assert.equal(formatDocumentItemName(powder, 'en'), 'Tipper bucket for forklift truck VUC-750 DF RAL5010')
assert.equal(formatDocumentItemName(powder, 'uk'), 'Ковш відкидний для вилкового автонавантажувача VUC-750 DF RAL5010')

const prefixedInput = item({ coating: 'powder_coating', ral_number: ' ral 5010 ' })
assert.equal(formatDocumentItemName(prefixedInput, 'en'), 'Tipper bucket for forklift truck VUC-750 DF RAL5010')

const legacyName = item({
  coating: 'powder_coating',
  ral_number: '9010',
  product_name_en: 'Tipper bucket for forklift truck VUC-750 DF RAL5010',
  product_name_uk: 'Ковш відкидний для вилкового автонавантажувача VUC-750 DF (RAL 5010)',
})
assert.equal(formatDocumentItemName(legacyName, 'en'), 'Tipper bucket for forklift truck VUC-750 DF RAL9010')
assert.equal(formatDocumentItemName(legacyName, 'uk'), 'Ковш відкидний для вилкового автонавантажувача VUC-750 DF RAL9010')

for (const coating of ['none', 'zinc'] as const) {
  const nonPowder = item({
    coating,
    ral_number: '5010',
    product_name_en: 'Tipper bucket for forklift truck VUC-750 DF RAL5010',
    product_name_uk: 'Ковш відкидний для вилкового автонавантажувача VUC-750 DF RAL 5010',
  })
  assert.equal(formatDocumentItemName(nonPowder, 'en'), 'Tipper bucket for forklift truck VUC-750 DF')
  assert.equal(formatDocumentItemName(nonPowder, 'uk'), 'Ковш відкидний для вилкового автонавантажувача VUC-750 DF')
}

const powderWithoutOrderRal = item({
  coating: 'powder_coating',
  ral_number: '',
  product_name_en: 'Tipper bucket for forklift truck VUC-750 DF RAL5010',
})
assert.equal(formatDocumentItemName(powderWithoutOrderRal, 'en'), 'Tipper bucket for forklift truck VUC-750 DF')

console.log('Document RAL formatting checks passed')
