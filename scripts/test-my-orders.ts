import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MyOrdersView } from '../src/components/features/my-orders/MyOrdersView'
import {
  calculateMyOrderProductionProgress,
  isPersonalOpenOrder,
  mergePersonalOrderIds,
  type MyOrderProgressFact,
} from '../src/lib/my-orders-core'

const userId = 'user-1'
const responsibleClientIds = new Set(['client-own'])
const baseOrder = {
  created_by: 'another-user',
  client_id: 'client-foreign',
  is_archived: false,
  delivery_to_client_date: null,
}

assert(isPersonalOpenOrder({ ...baseOrder, created_by: userId }, userId, responsibleClientIds), 'Создатель должен видеть заказ')
assert(isPersonalOpenOrder({ ...baseOrder, client_id: 'client-own' }, userId, responsibleClientIds), 'Ответственный за клиента должен видеть заказ')
assert(isPersonalOpenOrder({ ...baseOrder, created_by: userId, client_id: 'client-own' }, userId, responsibleClientIds), 'Совпадение обоих условий должно сохранять заказ')
assert(!isPersonalOpenOrder(baseOrder, userId, responsibleClientIds), 'Чужой заказ должен быть исключён')
assert(!isPersonalOpenOrder({ ...baseOrder, created_by: userId, is_archived: true }, userId, responsibleClientIds), 'Архивный заказ должен быть исключён')
assert(!isPersonalOpenOrder({ ...baseOrder, created_by: userId, delivery_to_client_date: '2026-09-05' }, userId, responsibleClientIds), 'Полученный клиентом заказ должен быть исключён')
assert.deepEqual(mergePersonalOrderIds(['created', 'both'], ['responsible', 'both']), ['created', 'both', 'responsible'], 'Заказ, совпавший по двум условиям, не должен дублироваться')

const stages = [
  { stageType: 'assembly', isSkipped: false },
  { stageType: 'cleaning', isSkipped: false },
  { stageType: 'painting', isSkipped: false },
  { stageType: 'packaging', isSkipped: false },
]
const powderItem = { id: 'item-1', quantity: 1, unitWeightKg: 100, coating: 'powder_coating' }
const fact = (stageType: MyOrderProgressFact['stageType'], totalWeightKg: number): MyOrderProgressFact => ({
  stageType,
  itemId: powderItem.id,
  orderedQuantity: powderItem.quantity,
  unitWeightKg: powderItem.unitWeightKg,
  coating: powderItem.coating,
  totalWeightKg,
})

const fortyFivePercent = calculateMyOrderProductionProgress({
  stages,
  items: [powderItem],
  facts: [fact('assembly', 40), fact('assembly', 60), fact('cleaning', 60), fact('painting', 20)],
})
assert.equal(fortyFivePercent.state, 'exact')
assert.equal(fortyFivePercent.percent, 45, '100 + 60 + 20 + 0 из 100 × 4 должны дать 45%')
assert.equal(fortyFivePercent.completedKg, 180, 'Несколько фактов одного этапа должны накапливаться')
assert.equal(fortyFivePercent.applicableKg, 400)

const skippedStage = calculateMyOrderProductionProgress({
  stages: stages.map((stage) => ({ ...stage, isSkipped: stage.stageType === 'cleaning' })),
  items: [powderItem],
  facts: [fact('assembly', 100), fact('cleaning', 100)],
})
assert.equal(skippedStage.state, 'exact')
assert.equal(skippedStage.percent, 33.333, 'Пропущенный этап не должен входить ни в план, ни в факт')
assert.equal(skippedStage.applicableKg, 300)

const nonPowderItem = { id: 'item-2', quantity: 1, unitWeightKg: 100, coating: 'galvanized' }
const paintingApplicability = calculateMyOrderProductionProgress({
  stages,
  items: [powderItem, nonPowderItem],
  facts: [fact('assembly', 100), fact('painting', 100)],
})
assert.equal(paintingApplicability.state, 'exact')
assert.equal(paintingApplicability.applicableKg, 700, 'Малярка должна учитывать только порошковое покрытие')
assert.equal(paintingApplicability.completedKg, 200)

const noFacts = calculateMyOrderProductionProgress({ stages, items: [powderItem], facts: [] })
assert.equal(noFacts.state, 'exact')
assert.equal(noFacts.percent, 0, 'Без факта точный прогресс должен быть 0%')
assert.equal(noFacts.completedKg, 0)

const abovePlan = calculateMyOrderProductionProgress({
  stages: [{ stageType: 'assembly', isSkipped: false }],
  items: [powderItem],
  facts: [fact('assembly', 120)],
})
assert.equal(abovePlan.state, 'exact')
assert.equal(abovePlan.percent, 120, 'Процент должен отражать перевыпуск, а не терять факт выше плана')

const legacy = calculateMyOrderProductionProgress({
  stages,
  items: [powderItem],
  facts: [fact('cleaning', 60)],
  legacyStages: ['assembly'],
})
assert.equal(legacy.state, 'legacy', 'Старый факт активного применимого этапа должен скрывать приблизительный процент')
assert.equal(legacy.percent, null)

