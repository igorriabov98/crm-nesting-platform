import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.env.TEST_DATABASE_URL) {
  console.log('Transport date approval DB test: skipped (TEST_DATABASE_URL is not set)')
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adminUrl = process.env.TEST_DATABASE_URL
const databaseName = `transport_date_${process.pid}_${Date.now()}`
const databaseUrl = new URL(adminUrl)
databaseUrl.pathname = `/${databaseName}`
const run = (binary, args, input) => {
  const result = spawnSync(binary, args, { encoding: 'utf8', input })
  if (result.status !== 0) throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n'))
}
const psql = (sql) => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString()], sql)

run('createdb', ['--maintenance-db', adminUrl, databaseName])
try {
  psql(String.raw`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT ''service_role''::text';
    CREATE TYPE public.task_type AS ENUM ('outsourcing_transport','inventory_transfer','detailing_transfer');
    CREATE TYPE public.task_status AS ENUM ('pending','in_progress','completed','cancelled');
    CREATE TYPE public.outsourcing_transport_direction AS ENUM ('outbound','return','mixed');
    CREATE TYPE public.outsourcing_transport_order_status AS ENUM ('needed','found','in_transit','completed','cancelled');
    CREATE TABLE users(id uuid PRIMARY KEY, role text, full_name text, is_active boolean, factory_id uuid, created_at timestamptz default now());
    CREATE TABLE factories(id uuid PRIMARY KEY default gen_random_uuid(), name text NOT NULL, created_at timestamptz default now());
    INSERT INTO factories(name) VALUES('Берегово');
    CREATE TABLE departments(id uuid PRIMARY KEY default gen_random_uuid(), name text, head_user_id uuid, factory_id uuid, is_active boolean, sort_order integer);
    CREATE TABLE department_members(id uuid PRIMARY KEY default gen_random_uuid(), department_id uuid, user_id uuid);
    CREATE TABLE department_requests(
      id uuid PRIMARY KEY default gen_random_uuid(), request_kind text default 'manual', target_department text,
      title text, description text, priority text default 'normal', status text default 'new', created_by uuid,
      assigned_to uuid, completed_by uuid, factory_id uuid, machine_id uuid, request_item_table text,
      request_item_id uuid, technologist_request_id uuid, long_stock_plan_id uuid,
      long_stock_returned_version_id uuid, request_item_label text, due_date date, response text,
      completed_at timestamptz, result_viewed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
      CONSTRAINT department_requests_target_check CHECK (target_department in ('technologist','supply','production')),
      CONSTRAINT department_requests_kind_check CHECK (request_kind in ('manual','machine_layout','long_stock_recalculation'))
    );
    CREATE TABLE department_request_events(id uuid PRIMARY KEY default gen_random_uuid(), request_id uuid, event_type text, actor_id uuid, created_at timestamptz default now());
    CREATE TABLE notifications(id uuid PRIMARY KEY default gen_random_uuid(), user_id uuid, type text, title text, message text, related_department_request_id uuid, created_at timestamptz default now());
    CREATE TABLE tasks(id uuid PRIMARY KEY default gen_random_uuid(), department_request_id uuid, assigned_to uuid, task_type task_type, title text, description text, status task_status default 'pending', start_date date, deadline date, detailing_transfer_id uuid, inventory_transfer_id uuid, supply_order_schedule_id uuid, completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    CREATE UNIQUE INDEX tasks_department_request_unique_idx ON tasks(department_request_id) WHERE department_request_id IS NOT NULL;
    CREATE TABLE machine_outsourcing_transport_orders(id uuid PRIMARY KEY default gen_random_uuid(), direction outsourcing_transport_direction, status outsourcing_transport_order_status default 'found', carrier_supplier_id uuid, scheduled_date date, price numeric, route_start_key text, route_start text, route text, comment text, created_by uuid, updated_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
    CREATE TABLE transport_trip_stops(id uuid PRIMARY KEY default gen_random_uuid(), transport_order_id uuid REFERENCES machine_outsourcing_transport_orders(id), client_key text, sequence_no integer, stop_kind text, point_key text, point_label text, city text, address text, planned_arrival_at timestamptz, service_duration_minutes integer, status text, arrived_at timestamptz, completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    CREATE TABLE transport_trip_need_links(id uuid PRIMARY KEY default gen_random_uuid(), transport_order_id uuid REFERENCES machine_outsourcing_transport_orders(id), need_kind text, need_source text, need_id uuid, direction text, source_point_key text, source_point_label text, destination_point_key text, destination_point_label text, need_title text, need_subtitle text, needed_date date, pickup_stop_id uuid, delivery_stop_id uuid, released_at timestamptz, created_at timestamptz default now());
    CREATE UNIQUE INDEX idx_transport_trip_need_links_one_active ON transport_trip_need_links(need_source, need_id) WHERE released_at IS NULL;
    CREATE TABLE machine_outsourcing_operations(id uuid PRIMARY KEY, planned_send_date date, planned_return_date date, supply_terms_confirmed_at timestamptz, supply_terms_confirmed_by uuid, updated_at timestamptz default now());
    CREATE TABLE machine_outsourcing_transport_needs(id uuid PRIMARY KEY, operation_id uuid, direction text, plan_state text default 'confirmed', needed_date date, task_id uuid, transport_order_id uuid, status text, updated_at timestamptz default now());
    CREATE TABLE detailing_transfers(id uuid PRIMARY KEY, status text default 'planned', expected_arrival_date date, updated_at timestamptz default now());
    CREATE TABLE inventory_transfers(id uuid PRIMARY KEY, status text default 'planned', expected_arrival_date date, updated_at timestamptz default now());
    CREATE TABLE supply_order_delivery_schedules(id uuid PRIMARY KEY, request_item_table text, request_item_id uuid, supplier_id uuid, status text default 'planned', delivery_date date, change_reason text, updated_at timestamptz default now());
    CREATE FUNCTION public.is_director() RETURNS boolean LANGUAGE sql AS 'SELECT true';
    CREATE FUNCTION public.get_user_role() RETURNS text LANGUAGE sql AS 'SELECT ''planning_director''::text';
    CREATE FUNCTION public.get_user_factory_id() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION public.fn_create_transport_trip_v2(uuid,date,numeric,text,jsonb,jsonb,uuid) RETURNS uuid LANGUAGE plpgsql SET search_path = 'public' AS $$
    DECLARE trip_id uuid; link jsonb; first_stop uuid; second_stop uuid;
    BEGIN
      INSERT INTO machine_outsourcing_transport_orders(direction,status,carrier_supplier_id,scheduled_date,price,route_start,route,created_by,updated_by) VALUES ('outbound','found',$1,$2,$3,'Старт','Старт → Финиш',$7,$7) RETURNING id INTO trip_id;
      INSERT INTO transport_trip_stops(transport_order_id,client_key,sequence_no,stop_kind,point_key,point_label,status) VALUES (trip_id,'start',0,'start','start','Старт','completed') RETURNING id INTO first_stop;
      INSERT INTO transport_trip_stops(transport_order_id,client_key,sequence_no,stop_kind,point_key,point_label,status) VALUES (trip_id,'finish',1,'service','finish','Финиш','planned') RETURNING id INTO second_stop;
      FOR link IN SELECT value FROM jsonb_array_elements($6) LOOP
        INSERT INTO transport_trip_need_links(transport_order_id,need_kind,need_source,need_id,direction,source_point_key,source_point_label,destination_point_key,destination_point_label,need_title,needed_date,pickup_stop_id,delivery_stop_id)
        VALUES(trip_id,link->>'needKind',link->>'needSource',(link->>'needId')::uuid,link->>'direction','a','A','b','B',link->>'title',(link->>'neededDate')::date,first_stop,second_stop);
        IF link->>'needSource'='detailing_transfer' THEN UPDATE detailing_transfers SET expected_arrival_date=$2 WHERE id=(link->>'needId')::uuid; END IF;
      END LOOP;
      RETURN trip_id;
    END $$;
    CREATE FUNCTION public.fn_update_transport_trip_v2(uuid,outsourcing_transport_order_status,uuid,date,numeric,text,text,jsonb,uuid) RETURNS outsourcing_transport_order_status LANGUAGE plpgsql SET search_path = 'public' AS $$ BEGIN UPDATE machine_outsourcing_transport_orders SET status=$2,scheduled_date=$4 WHERE id=$1; UPDATE detailing_transfers SET expected_arrival_date=$4 WHERE id IN (SELECT need_id FROM transport_trip_need_links WHERE transport_order_id=$1 AND need_source='detailing_transfer'); RETURN $2; END $$;
    CREATE FUNCTION public.fn_update_transport_trip(uuid,outsourcing_transport_order_status,uuid,date,numeric,text,text,uuid) RETURNS outsourcing_transport_order_status LANGUAGE plpgsql SET search_path = 'public' AS $$ BEGIN UPDATE machine_outsourcing_transport_orders SET status=$2 WHERE id=$1; RETURN $2; END $$;
  `)
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260728130000_transport_trip_date_task_type.sql')])
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260728130100_transport_trip_date_approval.sql')])
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260731160000_transport_need_date_task_fallback.sql')])
  psql(String.raw`
    DO $$
    DECLARE actor uuid := '10000000-0000-0000-0000-000000000001'; approver uuid := '10000000-0000-0000-0000-000000000002'; need_id uuid := '20000000-0000-0000-0000-000000000001'; fallback_need_id uuid := '20000000-0000-0000-0000-000000000002'; trip_id uuid; fallback_trip_id uuid; request_id uuid;
    BEGIN
      INSERT INTO users(id,role,full_name,is_active) VALUES(actor,'crm_admin','Оператор',true),(approver,'planning_director','Планировщик',true);
      INSERT INTO departments(name,head_user_id,is_active,sort_order) VALUES('Отдел планирования',approver,true,1);
      IF (SELECT city FROM factories LIMIT 1) <> 'Берегово' THEN RAISE EXCEPTION 'factory city backfill failed'; END IF;
      INSERT INTO inventory_transfers(id,expected_arrival_date) VALUES(fallback_need_id,NULL);
      INSERT INTO tasks(assigned_to,task_type,title,status,deadline,inventory_transfer_id)
      VALUES(actor,'inventory_transfer','Перевезти материалы','pending','2026-07-31',fallback_need_id);
      IF transport_need_current_date('inventory_transfer', fallback_need_id) <> '2026-07-31' THEN
        RAISE EXCEPTION 'inventory transfer task deadline fallback failed';
      END IF;
      fallback_trip_id := fn_create_transport_trip_v3(NULL,'2026-07-31',0,NULL,'[{},{}]'::jsonb,jsonb_build_array(jsonb_build_object('needKind','materials','needSource','inventory_transfer','needId',fallback_need_id,'direction','outbound','title','Материалы','neededDate','2026-07-31')),NULL,actor);
      IF (SELECT date_change_state FROM machine_outsourcing_transport_orders WHERE id=fallback_trip_id) <> 'not_required' THEN
        RAISE EXCEPTION 'fallback date incorrectly started approval';
      END IF;
      INSERT INTO detailing_transfers(id,expected_arrival_date) VALUES(need_id,'2026-08-02');
      trip_id := fn_create_transport_trip_v3(NULL,'2026-08-01',0,NULL,'[{},{}]'::jsonb,jsonb_build_array(jsonb_build_object('needKind','detailing','needSource','detailing_transfer','needId',need_id,'direction','outbound','title','Детали','neededDate','2026-08-02')),'Совмещаем маршрут',actor);
      IF (SELECT expected_arrival_date FROM detailing_transfers WHERE id=need_id) <> '2026-08-02' THEN RAISE EXCEPTION 'date changed before approval'; END IF;
      IF (SELECT date_change_state FROM machine_outsourcing_transport_orders WHERE id=trip_id) <> 'pending' THEN RAISE EXCEPTION 'trip not pending'; END IF;
      SELECT id INTO request_id FROM transport_trip_date_change_requests WHERE transport_order_id=trip_id;
      PERFORM fn_decide_transport_trip_date_change(request_id,'approved','Проверено',approver);
      IF (SELECT expected_arrival_date FROM detailing_transfers WHERE id=need_id) <> '2026-08-01' THEN RAISE EXCEPTION 'approved date not applied'; END IF;
      IF (SELECT date_change_state FROM machine_outsourcing_transport_orders WHERE id=trip_id) <> 'approved' THEN RAISE EXCEPTION 'trip not approved'; END IF;
    END $$;
  `)
  psql(String.raw`
    INSERT INTO machine_outsourcing_transport_orders(id,direction,status,scheduled_date,price,route_start,route)
    VALUES ('30000000-0000-0000-0000-000000000001','outbound','found','2026-08-28',200,'Varian — Ужгород','Varian — Ужгород → Берегово');
    INSERT INTO inventory_transfers(id,status,expected_arrival_date)
    VALUES ('40000000-0000-0000-0000-000000000001','planned','2026-08-28');
    INSERT INTO transport_trip_need_links(
      transport_order_id,need_kind,need_source,need_id,direction,source_point_key,source_point_label,
      destination_point_key,destination_point_label,need_title,needed_date,released_at
    ) VALUES (
      '30000000-0000-0000-0000-000000000001','materials','inventory_transfer',
      '40000000-0000-0000-0000-000000000001','outbound','supplier:varian','Varian — Ужгород',
      'factory:berehove','Берегово','тест брони 3','2026-08-28',now()
    );
  `)
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260730160000_transport_trip_edit_cancel.sql')])
  psql(String.raw`
    DO $$
    DECLARE
      actor uuid := '10000000-0000-0000-0000-000000000001';
      trip_id uuid := '30000000-0000-0000-0000-000000000001';
      edit_trip uuid := '30000000-0000-0000-0000-000000000002';
      need_one uuid := '40000000-0000-0000-0000-000000000002';
      need_two uuid := '40000000-0000-0000-0000-000000000003';
      failed boolean;
    BEGIN
      IF (SELECT released_at FROM transport_trip_need_links WHERE transport_order_id=trip_id) IS NOT NULL THEN
        RAISE EXCEPTION 'active trip repair did not reactivate its released need';
      END IF;

      failed := false;
      BEGIN
        PERFORM fn_cancel_transport_trip_v1(trip_id, '   ', actor);
      EXCEPTION WHEN OTHERS THEN failed := position('Укажите причину' in SQLERRM) > 0;
      END;
      IF NOT failed THEN RAISE EXCEPTION 'cancellation without reason was accepted'; END IF;
      PERFORM fn_cancel_transport_trip_v1(trip_id, 'Ошибка планирования', actor);
      IF (SELECT status FROM machine_outsourcing_transport_orders WHERE id=trip_id) <> 'cancelled' THEN
        RAISE EXCEPTION 'trip was not cancelled';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM transport_trip_need_links
        WHERE transport_order_id=trip_id AND released_at IS NOT NULL
          AND released_reason='Ошибка планирования' AND released_by=actor
      ) THEN RAISE EXCEPTION 'cancelled need was not released with audit data'; END IF;

      INSERT INTO inventory_transfers(id,status,expected_arrival_date)
      VALUES (need_one,'planned','2026-08-28'),(need_two,'planned','2026-08-29');
      INSERT INTO machine_outsourcing_transport_orders(id,direction,status,scheduled_date,price,route_start,route,date_change_state)
      VALUES (edit_trip,'outbound','found','2026-08-28',200,'A','A → B','not_required');
      PERFORM fn_update_transport_trip_v4(
        edit_trip, '50000000-0000-0000-0000-000000000001', '2026-08-28', 200, 'test',
        jsonb_build_array(
          jsonb_build_object('clientId','a','kind','service','pointKey','a','pointLabel','A','plannedArrivalAt','2026-08-28T08:00:00+00:00','serviceDurationMinutes',30),
          jsonb_build_object('clientId','b','kind','service','pointKey','b','pointLabel','B','plannedArrivalAt','2026-08-28T09:00:00+00:00','serviceDurationMinutes',30),
          jsonb_build_object('clientId','c','kind','finish','pointKey','c','pointLabel','C','plannedArrivalAt','2026-08-28T10:00:00+00:00','serviceDurationMinutes',30)
        ),
        jsonb_build_array(
          jsonb_build_object('needKind','materials','needSource','inventory_transfer','needId',need_one,'direction','outbound','sourcePointKey','a','sourcePointLabel','A','destinationPointKey','c','destinationPointLabel','C','title','Первая','neededDate','2026-08-28','pickupStopClientId','a','deliveryStopClientId','c'),
          jsonb_build_object('needKind','materials','needSource','inventory_transfer','needId',need_two,'direction','outbound','sourcePointKey','b','sourcePointLabel','B','destinationPointKey','c','destinationPointLabel','C','title','Вторая','neededDate','2026-08-29','pickupStopClientId','b','deliveryStopClientId','c')
        ), NULL, 'Совмещаем даты', actor
      );
      IF (SELECT count(*) FROM transport_trip_need_links WHERE transport_order_id=edit_trip AND released_at IS NULL) <> 2 THEN
        RAISE EXCEPTION 'composition additions were not saved';
      END IF;
      IF (SELECT date_change_state FROM machine_outsourcing_transport_orders WHERE id=edit_trip) <> 'pending' THEN
        RAISE EXCEPTION 'different-date addition did not start approval';
      END IF;

      failed := false;
      BEGIN
        PERFORM fn_update_transport_trip_v4(
          edit_trip, '50000000-0000-0000-0000-000000000001', '2026-08-28', 200, 'test',
          (SELECT jsonb_agg(jsonb_build_object('id',id,'clientId',client_key,'kind',stop_kind,'pointKey',point_key,'pointLabel',point_label,'city',city,'address',address,'plannedArrivalAt',planned_arrival_at,'serviceDurationMinutes',service_duration_minutes) ORDER BY sequence_no) FROM transport_trip_stops WHERE transport_order_id=edit_trip),
          jsonb_build_array(jsonb_build_object('needKind','materials','needSource','inventory_transfer','needId',need_one,'direction','outbound','sourcePointKey','a','sourcePointLabel','A','destinationPointKey','c','destinationPointLabel','C','title','Первая','neededDate','2026-08-28','pickupStopClientId','a','deliveryStopClientId','c')),
          NULL, NULL, actor
        );
      EXCEPTION WHEN OTHERS THEN failed := position('причину исключения' in SQLERRM) > 0;
      END;
      IF NOT failed THEN RAISE EXCEPTION 'removal without reason was accepted'; END IF;

      PERFORM fn_update_transport_trip_v4(
        edit_trip, '50000000-0000-0000-0000-000000000001', '2026-08-28', 200, 'test',
        (SELECT jsonb_agg(jsonb_build_object('id',id,'clientId',client_key,'kind',stop_kind,'pointKey',point_key,'pointLabel',point_label,'city',city,'address',address,'plannedArrivalAt',planned_arrival_at,'serviceDurationMinutes',service_duration_minutes) ORDER BY sequence_no) FROM transport_trip_stops WHERE transport_order_id=edit_trip),
        jsonb_build_array(jsonb_build_object('needKind','materials','needSource','inventory_transfer','needId',need_one,'direction','outbound','sourcePointKey','a','sourcePointLabel','A','destinationPointKey','c','destinationPointLabel','C','title','Первая','neededDate','2026-08-28','pickupStopClientId','a','deliveryStopClientId','c')),
        'Не влезло в машину', NULL, actor
      );
      IF NOT EXISTS (
        SELECT 1 FROM transport_trip_need_links
        WHERE transport_order_id=edit_trip AND need_id=need_two AND released_at IS NOT NULL
          AND released_reason='Не влезло в машину' AND released_by=actor
      ) THEN RAISE EXCEPTION 'removed need audit data was not saved'; END IF;
      IF (SELECT date_change_state FROM machine_outsourcing_transport_orders WHERE id=edit_trip) <> 'not_required'
         OR EXISTS (SELECT 1 FROM transport_trip_date_change_requests WHERE transport_order_id=edit_trip AND status='pending') THEN
        RAISE EXCEPTION 'stale date approval remained after composition change';
      END IF;

      UPDATE machine_outsourcing_transport_orders SET status='in_transit' WHERE id=edit_trip;
      UPDATE transport_trip_stops SET status='arrived', arrived_at=now()
      WHERE id=(SELECT pickup_stop_id FROM transport_trip_need_links WHERE transport_order_id=edit_trip AND need_id=need_one AND released_at IS NULL);
      failed := false;
      BEGIN
        PERFORM fn_update_transport_trip_v4(
          edit_trip, '50000000-0000-0000-0000-000000000001', '2026-08-28', 200, 'test',
          (SELECT jsonb_agg(jsonb_build_object('id',id,'clientId',client_key,'kind',stop_kind,'pointKey',point_key,'pointLabel',point_label,'city',city,'address',address,'plannedArrivalAt',planned_arrival_at,'serviceDurationMinutes',service_duration_minutes) ORDER BY sequence_no) FROM transport_trip_stops WHERE transport_order_id=edit_trip),
          jsonb_build_array(jsonb_build_object('needKind','materials','needSource','inventory_transfer','needId',need_two,'direction','outbound','sourcePointKey','b','sourcePointLabel','B','destinationPointKey','c','destinationPointLabel','C','title','Вторая','neededDate','2026-08-28','pickupStopClientId','b','deliveryStopClientId','c')),
          'Меняем будущую часть', NULL, actor
        );
      EXCEPTION WHEN OTHERS THEN failed := position('после начала её точки забора' in SQLERRM) > 0;
      END;
      IF NOT failed THEN RAISE EXCEPTION 'picked need was removed from in-transit trip'; END IF;

      INSERT INTO machine_outsourcing_transport_orders(id,direction,status,scheduled_date,price,route_start,route,date_change_state)
      VALUES ('30000000-0000-0000-0000-000000000003','outbound','found','2026-08-28',200,'A','A → C','not_required');
      failed := false;
      BEGIN
        INSERT INTO transport_trip_need_links(
          transport_order_id,need_kind,need_source,need_id,direction,source_point_key,source_point_label,
          destination_point_key,destination_point_label,need_title,needed_date
        ) VALUES ('30000000-0000-0000-0000-000000000003','materials','inventory_transfer',need_one,'outbound','a','A','c','C','Конфликт','2026-08-28');
      EXCEPTION WHEN unique_violation THEN failed := true;
      END;
      IF NOT failed THEN RAISE EXCEPTION 'active-need uniqueness did not stop a parallel assignment'; END IF;
    END $$;
  `)
  psql(String.raw`
    INSERT INTO inventory_transfers(id,status,expected_arrival_date)
    VALUES ('40000000-0000-0000-0000-000000000010','planned','2026-09-08');
    INSERT INTO machine_outsourcing_transport_orders(
      id,direction,status,scheduled_date,price,route_start,route,date_change_state
    ) VALUES (
      '30000000-0000-0000-0000-000000000010','outbound','found','2026-09-09',100,'A','A → B','pending'
    );
    INSERT INTO transport_trip_need_links(
      id,transport_order_id,need_kind,need_source,need_id,direction,source_point_key,source_point_label,
      destination_point_key,destination_point_label,need_title,needed_date
    ) VALUES (
      '60000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000010','materials','inventory_transfer',
      '40000000-0000-0000-0000-000000000010','outbound','a','A','b','B','Backfill','2026-09-08'
    );
    INSERT INTO tasks(id,assigned_to,task_type,title,status,start_date,deadline)
    VALUES (
      '70000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002',
      'transport_trip_date_approval','Согласовать даты','pending','2026-09-06','2026-09-06'
    );
    INSERT INTO transport_trip_date_change_requests(
      id,transport_order_id,task_id,status,reason,requested_by
    ) VALUES (
      '80000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000010',
      '70000000-0000-0000-0000-000000000010','pending','Backfill test','10000000-0000-0000-0000-000000000001'
    );
    INSERT INTO transport_trip_date_change_items(
      request_id,transport_need_link_id,need_source,need_id,old_date,new_date,sort_order
    ) VALUES (
      '80000000-0000-0000-0000-000000000010','60000000-0000-0000-0000-000000000010',
      'inventory_transfer','40000000-0000-0000-0000-000000000010','2026-09-08','2026-09-09',0
    );
  `)
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260906160000_transport_need_groups_planning_requests.sql')])
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260906190000_fix_transport_request_duplicate_created_event.sql')])
  psql(String.raw`
    DO $$
    DECLARE
      actor uuid := '10000000-0000-0000-0000-000000000001';
      approver uuid := '10000000-0000-0000-0000-000000000002';
      source_trip uuid := '30000000-0000-0000-0000-000000000020';
      target_trip uuid := '30000000-0000-0000-0000-000000000021';
      source_need uuid := '40000000-0000-0000-0000-000000000020';
      target_need uuid := '40000000-0000-0000-0000-000000000021';
      failed boolean := false;
      source_stops jsonb;
      target_stops jsonb;
      source_links jsonb;
      target_links jsonb;
    BEGIN
      IF (SELECT count(*) FROM department_requests WHERE transport_trip_date_change_request_id='80000000-0000-0000-0000-000000000010') <> 1 THEN
        RAISE EXCEPTION 'pending approval backfill did not create exactly one request';
      END IF;
      IF (SELECT status FROM department_requests WHERE transport_trip_date_change_request_id='80000000-0000-0000-0000-000000000010') <> 'in_progress' THEN
        RAISE EXCEPTION 'backfilled request is not in progress';
      END IF;
      IF (SELECT department_request_id FROM tasks WHERE id='70000000-0000-0000-0000-000000000010') IS NULL THEN
        RAISE EXCEPTION 'existing approval task was not linked';
      END IF;
      IF (
        SELECT count(*)
        FROM department_request_events event
        JOIN department_requests request ON request.id=event.request_id
        WHERE request.transport_trip_date_change_request_id='80000000-0000-0000-0000-000000000010'
          AND event.event_type='created'
      ) <> 1 THEN
        RAISE EXCEPTION 'transport request contains duplicate created events';
      END IF;
      PERFORM sync_transport_date_department_request('80000000-0000-0000-0000-000000000010');
      PERFORM sync_transport_date_department_request('80000000-0000-0000-0000-000000000010');
      IF (SELECT count(*) FROM department_requests WHERE transport_trip_date_change_request_id='80000000-0000-0000-0000-000000000010') <> 1 THEN
        RAISE EXCEPTION 'idempotent sync created a duplicate';
      END IF;
      PERFORM fn_decide_transport_trip_date_change('80000000-0000-0000-0000-000000000010','approved','Единое решение',approver);
      IF (SELECT status FROM department_requests WHERE transport_trip_date_change_request_id='80000000-0000-0000-0000-000000000010') <> 'done' THEN
        RAISE EXCEPTION 'transport decision did not close the linked request';
      END IF;

      INSERT INTO inventory_transfers(id,status,expected_arrival_date)
      VALUES (source_need,'planned','2026-09-08'),(target_need,'planned','2026-09-08');
      INSERT INTO machine_outsourcing_transport_orders(
        id,direction,status,carrier_supplier_id,scheduled_date,price,route_start,route,date_change_state
      ) VALUES
        (source_trip,'outbound','found','50000000-0000-0000-0000-000000000001','2026-09-08',100,'A','A → C','not_required'),
        (target_trip,'outbound','found','50000000-0000-0000-0000-000000000001','2026-09-08',100,'B','B → C','not_required');

      source_stops := jsonb_build_array(
        jsonb_build_object('clientId','a','kind','service','pointKey','a','pointLabel','A','plannedArrivalAt','2026-09-08T08:00:00+00:00','serviceDurationMinutes',30),
        jsonb_build_object('clientId','c','kind','service','pointKey','c','pointLabel','C','plannedArrivalAt','2026-09-08T10:00:00+00:00','serviceDurationMinutes',30)
      );
      source_links := jsonb_build_array(
        jsonb_build_object('needKind','materials','needSource','inventory_transfer','needId',source_need,'direction','outbound','sourcePointKey','a','sourcePointLabel','A','destinationPointKey','c','destinationPointLabel','C','title','Переносимая','neededDate','2026-09-08','pickupStopClientId','a','deliveryStopClientId','c')
      );
      target_stops := jsonb_build_array(
        jsonb_build_object('clientId','b','kind','service','pointKey','b','pointLabel','B','plannedArrivalAt','2026-09-08T08:00:00+00:00','serviceDurationMinutes',30),
        jsonb_build_object('clientId','c','kind','service','pointKey','c','pointLabel','C','plannedArrivalAt','2026-09-08T10:00:00+00:00','serviceDurationMinutes',30)
      );
      target_links := jsonb_build_array(
        jsonb_build_object('needKind','materials','needSource','inventory_transfer','needId',target_need,'direction','outbound','sourcePointKey','b','sourcePointLabel','B','destinationPointKey','c','destinationPointLabel','C','title','Целевая','neededDate','2026-09-08','pickupStopClientId','b','deliveryStopClientId','c')
      );
      PERFORM fn_update_transport_trip_v4(source_trip,'50000000-0000-0000-0000-000000000001','2026-09-08',100,null,source_stops,source_links,null,null,actor);
      PERFORM fn_update_transport_trip_v4(target_trip,'50000000-0000-0000-0000-000000000001','2026-09-08',100,null,target_stops,target_links,null,null,actor);

      target_stops := jsonb_build_array(
        jsonb_build_object('clientId','b','kind','service','pointKey','b','pointLabel','B','plannedArrivalAt','2026-09-08T08:00:00+00:00','serviceDurationMinutes',30),
        jsonb_build_object('clientId','a','kind','service','pointKey','a','pointLabel','A','plannedArrivalAt','2026-09-08T09:00:00+00:00','serviceDurationMinutes',30),
        jsonb_build_object('clientId','c','kind','service','pointKey','c','pointLabel','C','plannedArrivalAt','2026-09-08T10:00:00+00:00','serviceDurationMinutes',30)
      );
      target_links := target_links || source_links;

      BEGIN
        PERFORM fn_move_transport_trip_position_v1(
          source_trip,target_trip,jsonb_build_array(jsonb_build_object('source','inventory_transfer','id',source_need)),
          '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,target_links,'test rollback',null,actor
        );
      EXCEPTION WHEN OTHERS THEN failed := true;
      END;
      IF NOT failed THEN RAISE EXCEPTION 'invalid target route did not fail'; END IF;
      IF (SELECT status FROM machine_outsourcing_transport_orders WHERE id=source_trip) <> 'found'
        OR NOT EXISTS (SELECT 1 FROM transport_trip_need_links WHERE transport_order_id=source_trip AND need_id=source_need AND released_at IS NULL) THEN
        RAISE EXCEPTION 'failed atomic move did not roll back source trip';
      END IF;

      PERFORM fn_move_transport_trip_position_v1(
        source_trip,target_trip,jsonb_build_array(jsonb_build_object('source','inventory_transfer','id',source_need)),
        '[]'::jsonb,'[]'::jsonb,target_stops,target_links,'Собираем общий рейс',null,actor
      );
      IF (SELECT status FROM machine_outsourcing_transport_orders WHERE id=source_trip) <> 'cancelled' THEN
        RAISE EXCEPTION 'last-position move did not cancel source trip';
      END IF;
      IF (SELECT count(*) FROM transport_trip_need_links WHERE transport_order_id=target_trip AND released_at IS NULL) <> 2 THEN
        RAISE EXCEPTION 'target trip did not receive moved position';
      END IF;

      INSERT INTO machine_outsourcing_transport_orders(
        id,direction,status,carrier_supplier_id,scheduled_date,price,route_start,route,date_change_state
      ) VALUES (
        '30000000-0000-0000-0000-000000000030','outbound','found',
        '50000000-0000-0000-0000-000000000001','2026-09-08',100,'Varian','Varian → C','not_required'
      );
      INSERT INTO supply_order_delivery_schedules(
        id,request_item_table,request_item_id,supplier_id,status,delivery_date
      ) VALUES
        ('40000000-0000-0000-0000-000000000030','request_paint','90000000-0000-0000-0000-000000000030','50000000-0000-0000-0000-000000000030','planned','2026-09-08'),
        ('40000000-0000-0000-0000-000000000031','request_paint','90000000-0000-0000-0000-000000000030','50000000-0000-0000-0000-000000000030','planned','2026-09-08');
      INSERT INTO transport_trip_need_links(
        transport_order_id,need_kind,need_source,need_id,direction,source_point_key,source_point_label,
        destination_point_key,destination_point_label,need_title,needed_date
      ) VALUES
        ('30000000-0000-0000-0000-000000000030','materials','supply_schedule','40000000-0000-0000-0000-000000000030','outbound','supplier:varian','Varian','c','C','Краска 22 кг','2026-09-08'),
        ('30000000-0000-0000-0000-000000000030','materials','supply_schedule','40000000-0000-0000-0000-000000000031','outbound','supplier:varian','Varian','c','C','Краска 3 кг','2026-09-08');
      failed := false;
      BEGIN
        PERFORM fn_move_transport_trip_position_v1(
          '30000000-0000-0000-0000-000000000030',target_trip,
          jsonb_build_array(jsonb_build_object('source','supply_schedule','id','40000000-0000-0000-0000-000000000030')),
          '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'Частичный перенос',null,actor
        );
      EXCEPTION WHEN OTHERS THEN
        failed := position('Технические части одной позиции' in SQLERRM) > 0;
      END;
      IF NOT failed THEN RAISE EXCEPTION 'one technical schedule fragment was moved separately'; END IF;
    END $$;
  `)
  console.log('Transport date approval DB test: OK')
} finally {
  run('dropdb', ['--if-exists', '--force', '--maintenance-db', adminUrl, databaseName])
}
