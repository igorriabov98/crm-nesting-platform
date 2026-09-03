import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDefaultPermissionMap, getFullPermissionMap, getPermissionRequirementForPath, getSidebarResources, hasPermission } from '../src/lib/permissions/resources'
import { resolveDepartmentPermissions } from '../src/lib/permissions/resolve'

const root = process.cwd()
const source = (file: string) => readFileSync(join(root, file), 'utf8')

const migration = source('supabase/migrations/20260903100000_invoice_payments_workspace.sql')
assert(migration.includes('CREATE TABLE IF NOT EXISTS public.invoice_payments'))
assert(migration.includes('FOR UPDATE;'), 'Оплата должна блокировать строку инвойса')
assert(migration.includes("GRANT EXECUTE ON FUNCTION public.fn_record_invoice_payment"))
assert(migration.includes("REVOKE ALL ON FUNCTION public.fn_record_invoice_payment"))
assert(migration.includes('DROP POLICY IF EXISTS "Invoices - Update status"'))
assert(!/CREATE\s+POLICY[\s\S]{0,120}invoice_payments[\s\S]{0,80}authenticated/iu.test(migration), 'Нельзя открывать финансовые записи браузерному authenticated')
assert(migration.indexOf('voided_at = now()') < migration.lastIndexOf('INSERT INTO public.invoice_payments'), 'Исправление сначала аннулирует старую запись в одной транзакции')
assert(migration.includes('trg_protect_client_responsible_user'))
assert(migration.includes('idx_invoices_one_active_per_machine'))
assert(migration.includes("invoice.status <> 'cancelled'::public.invoice_status"))
assert(migration.includes('ALTER COLUMN status SET NOT NULL'), 'Активный инвойс не должен обходить уникальность через NULL-статус')
assert.equal((migration.match(/Payment actor is invalid/g) || []).length, 2, 'Создание и исправление оплаты проверяют автора')
assert(migration.includes('Cancellation actor is invalid'), 'Аннулирование проверяет автора')
assert(migration.includes('trg_refresh_invoice_due_date_on_delivery'), 'Фактическая доставка должна уточнять срок оплаты')
assert(migration.includes('payment_date = exact_due_date'), 'Журнал должен синхронизировать следующий точный срок')

const actions = source('src/lib/actions/invoices.ts')
assert(actions.includes('export async function issueMachineInvoice'))
assert(actions.includes("requirePermission('invoices', 'manage')"))
assert(actions.includes("requireCompanyRecordAccess('invoices', 'manage'"))
assert(actions.includes('createInvoiceDocumentSnapshot'))
assert(actions.includes("admin.from('invoice_terms_audit')"))
assert(!actions.includes('freight_cost'), 'Внутренняя стоимость транспорта не входит в инвойс')

const salesPlanActions = source('src/app/(protected)/sales-plan/actions.ts')
assert(salesPlanActions.includes('permissionDetails.companyScopes.invoices?.view'), 'Карточка и список машин учитывают область компаний для инвойсов')
assert(salesPlanActions.includes('invoice: canViewInvoice ? m.invoice : null'), 'Чужие инвойсы не должны попадать в данные списка машин')
const clientActions = source('src/lib/actions/clients.ts')
assert(clientActions.includes("current_invoice_amount: canViewClientInvoices ?"), 'Список клиентов не должен раскрывать суммы чужих инвойсов')
const dashboard = source('src/app/(protected)/dashboard/page.tsx')
assert(dashboard.includes("overdueInvoicesQuery.eq('machines.clients.responsible_user_id', userId)"), 'Дашборд должен учитывать область своих компаний')
assert(dashboard.includes(".neq('status', 'cancelled')"), 'Дашборд не должен считать аннулированные инвойсы просроченными')

const documentAction = source('src/lib/actions/document-generation.ts')
assert(documentAction.includes('Signed links expire and therefore must never be persisted'))
assert(documentAction.includes('getTrustedDocumentData'))
const pdf = source('src/lib/pdf/InvoiceDocument.tsx')
assert(pdf.includes('data.machine.invoice_date || data.machine.specification_date'))
assert(pdf.includes('data.machine.specification_number || number'))
const documentRoute = source('src/app/api/documents/generate/route.ts')
assert(documentRoute.includes("query.eq('machine_id', parsed.machineId).neq('status', 'cancelled')"), 'Без invoiceId выбирается только активный инвойс')
assert(documentRoute.indexOf("query.eq('id', parsed.invoiceId)") < documentRoute.indexOf("query.eq('machine_id', parsed.machineId).neq('status', 'cancelled')"), 'Явно выбранный исторический инвойс остаётся доступен как PDF')

const finance = source('src/lib/actions/finance.ts')
assert(finance.includes('buildInvoicePaymentSchedule'))
assert(!finance.includes('addCalendarDays(shippingBaseDate, 7)'), 'Финансовый календарь не должен использовать фиксированные +7 дней')
assert(finance.includes('recordInvoicePayment'))
const telegram = source('src/app/api/telegram/webhook/route.ts')
assert(!/from\('invoices'\)\.update/iu.test(telegram), 'Telegram не должен обходить журнал платежей прямым UPDATE инвойса')

const managerDefaults = getDefaultPermissionMap('sales_manager')
const directorDefaults = getDefaultPermissionMap('commercial_director')
assert(hasPermission(managerDefaults, 'client_payments', 'manage'))
assert(hasPermission(directorDefaults, 'client_payments', 'manage'))
assert(hasPermission(directorDefaults, 'invoices', 'manage'))
assert(hasPermission(getFullPermissionMap(), 'client_payments', 'manage'))
assert.equal(getPermissionRequirementForPath('/sales/payments')?.resourceKey, 'client_payments')
assert.equal(getSidebarResources('sales_manager', managerDefaults, 'sales').at(-1)?.key, 'client_payments')

const resolved = resolveDepartmentPermissions(
  [{ departmentId: 'sales', departmentName: 'Sales', isDepartmentHead: false }],
  [
    { department_id: 'sales', subject_scope: 'member', resource_key: 'client_payments', can_view: true, can_manage: true, company_view_scope: 'all', company_manage_scope: 'own' },
    { department_id: 'sales', subject_scope: 'member', resource_key: 'invoices', can_view: true, can_manage: false, company_view_scope: 'own', company_manage_scope: 'own' },
  ],
)
assert.equal(resolved.companyScopes.client_payments?.view, 'all')
assert.equal(resolved.companyScopes.client_payments?.manage, 'own')
assert.equal(resolved.companyScopes.invoices?.view, 'own')

const manageAllResolved = resolveDepartmentPermissions(
  [{ departmentId: 'sales', departmentName: 'Sales', isDepartmentHead: false }],
  [{ department_id: 'sales', subject_scope: 'member', resource_key: 'invoices', can_view: true, can_manage: true, company_view_scope: 'own', company_manage_scope: 'all' }],
)
assert.equal(manageAllResolved.companyScopes.invoices?.view, 'all', 'Управление всеми компаниями включает их просмотр')

console.log('invoice-payments: OK')
