import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const adminUrl = new URL(process.env.TEST_DATABASE_URL || 'postgresql://igorrabov@localhost/postgres')
assert.equal(adminUrl.protocol, 'postgresql:')
assert.ok(['localhost', '127.0.0.1'].includes(adminUrl.hostname), 'DB checks only use a local PostgreSQL server')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseName = `commercial_visibility_${process.pid}_${Date.now()}`
const databaseUrl = new URL(adminUrl)
databaseUrl.pathname = `/${databaseName}`

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', input })
  if (result.status !== 0) process.stderr.write(`${result.stdout || ''}${result.stderr || ''}`)
  assert.equal(result.status, 0, `${command} exited with ${result.status}`)
  return result.stdout
}

function psql(sql, tuplesOnly = false) {
  const args = ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString()]
  if (tuplesOnly) args.push('-qAt')
  return run('psql', args, sql).trim()
}

function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString()], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout)))
    child.stdin.end(sql)
  })
}

const setup = String.raw`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';

CREATE TABLE public.users(id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.positions(id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.departments(id uuid PRIMARY KEY);
CREATE TABLE public.department_members(
  user_id uuid NOT NULL REFERENCES public.users(id), department_id uuid NOT NULL REFERENCES public.departments(id),
  position_id uuid REFERENCES public.positions(id), is_department_head boolean NOT NULL DEFAULT false,
  PRIMARY KEY(user_id, department_id)
);
CREATE TABLE public.role_permissions(
  role text NOT NULL, resource_key text NOT NULL, can_view boolean NOT NULL DEFAULT false,
  can_manage boolean NOT NULL DEFAULT false, PRIMARY KEY(role, resource_key)
);
CREATE TABLE public.department_access_permissions(
  department_id uuid NOT NULL, subject_scope text NOT NULL, resource_key text NOT NULL,
  can_view boolean NOT NULL DEFAULT false, can_manage boolean NOT NULL DEFAULT false,
  factory_scope text NOT NULL DEFAULT 'own', company_view_scope text NOT NULL DEFAULT 'own',
  company_manage_scope text NOT NULL DEFAULT 'own',
  PRIMARY KEY(department_id, subject_scope, resource_key)
);
CREATE TABLE public.clients(
  id uuid PRIMARY KEY, name text NOT NULL, responsible_user_id uuid REFERENCES public.users(id)
);
CREATE TABLE public.client_contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES public.clients(id), name text);
CREATE TABLE public.machines(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, client_id uuid NOT NULL REFERENCES public.clients(id),
  created_by uuid REFERENCES public.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.machine_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), machine_id uuid, product_name text, price numeric);
CREATE TABLE public.machine_expenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), machine_id uuid, category text, amount numeric);
CREATE TABLE public.client_product_prices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid, price_eur numeric);
ALTER TABLE public.client_product_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_product_prices_select ON public.client_product_prices FOR SELECT TO authenticated USING (true);
CREATE VIEW public.machines_with_totals AS
SELECT machine.id, machine.name, 0::numeric AS freight_cost,
       COALESCE(SUM(item.price), 0)::numeric AS total_items_cost,
       0::numeric AS total_expenses, COALESCE(SUM(item.price), 0)::numeric AS total_cost
FROM public.machines machine LEFT JOIN public.machine_items item ON item.machine_id = machine.id
GROUP BY machine.id, machine.name;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON public.machines_with_totals TO authenticated, service_role;

INSERT INTO public.users(id) VALUES
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000004'),
  ('10000000-0000-0000-0000-000000000005');
INSERT INTO public.positions(id,name) VALUES ('20000000-0000-0000-0000-000000000001','Администратор CRM');
INSERT INTO public.departments(id) VALUES ('30000000-0000-0000-0000-000000000001');
INSERT INTO public.department_members(user_id,department_id,position_id) VALUES
  ('10000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001',NULL);
INSERT INTO public.role_permissions(role,resource_key) VALUES ('sales_manager','sales_plan');
INSERT INTO public.clients(id,name,responsible_user_id) VALUES
  ('40000000-0000-0000-0000-000000000001','«Леда» Металл','10000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002','AB','10000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000003','Леда-Металл','10000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000004','Без владельца',NULL);
INSERT INTO public.machines(name,client_id,created_by,created_at) VALUES
  ('Исторический 1','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',now()),
  ('Исторический 2','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',now());
`

