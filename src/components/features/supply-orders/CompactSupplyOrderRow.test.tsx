import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CompactSupplyOrderHeader, CompactSupplyOrderRow } from './CompactSupplyOrderRow'
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
        request_kind: 'stock', planned_material_date: null, quantity: 5 },
    ] }],
  },
} as unknown as SupplyOrderDateSlice

test('compact date row has aligned headings and only its own stock quantity', () => {
  const html = renderToStaticMarkup(<><CompactSupplyOrderHeader /><CompactSupplyOrderRow slice={row}><p>Детали</p></CompactSupplyOrderRow></>)
  assert.match(html, /Материал и характеристики.*Поставщик.*Заявка и дата Мат.плана.*Количества и состояние/)
  assert.match(html, /Срок потребности не задан.*5.*шт/)
  assert.match(html, /Нужно заказать.*0.*шт.*Заказано.*5.*шт/)
  assert.doesNotMatch(html, /ТЕС\.КОМ-20-2026|25 факт|30 шт/)
})
