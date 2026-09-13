drop schema public cascade;
create schema public;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create table public.factories (id uuid primary key);
create table public.users (id uuid primary key);
create table public.machines (id uuid primary key, factory_id uuid not null references public.factories);
create table public.tasks (
  id uuid primary key,
  status text not null,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.production_machine_facts (id uuid primary key);
create table public.production_fact_cutting_events (
  id uuid primary key,
  machine_id uuid not null references public.machines,
  fact_id uuid references public.production_machine_facts,
  fact_date date not null,
  status text not null default 'applied',
  created_by uuid references public.users,
  created_at timestamptz not null default now()
);
create table public.detailing_parts (id uuid primary key);
create table public.detailing_balances (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.detailing_parts,
  factory_id uuid not null references public.factories,
  on_hand_quantity integer not null default 0,
  reserved_quantity integer not null default 0,
  updated_by uuid not null references public.users,
  updated_at timestamptz not null default now(),
  unique(part_id, factory_id)
);
create table public.detailing_movements (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.detailing_parts,
  factory_id uuid not null references public.factories,
  movement_type text not null,
  quantity_delta integer not null,
  reserved_delta integer not null,
  on_hand_after integer not null,
  reserved_after integer not null,
  machine_id uuid references public.machines,
  production_fact_id uuid references public.production_machine_facts,
  performed_by uuid not null references public.users,
  comment text,
  created_at timestamptz not null default now()
);
create table public.future_detailing_batches (
  id uuid primary key,
  request_id uuid not null unique,
  machine_id uuid not null references public.machines,
  factory_id uuid not null references public.factories,
  created_by uuid not null references public.users,
  status text not null,
  confirmation_due_date date,
  confirmation_task_id uuid references public.tasks,
  first_cutting_event_id uuid references public.production_fact_cutting_events,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.future_detailing_items (
  id uuid primary key,
  batch_id uuid not null references public.future_detailing_batches,
  part_id uuid not null references public.detailing_parts,
  planned_quantity integer not null,
  actual_quantity integer,
  status text not null,
  variance_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.future_detailing_on_cutting_event()
returns trigger language plpgsql as $$ begin return new; end $$;
create trigger future_detailing_cutting_event
after insert on public.production_fact_cutting_events
for each row execute function public.future_detailing_on_cutting_event();

insert into public.factories values ('10000000-0000-0000-0000-000000000001');
insert into public.users values ('10000000-0000-0000-0000-000000000002');
insert into public.machines values (
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001'
);
insert into public.tasks(id, status) values ('10000000-0000-0000-0000-000000000004', 'pending');
insert into public.detailing_parts values
  ('10000000-0000-0000-0000-000000000005'),
  ('10000000-0000-0000-0000-000000000006');
insert into public.production_machine_facts values ('10000000-0000-0000-0000-000000000007');
insert into public.production_fact_cutting_events(
  id, machine_id, fact_id, fact_date, created_by
) values (
  '10000000-0000-0000-0000-000000000008',
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000007',
  '2026-09-12',
  '10000000-0000-0000-0000-000000000002'
);
insert into public.future_detailing_batches(
  id, request_id, machine_id, factory_id, created_by, status,
  confirmation_due_date, confirmation_task_id, first_cutting_event_id
) values (
  '10000000-0000-0000-0000-000000000009',
  '10000000-0000-0000-0000-000000000010',
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'awaiting_confirmation',
  '2026-09-14',
  '10000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000008'
);
insert into public.future_detailing_items(
  id, batch_id, part_id, planned_quantity, status
) values
  (
    '10000000-0000-0000-0000-000000000011',
    '10000000-0000-0000-0000-000000000009',
    '10000000-0000-0000-0000-000000000005',
    2,
    'awaiting_confirmation'
  ),
  (
    '10000000-0000-0000-0000-000000000012',
    '10000000-0000-0000-0000-000000000009',
    '10000000-0000-0000-0000-000000000006',
    3,
    'awaiting_confirmation'
  );

-- This plan was created after the old event. It must not be backfilled merely
-- because the machine has historical cutting facts; it waits for the next one.
insert into public.future_detailing_batches(
  id, request_id, machine_id, factory_id, created_by, status
) values (
  '10000000-0000-0000-0000-000000000013',
  '10000000-0000-0000-0000-000000000014',
  '10000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'planned'
);
insert into public.future_detailing_items(
  id, batch_id, part_id, planned_quantity, status
) values (
  '10000000-0000-0000-0000-000000000015',
  '10000000-0000-0000-0000-000000000013',
  '10000000-0000-0000-0000-000000000006',
  7,
  'planned'
);