run('createdb', ['--maintenance-db', adminUrl.toString(), databaseName])
try {
  psql(setup)
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260914180000_commercial_visibility_and_order_codes.sql')])

  const aliases = psql("SELECT string_agg(public_alias, '|' ORDER BY id) FROM public.clients", true)
  assert.equal(aliases, 'ЛЕД.МЕТ|AB|ЛЕД.МЕТ|БЕЗ.ВЛА')

  const year = new Date().toLocaleString('en-US', { timeZone: 'Europe/Uzhgorod', year: 'numeric' })
  const firstCode = psql(String.raw`
    SET ROLE authenticated; SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
    INSERT INTO public.machines(name,client_id,created_by)
    VALUES ('ignored','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001') RETURNING name;
  `, true).split('\n').at(-1)
  assert.equal(firstCode, `ЛЕД.МЕТ-3-${year}`)

  psql("DELETE FROM public.machines WHERE name LIKE 'ЛЕД.МЕТ-3-%'")
  const afterDeleteCode = psql(String.raw`
    SET ROLE authenticated; SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
    INSERT INTO public.machines(name,client_id,created_by)
    VALUES ('ignored','40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001') RETURNING name;
  `, true).split('\n').at(-1)
  assert.equal(afterDeleteCode, `AB-4-${year}`)

  await Promise.all([
    psqlAsync("SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001'; INSERT INTO public.machines(name,client_id,created_by) VALUES ('x','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');"),
    psqlAsync("SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001'; INSERT INTO public.machines(name,client_id,created_by) VALUES ('x','40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');"),
  ])
  assert.equal(psql('SELECT COUNT(DISTINCT annual_order_number) FROM public.machines WHERE annual_order_number IS NOT NULL', true), '3')
  assert.equal(psql(`SELECT max(annual_order_number) FROM public.machines WHERE creation_year=${year}`, true), '6')

  psql(String.raw`
    SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
    UPDATE public.machines SET client_id='40000000-0000-0000-0000-000000000002' WHERE annual_order_number=5;
  `)
  assert.match(psql('SELECT name FROM public.machines WHERE annual_order_number=5', true), new RegExp(`^AB-5-${year}$`))

  const unauthorized = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString()], {
    encoding: 'utf8',
    input: "SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000002'; INSERT INTO public.machines(name,client_id,created_by) VALUES ('x','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');",
  })
  assert.notEqual(unauthorized.status, 0)
  assert.match(unauthorized.stderr, /чужой компании/)

  psql("UPDATE public.users SET is_active=false WHERE id='10000000-0000-0000-0000-000000000001'")
  const inactiveVisible = psql(String.raw`
    SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
    SELECT count(*) FROM public.clients;
  `, true).split('\n').at(-1)
  assert.equal(inactiveVisible, '0')
  psql("UPDATE public.users SET is_active=true WHERE id='10000000-0000-0000-0000-000000000001'")

  psql("UPDATE public.department_access_permissions SET can_view=true, company_view_scope='all' WHERE department_id='30000000-0000-0000-0000-000000000001' AND subject_scope='member' AND resource_key='client_identity'")
  const projection = psql(String.raw`
    SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000004';
    SELECT display_name FROM public.get_client_identity_projection() WHERE client_id='40000000-0000-0000-0000-000000000001';
  `, true).split('\n').at(-1)
  assert.equal(projection, '«Леда» Металл')

  const adminClientCount = psql(String.raw`
    SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000003';
    SELECT count(*) FROM public.clients;
  `, true).split('\n').at(-1)
  assert.equal(adminClientCount, '4')

  psql("UPDATE public.clients SET responsible_user_id='10000000-0000-0000-0000-000000000002' WHERE id='40000000-0000-0000-0000-000000000001'")
  const transferredAccess = psql(String.raw`
    SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
    SELECT count(*) FROM public.clients WHERE id='40000000-0000-0000-0000-000000000001';
    RESET ROLE; RESET request.jwt.claim.sub;
    SET ROLE authenticated; SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000002';
    SELECT count(*) FROM public.clients WHERE id='40000000-0000-0000-0000-000000000001';
  `, true).split('\n').filter((line) => /^\d+$/.test(line))
  assert.deepEqual(transferredAccess, ['0', '1'])

  const privileges = psql(String.raw`
    SELECT has_column_privilege('authenticated','public.machine_items','price','SELECT'),
           has_column_privilege('authenticated','public.machine_items','price','UPDATE'),
           has_column_privilege('authenticated','public.machine_expenses','amount','SELECT'),
           has_column_privilege('authenticated','public.machines_with_totals','total_items_cost','SELECT'),
           has_column_privilege('authenticated','public.machines_with_totals','total_expenses','SELECT'),
           has_column_privilege('authenticated','public.machines_with_totals','freight_cost','SELECT'),
           has_column_privilege('authenticated','public.machines_with_totals','total_cost','SELECT'),
           has_table_privilege('authenticated','public.client_product_prices','SELECT'),
           has_column_privilege('authenticated','public.machine_items','product_name','SELECT');
  `, true)
  assert.equal(privileges, 'f|f|f|f|f|f|f|f|t')

  console.log('commercial visibility database assertions: ok')
} finally {
  run('dropdb', ['--if-exists', '--maintenance-db', adminUrl.toString(), databaseName])
}
