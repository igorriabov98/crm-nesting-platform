import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function source(path: string) {
  return readFileSync(resolve(path), 'utf8')
}

const form = source('src/components/features/products/ProductProjectForm.tsx')
assert.match(form, /dynamic\([\s\S]*AttachedMailConversation/, 'attached mail conversation must be split into a lazy client chunk')
assert.match(form, /mailExpanded && \(/, 'attached mail content must mount only after the card is expanded')
assert.doesNotMatch(form, /MailThreadPicker/, 'project creation must not expose unrelated mailbox search')
assert.doesNotMatch(form, /mailThreadIds/, 'project creation must only use the explicitly attached mail link')
assert.match(form, /Открыть.*прикреплённую переписку/, 'attached mail card must have an accessible open action')

const attachedConversation = source('src/components/features/products/AttachedMailConversation.tsx')
assert.match(attachedConversation, /getMailThread\(link\.thread_id, link\.kind === 'message' \? link\.id : null\)/)
assert.match(attachedConversation, /thread\.messages\.map/, 'attached thread messages must be rendered')
assert.doesNotMatch(form, /<Label>Статус<\/Label>/, 'project status must not be editable in the form')
assert.match(form, /После создания инженер сразу получит задачу/, 'form must explain automatic engineer task creation')

const lifecycle = source('src/components/features/products/ProductProjectLifecycle.tsx')
for (const label of ['Ожидает инженера', 'В работе', 'Предварительно готов', 'Готов к заказу', 'Закрыт']) {
  assert.ok(lifecycle.includes(label), `missing lifecycle label: ${label}`)
}

const productActions = source('src/lib/actions/products.ts')
assert.match(productActions, /engineer_description/, 'engineering result must include an engineer description')
assert.match(productActions, /application\/pdf/, 'engineering drawing must be validated as PDF')
assert.match(productActions, /status: 'added_to_products'/, 'shipped project must be closed after product promotion')
assert.match(productActions, /source_project_id: projectId/, 'promoted product must retain project provenance')

const taskActions = source('src/lib/actions/tasks.ts')
assert.match(taskActions, /status === 'in_progress'[\s\S]*product_project_engineering[\s\S]*status: 'engineering'/)
assert.match(taskActions, /finishProjectEngineering[\s\S]*status: 'client_review'/)
assert.match(taskActions, /описание инженера/, 'task completion must require the engineer description')

const salesPlanActions = source('src/app/(protected)/sales-plan/actions.ts')
const promotionAfterItems = salesPlanActions.indexOf("select('actual_shipping_date')")
const itemProcessing = salesPlanActions.indexOf('// 2. Machine Items')
assert.ok(promotionAfterItems > itemProcessing, 'promotion check must run after project items are saved')
assert.match(salesPlanActions, /actual_shipping_date[\s\S]*promoteShippedProjectSamplesToProducts/)

const list = source('src/components/features/products/ProductProjectList.tsx')
assert.match(list, /Архив проектов/)
assert.match(list, /status === 'added_to_products'/)

const breadcrumbs = source('src/components/features/layout/Breadcrumbs.tsx')
assert.match(breadcrumbs, /"product-projects": "Проекты продукции"/)

console.log('product project lifecycle checks passed')
