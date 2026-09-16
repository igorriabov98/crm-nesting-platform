import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = process.cwd()
const policyPath = join(root, 'supabase/reports/rls_dependency_affected_tables_policy_snapshot.json')
const functionPath = join(root, 'supabase/reports/rls_legacy_function_snapshot.json')
const policies = JSON.parse(readFileSync(policyPath, 'utf8'))
const functions = JSON.parse(readFileSync(functionPath, 'utf8'))
const outputPath = join(root, 'supabase/rollback/20260916090000_department_rls_matrix_cutover.sql')

const quoteIdent = (value) => `"${String(value).replaceAll('"', '""')}"`
const rolesSql = (roles) => roles.slice(1, -1).split(',').filter(Boolean).join(', ')

function policySql(policy) {
  const permissive = policy.permissive === 'RESTRICTIVE' ? 'AS RESTRICTIVE ' : ''
  const using = policy.qual ? `\nUSING (${policy.qual})` : ''
  const check = policy.with_check ? `\nWITH CHECK (${policy.with_check})` : ''
  return `DROP POLICY IF EXISTS ${quoteIdent(policy.policyname)} ON public.${quoteIdent(policy.tablename)};\nCREATE POLICY ${quoteIdent(policy.policyname)} ON public.${quoteIdent(policy.tablename)}\n${permissive}FOR ${policy.cmd} TO ${rolesSql(policy.roles)}${using}${check};`
}

function functionSql(entry) {
  return `${entry.definition.replace(/[ \t]+$/gm, '').trim()};`
}

const policyChecksum = createHash('sha256').update(readFileSync(policyPath)).digest('hex')
const functionChecksum = createHash('sha256').update(readFileSync(functionPath)).digest('hex')
const tables = [...new Set(policies.policies.map((policy) => policy.tablename))].sort()
const locks = tables.map((table) => `    '${table.replaceAll("'", "''")}'`).join(',\n')

