import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile('supabase/migrations/20260914180000_commercial_visibility_and_order_codes.sql', 'utf8')
const cutover = await readFile('supabase/migrations/20260916090000_department_rls_matrix_cutover.sql', 'utf8')
const actions = await readFile('src/app/(protected)/sales-plan/actions.ts', 'utf8')
const documents = await readFile('src/app/api/documents/generate/route.ts', 'utf8')
const resources = await readFile('src/lib/permissions/resources.ts', 'utf8')
const productActions = await readFile('src/lib/actions/products.ts', 'utf8')
const productList = await readFile('src/components/features/products/ProductList.tsx', 'utf8')
const productForm = await readFile('src/components/features/products/ProductForm.tsx', 'utf8')
const productDetails = await readFile('src/app/(protected)/products/[id]/page.tsx', 'utf8')
const clientActions = await readFile('src/lib/actions/clients.ts', 'utf8')
const commercialVisibility = await readFile('src/lib/permissions/commercial-visibility.ts', 'utf8')
const protectedFileRoutes = await Promise.all([
  'src/app/api/machine-cutting/files/[id]/route.ts',
  'src/app/api/production/cutting-area/archives/[id]/route.ts',
  'src/app/api/production/cutting-area/cutting-plans/[versionId]/route.ts',
  'src/app/api/production/cutting-area/files/[kind]/[id]/route.ts',
].map((file) => readFile(file, 'utf8')))

assert.match(migration, /clients_commercial_select[\s\S]*responsible_user_id = auth\.uid\(\)[\s\S]*crm_user_is_admin/)
assert.match(migration, /client_contacts_commercial_select/)
assert.match(migration, /get_client_identity_projection/)
assert.match(migration, /Europe\/Uzhgorod/)
assert.match(migration, /crm_uzhgorod_year[\s\S]*Europe\/Kyiv[\s\S]*Etc\/GMT-2/)
assert.match(migration, /ON CONFLICT \(creation_year\) DO UPDATE[\s\S]*last_number = public\.order_annual_counters\.last_number \+ 1/)
assert.match(migration, /IF NEW\.client_id IS NULL THEN RETURN NEW; END IF;/)
assert.match(migration, /BEFORE UPDATE OF client_id[\s\S]*refresh_machine_order_code_client_prefix/)
assert.match(migration, /REVOKE SELECT ON public\.machines_with_totals FROM authenticated/)
assert.match(migration, /column_name <> 'price'/)
assert.match(migration, /column_name <> 'amount'/)
assert.match(migration, /REVOKE ALL ON public\.client_product_prices FROM authenticated/)

assert.match(resources, /key: 'client_identity'[\s\S]*viewOnly: true/)
assert.match(resources, /key: 'client_prices'[\s\S]*label: 'Цены заказов'[\s\S]*supportsCompanyScope: true/)
assert.match(actions, /price: commercial\?\.canViewOrderPrices \? item\.price : null/)
assert.match(actions, /total_cost: commercial\?\.canViewOrderPrices \? totalBeforeDiscount - approvedDiscountAmount : null/)
assert.match(actions, /Создавать заказ можно только для своей компании/)
assert.doesNotMatch(actions, /name: parsed\.name/)
assert.match(documents, /requireClientCommercialDocumentVisibility/)
assert.match(documents, /PermissionDeniedError[\s\S]*403/)
assert.match(productActions, /PRODUCT_SAFE_COLUMNS[\s\S]*attachProtectedProductPrices[\s\S]*base_price_eur: null/)
assert.match(productActions, /fn_get_product_base_prices/)
assert.match(productActions, /fn_set_product_base_price/)
assert.doesNotMatch(productActions, /getProducts\(\)[\s\S]{0,500}select\('\*, product_files\(\*\)'\)/)
assert.match(cutover, /REVOKE SELECT, INSERT, UPDATE ON public\.products FROM authenticated/)
assert.match(cutover, /column_name <> 'base_price_eur'/)
assert.match(cutover, /private\.crm_has_permission\('client_prices', 'view'\)/)
assert.match(cutover, /private\.crm_has_permission\('client_prices', 'manage'\)/)
assert.doesNotMatch(productList, />Цена<\/th>/, 'Базовая цена не должна отображаться в списке изделий')
assert.doesNotMatch(productForm, /label="Базовая цена"|htmlFor="base_price_eur"/, 'Базовая цена не должна отображаться или редактироваться в карточке изделия')
assert.doesNotMatch(productDetails, /Базовая цена|canViewProductPrices/, 'Базовая цена не должна отображаться в сводке изделия')
assert.match(clientActions, /export async function getClientOptions\(\)[\s\S]*requireClientPermission\('view'\)/)
assert.doesNotMatch(clientActions, /export async function getClientOptions\(\)[\s\S]*requirePermission\('client_identity', 'view'\)/)
assert.match(commercialVisibility, /export async function requireClientCardAccess\([\s\S]*hasPermission\(resolvedContext\.permissions, 'clients', 'view'\)/)
assert.match(commercialVisibility, /responsible_user_id !== resolvedContext\.userId/)
for (const route of protectedFileRoutes) {
  assert.match(route, /requireClientCommercialDocumentVisibility/)
  assert.match(route, /PermissionDeniedError[\s\S]*403/)
}

console.log('commercial visibility assertions: ok')