const skippedLegacy = calculateMyOrderProductionProgress({
  stages: [{ stageType: 'assembly', isSkipped: true }, { stageType: 'packaging', isSkipped: false }],
  items: [powderItem],
  facts: [],
  legacyStages: ['assembly'],
})
assert.equal(skippedLegacy.state, 'exact', 'Старый факт пропущенного этапа не должен блокировать точный расчёт')
assert.equal(skippedLegacy.percent, 0)

const noStages = calculateMyOrderProductionProgress({
  stages: [{ stageType: 'painting', isSkipped: false }],
  items: [nonPowderItem],
  facts: [],
})
assert.equal(noStages.state, 'no_stages', 'Заказ без применимых этапов должен иметь отдельное состояние')

const root = process.cwd()
const serviceSource = readFileSync(join(root, 'src/lib/my-orders.ts'), 'utf8')
const pageSource = readFileSync(join(root, 'src/app/(protected)/sales/my-orders/page.tsx'), 'utf8')
const viewSource = readFileSync(join(root, 'src/components/features/my-orders/MyOrdersView.tsx'), 'utf8')
const loadingSource = readFileSync(join(root, 'src/app/(protected)/sales/my-orders/loading.tsx'), 'utf8')
const errorSource = readFileSync(join(root, 'src/app/(protected)/sales/my-orders/error.tsx'), 'utf8')

const permissionCheckIndex = serviceSource.indexOf("requirePermission('my_orders', 'view')")
const adminClientIndex = serviceSource.indexOf('createAdminClient()', permissionCheckIndex)
assert(permissionCheckIndex >= 0, 'Серверная загрузка должна явно проверять my_orders.view')
assert(adminClientIndex > permissionCheckIndex, 'Сервисный клиент можно создавать только после авторизации')
assert.match(serviceSource, /\.eq\('created_by', userId\)/u, 'Личный набор должен включать созданные пользователем заказы')
assert.match(serviceSource, /\.eq\('responsible_user_id', userId\)/u, 'Личный набор должен включать заказы ответственных клиентов')
assert.match(serviceSource, /\.eq\('is_archived', false\)/u, 'Архивные заказы должны отсеиваться серверно')
assert.match(serviceSource, /\.is\('delivery_to_client_date', null\)/u, 'Заказы с датой получения должны отсеиваться серверно')
assert.match(serviceSource, /loadMachineProgressContexts/u, 'Статус должен строиться через существующий MachineProgress')
assert.match(pageSource, /loadMyOrdersPageData/u, 'Страница должна загружать данные на сервере')
assert.match(pageSource, /force-dynamic/u, 'Личные данные нельзя кэшировать как статическую страницу')
assert.match(viewSource, /md:hidden/u, 'На мобильных должны использоваться карточки')
assert.match(viewSource, /hidden overflow-hidden[\s\S]*md:block/u, 'На планшете и десктопе должна использоваться компактная таблица')
assert(viewSource.includes('aria-label={`Прогресс производства заказа'), 'Прогресс должен иметь доступное описание')
assert.match(viewSource, /order\.canOpenDetails/u, 'Ссылка на заказ должна зависеть от sales_plan.view')
assert.match(viewSource, /Нет заказов без даты получения клиентом/u, 'Должно быть явное пустое состояние')
assert.match(viewSource, /Нет точных данных/u, 'Legacy-факт должен иметь явное состояние')
assert.match(viewSource, /Не указана/u, 'Отсутствующая плановая дата должна иметь явную подпись')
assert.match(loadingSource, /MyOrdersLoadingState/u, 'Маршрут должен иметь skeleton загрузки')
assert.match(errorSource, /MyOrdersErrorState/u, 'Маршрут должен иметь ошибку с повтором')
assert(!serviceSource.includes(".is('actual_shipping_date'"), 'Отгруженный заказ должен оставаться до даты получения клиентом')

const status = {
  currentKey: 'shipped' as const,
  currentLabel: 'Отгружена',
  steps: [],
  blockers: [],
}
const renderedOrders = renderToStaticMarkup(createElement(MyOrdersView, {
  orders: [
    {
      id: 'order-1',
      name: 'Заказ 1',
      clientName: 'Клиент 1',
      desiredShippingDate: '2026-09-20',
      status,
      productionProgress: fortyFivePercent,
      canOpenDetails: true,
    },
    {
      id: 'order-2',
      name: 'Заказ 2',
      clientName: null,
      desiredShippingDate: null,
      status,
      productionProgress: legacy,
      canOpenDetails: false,
    },
  ],
}))
assert.match(renderedOrders, /href="\/sales-plan\/order-1"/u, 'Разрешённая карточка должна ссылаться на заказ')
assert(!renderedOrders.includes('href="/sales-plan/order-2"'), 'Без sales_plan.view ссылка не должна рендериться')
assert.match(renderedOrders, /aria-valuetext="45%, 180 из 400 кг"/u, 'SSR должен сохранять доступное значение прогресса')
assert.match(renderedOrders, /20\.09\.2026/u, 'Плановая дата должна форматироваться по-русски')
assert.match(renderedOrders, /Не указана/u, 'SSR должен показывать отсутствие плановой даты')

const emptyOrders = renderToStaticMarkup(createElement(MyOrdersView, { orders: [] }))
assert.match(emptyOrders, /Нет заказов без даты получения клиентом/u, 'SSR должен показывать пустое состояние')

console.log('My orders contracts: OK')
