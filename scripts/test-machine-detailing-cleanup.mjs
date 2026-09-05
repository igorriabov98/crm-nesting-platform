import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

if (!process.env.TEST_DATABASE_URL) {
  console.log('[machine-detailing-cleanup] skipped: TEST_DATABASE_URL is not set')
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adminUrl = new URL(process.env.TEST_DATABASE_URL)
assert.equal(adminUrl.protocol, 'postgresql:', 'TEST_DATABASE_URL must use postgresql://')
assert.ok(
  ['localhost', '127.0.0.1'].includes(adminUrl.hostname),
  'Machine detailing cleanup tests only use localhost or 127.0.0.1',
)

const databaseName = `machine_detailing_cleanup_test_${process.pid}_${Date.now()}`
const databaseUrl = new URL(adminUrl)
databaseUrl.pathname = `/${databaseName}`

run('createdb', ['--maintenance-db', adminUrl.toString(), databaseName])
try {
  psql(String.raw`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE SCHEMA auth;

    DO $roles$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END;
    $roles$;

    CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    CREATE TABLE public.machines (
      id uuid PRIMARY KEY,
      created_by uuid NOT NULL,
      archived_by uuid
    );

    CREATE TABLE public.machine_items (
      id uuid PRIMARY KEY,
      machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE
    );

    CREATE TABLE public.detailing_balances (
      part_id uuid NOT NULL,
      factory_id uuid NOT NULL,
      reserved_quantity integer NOT NULL,
      updated_by uuid NOT NULL,
      PRIMARY KEY (part_id, factory_id)
    );

    CREATE TABLE public.detailing_reservations (
      id uuid PRIMARY KEY,
      machine_id uuid NOT NULL,
      machine_item_id uuid NOT NULL,
      part_id uuid NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE public.detailing_reservation_allocations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reservation_id uuid NOT NULL,
      factory_id uuid NOT NULL,
      quantity integer NOT NULL
    );

    CREATE FUNCTION public.detailing_release_reservation_internal(
      p_reservation_id uuid,
      p_actor uuid,
      p_reason text,
      p_cancelled boolean DEFAULT false
    ) RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      v_reservation public.detailing_reservations%ROWTYPE;
      v_allocation public.detailing_reservation_allocations%ROWTYPE;
    BEGIN
      SELECT * INTO STRICT v_reservation
      FROM public.detailing_reservations
      WHERE id = p_reservation_id;

      FOR v_allocation IN
        SELECT * FROM public.detailing_reservation_allocations
        WHERE reservation_id = p_reservation_id AND quantity > 0
      LOOP
        UPDATE public.detailing_balances
        SET reserved_quantity = reserved_quantity - v_allocation.quantity,
            updated_by = p_actor
        WHERE part_id = v_reservation.part_id
          AND factory_id = v_allocation.factory_id;
      END LOOP;

      UPDATE public.detailing_reservations
      SET status = CASE WHEN p_cancelled THEN 'cancelled' ELSE status END
      WHERE id = p_reservation_id;
      RETURN 1;
    END;
    $$;

    CREATE FUNCTION public.detailing_machine_item_change_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      v_actor uuid;
      v_reservation record;
    BEGIN
      v_actor := public.detailing_system_actor(OLD.machine_id);
      FOR v_reservation IN
        SELECT id FROM public.detailing_reservations
        WHERE machine_item_id = OLD.id AND status IN ('active', 'partially_consumed')
      LOOP
        PERFORM public.detailing_release_reservation_internal(
          v_reservation.id, v_actor, 'Связанная строка изделия удалена', true
        );
      END LOOP;
      RETURN OLD;
    END;
    $$;
  `)

  run('psql', [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    databaseUrl.toString(),
    '-f',
    path.join(root, 'supabase/migrations/20260905100000_fix_detailing_actor_during_machine_cleanup.sql'),
  ])

  psql(String.raw`
    CREATE TRIGGER detailing_machine_item_before_delete
      BEFORE DELETE ON public.machine_items
      FOR EACH ROW EXECUTE FUNCTION public.detailing_machine_item_change_trigger();

    INSERT INTO public.machines(id, created_by)
    VALUES ('10000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001');
    INSERT INTO public.machine_items(id, machine_id)
    VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
    INSERT INTO public.detailing_balances(part_id, factory_id, reserved_quantity, updated_by)
    VALUES (
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      5,
      '90000000-0000-0000-0000-000000000001'
    );
    INSERT INTO public.detailing_reservations(id, machine_id, machine_item_id, part_id, status)
    VALUES (
      '50000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      'active'
    );
    INSERT INTO public.detailing_reservation_allocations(reservation_id, factory_id, quantity)
    VALUES (
      '50000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      5
    );

    SELECT set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', false);
    DELETE FROM public.machines WHERE id = '10000000-0000-0000-0000-000000000001';

    DO $assertions$
    BEGIN
      IF (SELECT reserved_quantity FROM public.detailing_balances) <> 0 THEN
        RAISE EXCEPTION 'Detailing reservation was not released during machine delete';
      END IF;
      IF (SELECT updated_by FROM public.detailing_balances) <> '90000000-0000-0000-0000-000000000002'::uuid THEN
        RAISE EXCEPTION 'Authenticated delete actor was not preserved';
      END IF;
      IF (SELECT status FROM public.detailing_reservations) <> 'cancelled' THEN
        RAISE EXCEPTION 'Detailing reservation was not cancelled';
      END IF;
    END;
    $assertions$;
  `)

  console.log('[machine-detailing-cleanup] cascading delete actor assertions passed')
} finally {
  run('dropdb', ['--if-exists', '--maintenance-db', adminUrl.toString(), databaseName])
}

function psql(sql) {
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString()], sql)
}

function run(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    input,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
  }
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}
