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
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE TYPE public.task_type AS ENUM ('outsourcing_transport');
    CREATE TYPE public.task_status AS ENUM ('pending','in_progress','completed','cancelled');
    CREATE TYPE public.outsourcing_transport_direction AS ENUM ('outbound','return','mixed');
    CREATE TYPE public.outsourcing_transport_order_status AS ENUM ('needed','found','in_transit','completed','cancelled');
    CREATE TABLE users(id uuid PRIMARY KEY, role text, full_name text, is_active boolean, created_at timestamptz default now());
    CREATE TABLE factories(id uuid PRIMARY KEY default gen_random_uuid(), name text NOT NULL, created_at timestamptz default now());
    INSERT INTO factories(name) VALUES('Берегово');
    CREATE TABLE departments(id uuid PRIMARY KEY default gen_random_uuid(), name text, head_user_id uuid, is_active boolean, sort_order integer);
    CREATE TABLE tasks(id uuid PRIMARY KEY default gen_random_uuid(), assigned_to uuid, task_type task_type, title text, description text, status task_status default 'pending', start_date date, deadline date, detailing_transfer_id uuid, inventory_transfer_id uuid, supply_order_schedule_id uuid, completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    CREATE TABLE machine_outsourcing_transport_orders(id uuid PRIMARY KEY default gen_random_uuid(), direction outsourcing_transport_direction, status outsourcing_transport_order_status default 'found', carrier_supplier_id uuid, scheduled_date date, price numeric, route_start_key text, route_start text, route text, comment text, created_by uuid, updated_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
    CREATE TABLE transport_trip_stops(id uuid PRIMARY KEY default gen_random_uuid(), transport_order_id uuid REFERENCES machine_outsourcing_transport_orders(id), client_key text, sequence_no integer, stop_kind text, point_key text, point_label text, city text, address text, planned_arrival_at timestamptz, service_duration_minutes integer, status text, arrived_at timestamptz, completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    CREATE TABLE transport_trip_need_links(id uuid PRIMARY KEY default gen_random_uuid(), transport_order_id uuid REFERENCES machine_outsourcing_transport_orders(id), need_kind text, need_source text, need_id uuid, direction text, source_point_key text, source_point_label text, destination_point_key text, destination_point_label text, need_title text, need_subtitle text, needed_date date, pickup_stop_id uuid, delivery_stop_id uuid, released_at timestamptz, created_at timestamptz default now());
    CREATE TABLE machine_outsourcing_operations(id uuid PRIMARY KEY, planned_send_date date, planned_return_date date, supply_terms_confirmed_at timestamptz, supply_terms_confirmed_by uuid, updated_at timestamptz default now());
    CREATE TABLE machine_outsourcing_transport_needs(id uuid PRIMARY KEY, operation_id uuid, direction text, needed_date date, task_id uuid, status text, updated_at timestamptz default now());
    CREATE TABLE detailing_transfers(id uuid PRIMARY KEY, expected_arrival_date date, updated_at timestamptz default now());
    CREATE TABLE inventory_transfers(id uuid PRIMARY KEY, expected_arrival_date date, updated_at timestamptz default now());
    CREATE TABLE supply_order_delivery_schedules(id uuid PRIMARY KEY, delivery_date date, change_reason text, updated_at timestamptz default now());
    CREATE FUNCTION public.is_director() RETURNS boolean LANGUAGE sql AS 'SELECT true';
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
  psql(String.raw`
    DO $$
    DECLARE actor uuid := '10000000-0000-0000-0000-000000000001'; approver uuid := '10000000-0000-0000-0000-000000000002'; need_id uuid := '20000000-0000-0000-0000-000000000001'; trip_id uuid; request_id uuid;
    BEGIN
      INSERT INTO users(id,role,full_name,is_active) VALUES(actor,'crm_admin','Оператор',true),(approver,'planning_director','Планировщик',true);
      INSERT INTO departments(name,head_user_id,is_active,sort_order) VALUES('Отдел планирования',approver,true,1);
      IF (SELECT city FROM factories LIMIT 1) <> 'Берегово' THEN RAISE EXCEPTION 'factory city backfill failed'; END IF;
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
  console.log('Transport date approval DB test: OK')
} finally {
  run('dropdb', ['--if-exists', '--force', '--maintenance-db', adminUrl, databaseName])
}
