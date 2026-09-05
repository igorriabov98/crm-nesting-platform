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
      archived_by uuid,
      is_archived boolean NOT NULL DEFAULT false
    );

    CREATE TABLE public.machine_items (
      id uuid PRIMARY KEY,
      machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE
    );

    CREATE TABLE public.detailing_balances (
      part_id uuid NOT NULL,
      factory_id uuid NOT NULL,
      on_hand_quantity integer NOT NULL,
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

    CREATE TYPE public.detailing_movement_type AS ENUM ('unreserve');

    CREATE TABLE public.detailing_movements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      part_id uuid NOT NULL,
      factory_id uuid NOT NULL,
      movement_type public.detailing_movement_type NOT NULL,
      quantity_delta integer NOT NULL,
      reserved_delta integer NOT NULL,
      on_hand_after integer NOT NULL,
      reserved_after integer NOT NULL,
      machine_id uuid REFERENCES public.machines(id) ON DELETE SET NULL,
      reservation_id uuid,
      transfer_id uuid,
      production_fact_id uuid,
      performed_by uuid NOT NULL,
      comment text
    );

    CREATE FUNCTION public.detailing_record_movement(
      p_part_id uuid,
      p_factory_id uuid,
      p_type public.detailing_movement_type,
      p_quantity_delta integer,
      p_reserved_delta integer,
      p_actor uuid,
      p_machine_id uuid DEFAULT NULL,
      p_reservation_id uuid DEFAULT NULL,
      p_transfer_id uuid DEFAULT NULL,
      p_production_fact_id uuid DEFAULT NULL,
      p_comment text DEFAULT NULL
    ) RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      v_balance public.detailing_balances%ROWTYPE;
      v_id uuid;
    BEGIN
      SELECT * INTO v_balance
      FROM public.detailing_balances
      WHERE part_id = p_part_id AND factory_id = p_factory_id;

      INSERT INTO public.detailing_movements (
        part_id, factory_id, movement_type, quantity_delta, reserved_delta,
        on_hand_after, reserved_after, machine_id, reservation_id, transfer_id,
        production_fact_id, performed_by, comment
      ) VALUES (
        p_part_id, p_factory_id, p_type, p_quantity_delta, p_reserved_delta,
        v_balance.on_hand_quantity, v_balance.reserved_quantity, p_machine_id,
        p_reservation_id, p_transfer_id, p_production_fact_id, p_actor, p_comment
      ) RETURNING id INTO v_id;
      RETURN v_id;
    END;
    $$;

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

        PERFORM public.detailing_record_movement(
          v_reservation.part_id,
          v_allocation.factory_id,
          'unreserve',
          0,
          -v_allocation.quantity,
          p_actor,
          v_reservation.machine_id,
          v_reservation.id,
          NULL,
          NULL,
          p_reason
        );
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

    CREATE FUNCTION public.detailing_machine_change_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      v_actor uuid;
      v_reservation record;
    BEGIN
      v_actor := COALESCE(auth.uid(), NEW.archived_by, NEW.created_by);
      IF NEW.is_archived AND NOT OLD.is_archived THEN
        FOR v_reservation IN
          SELECT id FROM public.detailing_reservations
          WHERE machine_id = NEW.id AND status IN ('active', 'partially_consumed')
        LOOP
          PERFORM public.detailing_release_reservation_internal(
            v_reservation.id, v_actor, 'Заказ архивирован', true
          );
        END LOOP;
      END IF;
      RETURN NEW;
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
    '-f',
    path.join(root, 'supabase/migrations/20260905110000_fix_detailing_movement_during_machine_cleanup.sql'),
  ])

  psql(String.raw`
    CREATE TRIGGER detailing_machine_item_before_delete
      BEFORE DELETE ON public.machine_items
      FOR EACH ROW EXECUTE FUNCTION public.detailing_machine_item_change_trigger();
    CREATE TRIGGER detailing_machine_change
      AFTER UPDATE OF is_archived ON public.machines
      FOR EACH ROW EXECUTE FUNCTION public.detailing_machine_change_trigger();

    INSERT INTO public.machines(id, created_by)
    VALUES ('10000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001');
    INSERT INTO public.machine_items(id, machine_id)
    VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
    INSERT INTO public.detailing_balances(part_id, factory_id, on_hand_quantity, reserved_quantity, updated_by)
    VALUES (
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      10,
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
      IF (SELECT count(*) FROM public.detailing_movements) <> 1 THEN
        RAISE EXCEPTION 'Detailing movement was not recorded during machine delete';
      END IF;
      IF (SELECT machine_id FROM public.detailing_movements) IS NOT NULL THEN
        RAISE EXCEPTION 'Deleted machine must not remain on detailing movement';
      END IF;
      IF (SELECT performed_by FROM public.detailing_movements) <> '90000000-0000-0000-0000-000000000002'::uuid THEN
        RAISE EXCEPTION 'Delete actor was not preserved on detailing movement';
      END IF;
    END;
    $assertions$;

    INSERT INTO public.machines(id, created_by)
    VALUES ('10000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001');
    INSERT INTO public.machine_items(id, machine_id)
    VALUES ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002');
    UPDATE public.detailing_balances
    SET reserved_quantity = 3
    WHERE part_id = '30000000-0000-0000-0000-000000000001'
      AND factory_id = '40000000-0000-0000-0000-000000000001';
    INSERT INTO public.detailing_reservations(id, machine_id, machine_item_id, part_id, status)
    VALUES (
      '50000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000001',
      'active'
    );
    INSERT INTO public.detailing_reservation_allocations(reservation_id, factory_id, quantity)
    VALUES (
      '50000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000001',
      3
    );

    SELECT set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000003', false);
    UPDATE public.machines
    SET is_archived = true,
        archived_by = '90000000-0000-0000-0000-000000000003'
    WHERE id = '10000000-0000-0000-0000-000000000002';

    DO $archive_assertions$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.detailing_movements
        WHERE machine_id = '10000000-0000-0000-0000-000000000002'
          AND performed_by = '90000000-0000-0000-0000-000000000003'
      ) THEN
        RAISE EXCEPTION 'Existing machine must remain linked on archive movement';
      END IF;
    END;
    $archive_assertions$;
  `)

  console.log('[machine-detailing-cleanup] archive and cascading delete assertions passed')
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
