import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import {
  buildMaterialReceivingActData,
  type MaterialReceivingActSourceItem,
} from './material-receiving-act'
import { MaterialReceivingActDocument } from './pdf/MaterialReceivingActDocument'

const baseItem: MaterialReceivingActSourceItem = {
  key: 'schedule-1',
  machine_id: '11111111-1111-4111-8111-111111111111',
  machine_name: 'Заказ ЛЕДА.525 / Берегово',
  machine_specification_number: '525-08/26',
  factory_name: 'Берегово',
  delivery_date: '2026-08-29',
  planned_quantity: 18_000,
  unit: 'мм',
  supplier_name: 'Varian Steel',
  category: 'knives',
  is_whole_bar: true,
  item_name: 'Ножи Hardox 500',
  characteristics: [
    { label: 'Тип ножа', value: 'Ножи промышленные' },
    { label: 'Марка', value: 'Hardox 500' },
    { label: 'Скос', value: '1 скос' },
    { label: 'Ширина', value: '300 мм' },
    { label: 'Высота', value: '20 мм' },
  ],
  weight_kg: 842.4,
  is_virtual_schedule: false,
  planned_piece_length_mm: 6000,
  planned_piece_count: 3,
  purchase_components: [],
}

const sourceItems: MaterialReceivingActSourceItem[] = [
  baseItem,
  {
    ...baseItem,
    key: 'schedule-2',
    machine_id: '22222222-2222-4222-8222-222222222222',
    machine_name: 'Заказ ЛЕДА.526 / Ужгород',
    machine_specification_number: null,
    category: 'pipe',
    item_name: 'Труба профильная 80×40×3 мм',
    planned_quantity: 12_500,
    weight_kg: 111.25,
    planned_piece_length_mm: null,
    planned_piece_count: null,
    purchase_components: [
      { length_mm: 6500, piece_count: 1, is_nonstandard: true },
      { length_mm: 6000, piece_count: 1, is_nonstandard: false },
    ],
  },
  ...Array.from({ length: 5 }, (_, index): MaterialReceivingActSourceItem => ({
    ...baseItem,
    key: `schedule-extra-${index + 1}`,
    category: index % 2 === 0 ? 'sheet_metal' : 'components',
    is_whole_bar: false,
    item_name: index % 2 === 0
      ? `Листовой металл S355 с длинным наименованием позиции №${index + 1}`
      : `Комплектующие для сборки гидравлического узла №${index + 1}`,
    planned_quantity: 4 + index,
    unit: 'шт',
    weight_kg: index % 2 === 0 ? 25 + index : null,
    planned_piece_length_mm: null,
    planned_piece_count: null,
    purchase_components: [],
    characteristics: [
      { label: 'Материал', value: index % 2 === 0 ? 'Сталь конструкционная S355' : 'Комплект по спецификации' },
      { label: 'Примечание', value: 'Проверить маркировку, геометрию и количество при приёмке' },
    ],
  })),
]

const data = buildMaterialReceivingActData({
  deliveryDate: '2026-08-29',
  generatedAt: '2026-08-27T09:30:00.000Z',
  factoryName: 'Берегово',
  items: sourceItems,
})

test('receiving act preserves full material data and summarizes destination orders', () => {
  assert.equal(data.deliveryDate, '2026-08-29')
  assert.equal(data.factoryName, 'Берегово')
  assert.equal(data.items.length, 7)
  assert.equal(data.orders.length, 2)
  assert.equal(data.orders.find((order) => order.name.includes('ЛЕДА.525'))?.itemCount, 6)
  assert.equal(data.orders.find((order) => order.name.includes('ЛЕДА.526'))?.itemCount, 1)
  assert.equal(data.items[0].plannedBars[0].lengthMm, 6000)
  assert.deepEqual(data.items[1].plannedBars.map((bar) => bar.lengthMm), [6500, 6000])
  assert.deepEqual(data.supplierNames, ['Varian Steel'])
  assert.equal(data.totalWeightKg, 1034.65)
})

test('receiving act renders a Cyrillic multi-page PDF with the bundled design', async () => {
  const element = createElement(MaterialReceivingActDocument, { data }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF')
  assert(buffer.length > 20_000)

  const outputPath = process.env.MATERIAL_RECEIVING_ACT_OUTPUT
  if (outputPath) {
    const absolutePath = path.resolve(outputPath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, buffer)
  }
})
