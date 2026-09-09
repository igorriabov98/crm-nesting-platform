import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('../supabase/migrations/20260909130000_backfill_cancelled_material_completion.sql', import.meta.url),
  'utf8',
)

for (const table of [
  'request_sheet_metal',
  'request_round_tube',
  'request_circle',
  'request_pipe',
  'request_knives',
  'request_components',
  'request_paint',
  'request_mesh',
  'request_chain_cord',
]) {
  assert.match(source, new RegExp(`from public\\.${table} item`))
}

assert.match(source, /bool_and\(material\.order_status in \('delivered', 'cancelled'\)\)/)
assert.match(source, /bool_or\(material\.order_status = 'cancelled'\)/)
assert.match(source, /machine\.actual_material_date is null/)

console.log('cancelled material completion backfill covers every supply request table')