const sql = `-- Operator-confirmed rollback for 20260916090000 only.
-- policy-snapshot-sha256: ${policyChecksum}
-- function-snapshot-sha256: ${functionChecksum}
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SELECT pg_advisory_xact_lock(hashtextextended('crm:department-rls-matrix-cutover:v1', 0));

DO $locks$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
${locks}
  ] LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', v_table);
  END LOOP;
END;
$locks$;

${functions.functions.map(functionSql).join('\n\n')}

${policies.policies.map(policySql).join('\n\n')}

DO $restore_acl$
DECLARE
  item record;
  v_grantee text;
  v_grant_option text;
  v_security_invoker text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
  ) THEN
    RAISE EXCEPTION 'Exact cutover ACL snapshot is missing';
  END IF;

  -- Remove cutover relation and column grants from the roles that were changed.
  FOR item IN
    SELECT namespace.nspname, relation.relname, attribute.attname
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('products', 'role_permissions', 'machines_with_totals')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE %2$I.%3$I FROM PUBLIC, anon, authenticated, service_role',
      item.attname, item.nspname, item.relname
    );
  END LOOP;
  FOR item IN
    SELECT DISTINCT object_identity
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind IN ('relation_acl', 'view_options')
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated, service_role',
      item.object_identity
    );
  END LOOP;

  FOR item IN
    SELECT object_identity, payload
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind = 'relation_acl'
  LOOP
    v_grantee := CASE item.payload->>'grantee' WHEN 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', item.payload->>'grantee') END;
    v_grant_option := CASE WHEN (item.payload->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
    EXECUTE format(
      'GRANT %s ON TABLE %s TO %s%s',
      item.payload->>'privilege', item.object_identity, v_grantee, v_grant_option
    );
  END LOOP;
  FOR item IN
    SELECT object_identity, payload
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind = 'column_acl'
  LOOP
    v_grantee := CASE item.payload->>'grantee' WHEN 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', item.payload->>'grantee') END;
    v_grant_option := CASE WHEN (item.payload->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
    EXECUTE format(
      'GRANT %s (%I) ON TABLE %s TO %s%s',
      item.payload->>'privilege', item.payload->>'column', item.object_identity, v_grantee, v_grant_option
    );
  END LOOP;

  -- CREATE OR REPLACE preserves function OIDs, but grants are restored from the
  -- exact pre-cutover ACL rather than reconstructed from assumed defaults.
  FOR item IN
    SELECT DISTINCT object_identity
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind = 'function_acl'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      item.object_identity
    );
  END LOOP;
  FOR item IN
    SELECT object_identity, payload
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind = 'function_acl'
  LOOP
    v_grantee := CASE item.payload->>'grantee' WHEN 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', item.payload->>'grantee') END;
    v_grant_option := CASE WHEN (item.payload->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
    EXECUTE format(
      'GRANT %s ON FUNCTION %s TO %s%s',
      item.payload->>'privilege', item.object_identity, v_grantee, v_grant_option
    );
  END LOOP;

  ALTER VIEW public.machines_with_totals RESET (security_invoker);
  SELECT option_value INTO v_security_invoker
  FROM private.rls_cutover_object_snapshot AS snapshot
  CROSS JOIN LATERAL jsonb_array_elements_text(snapshot.payload->'reloptions') AS option_value
  WHERE snapshot.cutover_key = '20260916090000_department_rls_matrix_cutover'
    AND snapshot.object_kind = 'view_options'
    AND option_value LIKE 'security_invoker=%'
  LIMIT 1;
  IF v_security_invoker IS NOT NULL THEN
    EXECUTE format(
      'ALTER VIEW public.machines_with_totals SET (security_invoker = %s)',
      split_part(v_security_invoker, '=', 2)
    );
  END IF;

  REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
  FOR item IN
    SELECT object_identity, payload
    FROM private.rls_cutover_object_snapshot
    WHERE cutover_key = '20260916090000_department_rls_matrix_cutover'
      AND object_kind = 'schema_acl'
  LOOP
    v_grantee := CASE item.payload->>'grantee' WHEN 'PUBLIC' THEN 'PUBLIC' ELSE format('%I', item.payload->>'grantee') END;
    v_grant_option := CASE WHEN (item.payload->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
    EXECUTE format(
      'GRANT %s ON SCHEMA %s TO %s%s',
      item.payload->>'privilege', item.object_identity, v_grantee, v_grant_option
    );
  END LOOP;
END;
$restore_acl$;

DROP POLICY IF EXISTS "department_access_permissions_select_matrix"
  ON public.department_access_permissions;
DROP POLICY IF EXISTS "department_access_audit_log_select_matrix"
  ON public.department_access_audit_log;
CREATE POLICY "department_access_permissions_select_authenticated"
  ON public.department_access_permissions
  FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "department_access_audit_log_select_authenticated"
  ON public.department_access_audit_log
  FOR SELECT TO authenticated
  USING (true);

DROP FUNCTION IF EXISTS public.fn_save_department_access_permissions(jsonb);
DROP FUNCTION IF EXISTS public.fn_get_product_base_prices(uuid[]);
DROP FUNCTION IF EXISTS public.fn_set_product_base_price(uuid, numeric);
DROP FUNCTION IF EXISTS private.crm_has_company_permission(text, text, uuid);
DROP FUNCTION IF EXISTS private.crm_has_factory_permission(text, text, uuid);
DROP FUNCTION IF EXISTS private.crm_has_permission(text, text);

ALTER TABLE public.department_access_permissions
  DROP CONSTRAINT IF EXISTS department_access_permissions_factory_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_permissions_company_view_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_permissions_company_manage_scope_check;
ALTER TABLE public.department_access_permissions
  ADD CONSTRAINT department_access_permissions_factory_scope_check
    CHECK (factory_scope IN ('own', 'all') AND (factory_scope = 'own' OR resource_key IN ('production_cutting_area', 'customs_clearance'))),
  ADD CONSTRAINT department_access_permissions_company_view_scope_check
    CHECK (company_view_scope IN ('own', 'all') AND (company_view_scope = 'own' OR resource_key IN ('invoices', 'client_payments'))),
  ADD CONSTRAINT department_access_permissions_company_manage_scope_check
    CHECK (company_manage_scope IN ('own', 'all') AND (company_manage_scope = 'own' OR resource_key IN ('invoices', 'client_payments')));

COMMIT;
`

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, sql)
console.log(`Generated rollback for ${policies.policies.length} policies and ${functions.functions.length} functions`)
