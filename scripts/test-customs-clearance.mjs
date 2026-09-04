import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [foundation, automation, resources, taskActions, pageActions, generationRoute, uploadRoute, salesActions, workspace] = await Promise.all([
  read('supabase/migrations/20260904120000_customs_clearance_foundation.sql'),
  read('supabase/migrations/20260904121000_customs_clearance_task_automation.sql'),
  read('src/lib/permissions/resources.ts'),
  read('src/lib/actions/tasks.ts'),
  read('src/lib/actions/customs-clearance.ts'),
  read('src/app/api/customs-clearance/documents/generate/route.ts'),
  read('src/app/api/customs-clearance/upload-url/route.ts'),
  read('src/app/(protected)/sales-plan/actions.ts'),
  read('src/components/features/customs-clearance/CustomsClearanceWorkspace.tsx'),
])

assert.match(foundation, /'Начальник Брокерского отдела', 2/)
assert.match(foundation, /'Брокер', 0/)
assert.match(foundation, /'customs_clearance', 'all'/)
assert.match(foundation, /machine_customs_documents_service_role/)
assert.match(foundation, /REVOKE ALL ON TABLE public\.machine_customs_documents FROM PUBLIC, anon, authenticated/)
assert.match(foundation, /'customs-clearance-files'[\s\S]*false,[\s\S]*26214400/)
assert.match(automation, /COALESCE\(stage\.date_end, stage\.planned_date_end\)/)
assert.match(automation, /v_deadline := v_shipping_date - 2/)
assert.match(automation, /v_has_document THEN[\s\S]*status = 'completed'/)
assert.match(automation, /IF v_head_user_id IS NULL|v_head_user_id IS NULL/)
assert.match(automation, /AFTER INSERT OR DELETE ON public\.machine_customs_documents/)
assert.match(automation, /trg_guard_customs_clearance_task_terminal_status/)
assert.match(resources, /key: 'customs_clearance'[\s\S]*defaultViewRoles: \[\][\s\S]*supportsFactoryScope: true/)
assert.match(taskActions, /taskRow\.task_type === 'customs_clearance'[\s\S]*закрывается автоматически/)
assert.match(pageActions, /update\(\{ customs_clearance_date: date \}\)/)
assert.match(pageActions, /requirePermission\('customs_clearance', 'manage'\)/)
assert.match(generationRoute, /getTrustedDocumentData\(input\.machineId\)/)
assert.doesNotMatch(generationRoute, /from\(['"]invoices['"]\)|getInvoiceDocumentData|createInvoiceDocumentSnapshot/)
assert.match(uploadRoute, /assertFactoryAccess\(context, 'customs_clearance', 'manage'/)
assert.match(salesActions, /customs_clearance_date: parsed\.customs_clearance_date/)
assert.match(salesActions, /revalidatePath\(ROUTES\.CUSTOMS_CLEARANCE\)/)
assert.match(workspace, /Не хватает: \{state\.missing\.join/)
assert.match(workspace, /PDF скачивается и не считается прикреплённым документом/)

console.log('customs clearance source and security checks passed')
