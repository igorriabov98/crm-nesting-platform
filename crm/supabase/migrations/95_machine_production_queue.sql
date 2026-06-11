alter table public.machines
  add column if not exists production_month date,
  add column if not exists production_workshop smallint,
  add column if not exists production_queue_number integer;

alter table public.machines
  add constraint machines_production_workshop_check
  check (production_workshop is null or production_workshop in (1, 2));

alter table public.machines
  add constraint machines_production_queue_number_check
  check (production_queue_number is null or production_queue_number > 0);

create index if not exists idx_machines_production_queue
  on public.machines (production_month, factory_id, production_workshop, production_queue_number)
  where production_month is not null
    and factory_id is not null
    and production_workshop is not null
    and production_queue_number is not null;
