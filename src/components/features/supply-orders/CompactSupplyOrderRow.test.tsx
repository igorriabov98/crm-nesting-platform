import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CompactSupplyOrderHeader, CompactSupplyOrderRow } from './CompactSupplyOrderRow'
import { redeliveryOriginLabel, redeliveryOriginOptionLabel } from './redelivery-origin-label'
import type { SupplyOrderDateSlice } from './supply-order-view'

const row = {
  id: 'stock-date', dateKey: '2026-10-22', kind: 'delivery', state: 'ordered',
  quantity: 5, plannedQuantity: 5, deliveredQuantity: 0, unscheduledQuantity: 0,
  plannedScheduleCount: 1, deliveredScheduleCount: 0, supplierName: 'АВ метал груп',
  sourceQuantities: { 'request_sheet_metal:stock': 5 },
  aggregate: {
    item_name: 'Листовой металл', unit: 'шт', characteristics: [{ label: 'Толщина', value: '20' }],
    factories: [{ items: [
      { table: 'request_sheet_metal', id: 'machine', machine_id: 'machine', machine_name: 'ТЕС.КОМ-20-2026',
        request_kind: 'machine', planned_material_date: '2026-10-01', quantity: 25 },
      { table: 'request_sheet_metal', id: 'stock', machine_id: '', machine_name: 'На склад · ууауа',
        request_kind: 'stock', planned_material_date: null, quantity: 5, weight_kg: 327.6 },
    ] }],
  },
} as unknown as SupplyOrderDateSlice

test('compact date row has aligned headings and only its own stock quantity', () => {
  const html = renderToStaticMarkup(<><CompactSupplyOrderHeader /><CompactSupplyOrderRow slice={row}><p>Детали</p></CompactSupplyOrderRow></>)
  assert.match(html, /Материал и характеристики.*Поставщик.*Заявка и дата Мат.плана.*Вес позиции.*Количества и состояние/)
  assert.match(html, /Срок потребности не задан.*5.*шт/)
  assert.match(html, /327,6 кг/)
  assert.match(html, /Нужно заказать.*0.*шт.*Заказано.*5.*шт/)
  assert.doesNotMatch(html, /ТЕС\.КОМ-20-2026|25 факт|30 шт/)
})

test('combined row keeps each original requirement date and does not invent missing weight', () => {
  const combined = {
    ...row,
    sourceQuantities: { 'request_sheet_metal:machine': 2, 'request_sheet_metal:stock': 3 },
    aggregate: {
      ...row.aggregate,
      factories: [{ items: [
        { table: 'request_sheet_metal', id: 'machine', machine_id: 'machine', machine_name: 'ТЕС.КОМ-20-2026',
          request_kind: 'machine', planned_material_date: '2026-10-01', quantity: 25, weight_kg: null },
        { table: 'request_sheet_metal', id: 'stock', machine_id: '', machine_name: 'На склад',
          request_kind: 'stock', planned_material_date: null, quantity: 5, weight_kg: 327.6 },
      ] }],
    },
  } as unknown as SupplyOrderDateSlice
  const html = renderToStaticMarkup(<CompactSupplyOrderRow slice={combined}><p>Детали</p></CompactSupplyOrderRow>)
  assert.match(html, /Мат.план 01\.10\.2026.*2.*шт/)
  assert.match(html, /Срок потребности не задан.*3.*шт/)
  assert.match(html, /Вес позиции:.*Не рассчитан/)
  assert.doesNotMatch(html, /0 кг/)
})

test('redelivery identifies the original order, warehouse receipt and shortage without exposing an id', () => {
  const origin = { id: '814c98a4-c1bd-438b-a6ba-d5ad939efc40', date: '2026-10-14',
    supplierId: 'supplier', supplierName: 'АВ метал груп', planned: 3, received: 2, available: 1 }
  assert.equal(redeliveryOriginLabel(origin, 'шт'),
    'Поставка 14.10.2026 · АВ метал груп: заказано 3 шт, склад подтвердил 2 шт, недопоставка 1 шт')
  assert.match(redeliveryOriginOptionLabel(origin, 'шт'), /заказано 3, принято 2, осталось довезти 1 шт$/)
  assert.doesNotMatch(redeliveryOriginOptionLabel(origin, 'шт'), /814c98a4|undefined/)
})
