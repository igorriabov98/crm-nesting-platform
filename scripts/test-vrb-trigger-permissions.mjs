import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

if (!process.env.TEST_DATABASE_URL) {
  console.log('[vrb-trigger-permissions] skipped: TEST_DATABASE_URL is not set')
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adminUrl = new URL(process.env.TEST_DATABASE_URL)
assert.equal(adminUrl.protocol, 'postgresql:', 'TEST_DATABASE_URL must use postgresql://')
assert.ok(
  ['localhost', '127.0.0.1'].includes(adminUrl.hostname),
  'VRB trigger permission tests only use localhost or 127.0.0.1',
)

const databaseName = `vrb_trigger_permissions_${process.pid}_${Date.now()}`
const databaseUrl = new URL(adminUrl)
databaseUrl.pathname = `/${databaseName}`

run('createdb', ['--maintenance-db', adminUrl.toString(), databaseName])
try {
  psql(String.raw`
    DO $roles$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END;
    $roles$;

    CREATE TABLE public.machines (
      id uuid PRIMARY KEY,
      is_confirmed boolean NOT NULL DEFAULT false,
      is_archived boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.machine_items (
      id uuid PRIMARY KEY,
      machine_id uuid NOT NULL REFERENCES public.machines(id),
      quantity numeric NOT NULL DEFAULT 1
    );
    CREATE TABLE public.machine_outsourcing_operations (
      id uuid PRIMARY KEY,
      machine_id uuid NOT NULL REFERENCES public.machines(id),
      operation_kind text NOT NULL,
      delivery_dispatched_at date,
      archived_at timestamptz
    );
    CREATE TABLE public.machine_outsourcing_transport_orders (
      id uuid PRIMARY KEY,
      status text NOT NULL
    );
    CREATE TABLE public.machine_outsourcing_transport_needs (
      transport_order_id uuid NOT NULL REFERENCES public.machine_outsourcing_transport_orders(id),
      operation_id uuid NOT NULL REFERENCES public.machine_outsourcing_operations(id)
    );
    CREATE TABLE public.vrb_sync_audit (
      machine_id uuid NOT NULL,
      synced_by name NOT NULL
    );

    CREATE FUNCTION public.sync_vrb_mesh_for_machine(p_machine_id uuid)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $function$
    BEGIN
      INSERT INTO public.vrb_sync_audit(machine_id, synced_by)
      VALUES (p_machine_id, current_user);
    END;
    $function$;

    CREATE FUNCTION public.vrb_machine_change_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $function$
    BEGIN
      IF TG_TABLE_NAME = 'machines' THEN
        PERFORM public.sync_vrb_mesh_for_machine(NEW.id);
        RETURN NEW;
      END IF;
      PERFORM public.sync_vrb_mesh_for_machine(NEW.machine_id);
      RETURN NEW;
    END;
    $function$;

    CREATE FUNCTION public.vrb_operation_dispatch_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $function$
    BEGIN
      IF NEW.operation_kind = 'vrb_mesh'
         AND NEW.delivery_dispatched_at IS DISTINCT FROM OLD.delivery_dispatched_at THEN
        PERFORM public.sync_vrb_mesh_for_machine(NEW.machine_id);
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE FUNCTION public.vrb_transport_trip_status_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $function$
    DECLARE
      v_machine_id uuid;
    BEGIN
      IF NEW.status IS NOT DISTINCT FROM OLD.status
         OR NEW.status NOT IN ('in_transit', 'completed') THEN
        RETURN NEW;
      END IF;
      FOR v_machine_id IN
        SELECT DISTINCT operation.machine_id
        FROM public.machine_outsourcing_transport_needs AS need
        JOIN public.machine_outsourcing_operations AS operation
          ON operation.id = need.operation_id
        WHERE need.transport_order_id = NEW.id
          AND operation.operation_kind = 'vrb_mesh'
          AND operation.archived_at IS NULL
      LOOP
        PERFORM public.sync_vrb_mesh_for_machine(v_machine_id);
      END LOOP;
      RETURN NEW;
    END;
    $function$;

    CREATE TRIGGER machines_sync_vrb_mesh
      AFTER INSERT ON public.machines
      FOR EACH ROW EXECUTE FUNCTION public.vrb_machine_change_trigger();
    CREATE TRIGGER machine_items_sync_vrb_mesh
      AFTER INSERT ON public.machine_items
      FOR EACH ROW EXECUTE FUNCTION public.vrb_machine_change_trigger();
    CREATE TRIGGER machine_outsourcing_sync_vrb_after_carrier_dispatch
      AFTER UPDATE OF delivery_dispatched_at ON public.machine_outsourcing_operations
      FOR EACH ROW EXECUTE FUNCTION public.vrb_operation_dispatch_trigger();
    CREATE TRIGGER outsourcing_transport_order_sync_vrb_status
      AFTER UPDATE OF status ON public.machine_outsourcing_transport_orders
      FOR EACH ROW EXECUTE FUNCTION public.vrb_transport_trip_status_trigger();

    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
    REVOKE ALL ON FUNCTION public.sync_vrb_mesh_for_machine(uuid)
      FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON FUNCTION public.vrb_machine_change_trigger()
      FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON FUNCTION public.vrb_operation_dispatch_trigger()
      FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON FUNCTION public.vrb_transport_trip_status_trigger()
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.sync_vrb_mesh_for_machine(uuid)
      TO service_role;
  `)

  const beforeFix = runResult('psql', [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    databaseUrl.toString(),
  ], String.raw`
    SET ROLE authenticated;
    INSERT INTO public.machines(id)
    VALUES ('10000000-0000-0000-0000-000000000001');
  `)
  assert.notEqual(beforeFix.status, 0, 'The original invoker trigger unexpectedly succeeded')
  assert.match(
    `${beforeFix.stdout}\n${beforeFix.stderr}`,
    /permission denied for function sync_vrb_mesh_for_machine/u,
    'The regression setup did not reproduce the production permission error',
  )

  run('psql', [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    databaseUrl.toString(),
    '-f',
    path.join(root, 'supabase/migrations/20260905130000_fix_vrb_trigger_permissions.sql'),
  ])

  psql(String.raw`
    DO $assertions$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_proc AS procedure
        JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname IN (
            'vrb_machine_change_trigger',
            'vrb_operation_dispatch_trigger',
            'vrb_transport_trip_status_trigger'
          )
          AND (
            procedure.prosecdef IS DISTINCT FROM true
            OR NOT (COALESCE(procedure.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[])
          )
      ) THEN
        RAISE EXCEPTION 'a VRB trigger wrapper is not a locked SECURITY DEFINER function';
      END IF;
      IF has_function_privilege('authenticated', 'public.sync_vrb_mesh_for_machine(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated can execute the protected VRB sync directly';
      END IF;
      IF NOT has_function_privilege('service_role', 'public.sync_vrb_mesh_for_machine(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'service_role cannot execute the protected VRB sync';
      END IF;
    END;
    $assertions$;

    INSERT INTO public.machines(id)
    VALUES ('10000000-0000-0000-0000-000000000010');
    INSERT INTO public.machine_outsourcing_operations(
      id, machine_id, operation_kind
    ) VALUES (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000010',
      'vrb_mesh'
    );
    INSERT INTO public.machine_outsourcing_transport_orders(id, status)
    VALUES ('30000000-0000-0000-0000-000000000001', 'planned');
    INSERT INTO public.machine_outsourcing_transport_needs(transport_order_id, operation_id)
    VALUES (
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001'
    );

    SET ROLE authenticated;
    INSERT INTO public.machines(id)
    VALUES ('10000000-0000-0000-0000-000000000011');
    INSERT INTO public.machine_items(id, machine_id)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000011'
    );
    UPDATE public.machine_outsourcing_operations
    SET delivery_dispatched_at = current_date
    WHERE id = '20000000-0000-0000-0000-000000000001';
    UPDATE public.machine_outsourcing_transport_orders
    SET status = 'in_transit'
    WHERE id = '30000000-0000-0000-0000-000000000001';
    RESET ROLE;

    DO $assertions$
    BEGIN
      IF (SELECT count(*) FROM public.vrb_sync_audit) <> 5 THEN
        RAISE EXCEPTION 'not every VRB trigger path completed through the protected sync';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.vrb_sync_audit WHERE synced_by = 'authenticated'
      ) THEN
        RAISE EXCEPTION 'protected VRB sync ran with authenticated privileges';
      END IF;
    END;
    $assertions$;
  `)

  const directCall = runResult('psql', [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    databaseUrl.toString(),
  ], String.raw`
    SET ROLE authenticated;
    SELECT public.sync_vrb_mesh_for_machine(
      '10000000-0000-0000-0000-000000000011'
    );
  `)
  assert.notEqual(directCall.status, 0, 'authenticated directly executed the protected VRB sync')
  assert.match(`${directCall.stdout}\n${directCall.stderr}`, /permission denied/u)

  console.log('[vrb-trigger-permissions] trigger privilege assertions passed')
} finally {
  run('dropdb', ['--if-exists', '--maintenance-db', adminUrl.toString(), databaseName])
}

function psql(sql) {
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString()], sql)
}

function run(command, args, input) {
  const result = runResult(command, args, input)
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
  }
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}

function runResult(command, args, input) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    input,
  })
}
