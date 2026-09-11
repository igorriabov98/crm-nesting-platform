import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertTechnologistRequestEditable,
  isTechnologistRequestEditable,
} from '../src/lib/technologist-request-editability'
import { deriveRequestLifecycleStatus } from '../src/lib/technologist-request-lifecycle'
import { ORDER_STATUS_LABELS } from '../src/lib/constants/procurement'
import type { RequestStatus } from '../src/lib/types'

const editable: RequestStatus[] = ['draft', 'pending_stock_check', 'stock_checked']
const readOnly: RequestStatus[] = ['submitted_to_supply', 'completed', 'cancelled']

for (const status of editable) {
  assert.equal(isTechnologistRequestEditable(status), true, `${status} должен оставаться редактируемым`)
  assert.doesNotThrow(() => assertTechnologistRequestEditable(status))
}

for (const status of readOnly) {
  assert.equal(isTechnologistRequestEditable(status), false, `${status} должен быть только для просмотра`)
  assert.throws(() => assertTechnologistRequestEditable(status), /только для просмотра/)
}

assert.equal(ORDER_STATUS_LABELS.delivered, 'Получено', 'Финальный статус позиции должен называться «Получено»')
assert.equal(
  deriveRequestLifecycleStatus({ status: 'submitted_to_supply' }, ['cancelled']),
  'cancelled',
  'Заявка с единственной отменённой позицией должна показываться как отменённая',
)
assert.equal(
  deriveRequestLifecycleStatus({ status: 'submitted_to_supply' }, ['cancelled', 'ordered']),
  'delivery',
  'Отменённая позиция не должна скрывать доставку оставшихся активных позиций',
)
assert.equal(
  deriveRequestLifecycleStatus({ status: 'submitted_to_supply' }, ['cancelled', 'delivered']),
  'received',
  'Отменённая позиция не должна мешать завершению остальных принятых позиций',
)
assert.equal(
  deriveRequestLifecycleStatus({ status: 'cancelled' }, []),
  'cancelled',
  'Явно отменённая корректирующая заявка должна оставаться отменённой без строк заказа',
)

const root = process.cwd()
const action = readFileSync(join(root, 'src/lib/actions/technologist-requests.ts'), 'utf8')
assert((action.match(/assertTechnologistRequestEditable\(/g) || []).length >= 6, 'Все группы мутаций должны проверять статус заявки')
assert(action.includes("request.status !== 'draft'"), 'Оформление должно выполняться только из черновика')
assert(action.includes("request.status !== 'pending_stock_check' && request.status !== 'stock_checked'"), 'Проверка склада не должна менять закрытую заявку')

const page = readFileSync(join(root, 'src/components/features/requests/TechnologistRequestPage.tsx'), 'utf8')
assert(page.includes('canManage && isTechnologistRequestEditable(status)'), 'Клиент должен использовать общую матрицу редактируемости')
assert(page.includes('Заявка уже передана в снабжение и доступна только для просмотра.'), 'Закрытая заявка должна объяснять read-only режим')
assert(page.includes('{canEdit && ('), 'Действия заявки должны скрываться в read-only режиме')
const persistentRequestTabs = [...page.matchAll(/<TabsContent value="([^"]+)" keepMounted/g)].map((match) => match[1])
assert.deepEqual(
  persistentRequestTabs,
  ['sheet', 'circle', 'pipe', 'knives', 'paint', 'components', 'mesh', 'chain_cord'],
  'Каждая категория должна сохранять локальные строки при переключении вкладок',
)

const sectionFiles = [
  'SheetMetalSection.tsx',
  'CircleSection.tsx',
  'PipeSection.tsx',
  'KnivesSection.tsx',
  'PaintSection.tsx',
  'ComponentsSection.tsx',
  'MeshSection.tsx',
  'ChainCordSection.tsx',
]
for (const file of sectionFiles) {
  const source = readFileSync(join(root, 'src/components/features/requests', file), 'utf8')
  assert(source.includes('<RequestItemOrderStatus status={row.order_status}'), `${file} должен показывать статус позиции`)
}

console.log('technologist-request-editability: OK')
