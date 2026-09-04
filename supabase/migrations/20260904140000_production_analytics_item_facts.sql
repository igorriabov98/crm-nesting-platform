-- Exact item-level production facts, factory calendars, and effective capacities.
-- Existing aggregate facts remain readable and are marked as legacy_manual.

alter table public.production_fact_sections
  drop constraint if exists production_fact_sections_stage_type_supported;

alter table public.production_fact_sections
  add constraint production_fact_sections_stage_type_supported
  check (
    production_stage_type is null
    or production_stage_type in (
      'cutting'::public.stage_type,
      'assembly'::public.stage_type,
      'cleaning'::public.stage_type,
      'painting'::public.stage_type,
      'packaging'::public.stage_type,
      'actual_shipping'::public.stage_type
    )
  );

with standard(parent_name, child_name, stage_type) as (
  values
    ('Заготовка', 'Заготовка', 'cutting'::public.stage_type),
    ('Сборка/Сварка', 'Цех 1', 'assembly'::public.stage_type),
    ('Сборка/Сварка', 'Цех 2', 'assembly'::public.stage_type),
    ('Зачистка', 'Зачистка', 'cleaning'::public.stage_type),
    ('Малярка', 'Малярка', 'painting'::public.stage_type),
    ('Упаковка', 'Упаковка', 'packaging'::public.stage_type),
    ('Отгрузка', 'Отгрузка', 'actual_shipping'::public.stage_type)
)
update public.production_fact_sections parent
set production_stage_type = standard.stage_type,
    updated_at = now()
from standard
where parent.parent_id is null
  and lower(btrim(parent.name)) = lower(standard.parent_name);

with standard(parent_name, child_name, stage_type) as (
  values
    ('Заготовка', 'Заготовка', 'cutting'::public.stage_type),
    ('Сборка/Сварка', 'Цех 1', 'assembly'::public.stage_type),
    ('Сборка/Сварка', 'Цех 2', 'assembly'::public.stage_type),
    ('Зачистка', 'Зачистка', 'cleaning'::public.stage_type),
    ('Малярка', 'Малярка', 'painting'::public.stage_type),
    ('Упаковка', 'Упаковка', 'packaging'::public.stage_type),
    ('Отгрузка', 'Отгрузка', 'actual_shipping'::public.stage_type)
)
update public.production_fact_sections child
set production_stage_type = standard.stage_type,
    updated_at = now()
from public.production_fact_sections parent, standard
where child.parent_id = parent.id
  and lower(btrim(parent.name)) = lower(standard.parent_name)
  and lower(btrim(child.name)) = lower(standard.child_name);

alter table public.production_tonnage_facts
  add column if not exists source text not null default 'legacy_manual';

alter table public.production_tonnage_facts
  drop constraint if exists production_tonnage_facts_source_supported;

alter table public.production_tonnage_facts
  add constraint production_tonnage_facts_source_supported
  check (source in ('legacy_manual', 'itemized'));

create table if not exists public.production_machine_item_facts (
  id uuid primary key default gen_random_uuid(),
  production_machine_fact_id uuid not null
    references public.production_machine_facts(id) on delete cascade,
  machine_item_id uuid references public.machine_items(id) on delete set null,
  machine_item_snapshot_id uuid not null,
  stage_type public.stage_type not null,
  product_name text not null check (length(btrim(product_name)) > 0),
  drawing_number text not null,
  coating public.coating_type not null,
  ordered_quantity integer not null check (ordered_quantity > 0),
  quantity integer not null check (quantity > 0),
  unit_weight_kg numeric(12, 3) not null check (unit_weight_kg > 0),
  total_weight_kg numeric(14, 3)
    generated always as (round(quantity::numeric * unit_weight_kg, 3)) stored,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_machine_item_facts_stage_supported
    check (stage_type in (
      'assembly'::public.stage_type,
      'cleaning'::public.stage_type,
      'painting'::public.stage_type,
      'packaging'::public.stage_type
    )),
  constraint production_machine_item_facts_unique_item
    unique (production_machine_fact_id, machine_item_snapshot_id)
);

create index if not exists production_machine_item_facts_header_idx
  on public.production_machine_item_facts(production_machine_fact_id);
create index if not exists production_machine_item_facts_item_stage_idx
  on public.production_machine_item_facts(machine_item_snapshot_id, stage_type);

create table if not exists public.factory_work_calendar_exceptions (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  work_date date not null,
  is_working boolean not null,
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_work_calendar_exceptions_unique_date unique (factory_id, work_date)
);

create index if not exists factory_work_calendar_exceptions_period_idx
  on public.factory_work_calendar_exceptions(factory_id, work_date);

create table if not exists public.production_section_capacity_periods (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  section_id uuid not null references public.production_fact_sections(id) on delete cascade,
  valid_from date not null,
  valid_to date,
  tons_per_workday numeric(12, 3) not null check (tons_per_workday > 0),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_section_capacity_periods_valid_range
    check (valid_to is null or valid_to >= valid_from)
);

create index if not exists production_section_capacity_periods_lookup_idx
  on public.production_section_capacity_periods(factory_id, section_id, valid_from, valid_to);

create or replace function public.touch_production_analytics_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_production_machine_item_fact_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_header record;
  v_item record;
  v_stage_type public.stage_type;
begin
  select fact.machine_id, fact.factory_id,
         coalesce(section.production_stage_type, parent.production_stage_type) as stage_type
    into v_header
  from public.production_machine_facts fact
  join public.production_fact_sections section on section.id = fact.section_id
  left join public.production_fact_sections parent on parent.id = section.parent_id
  where fact.id = new.production_machine_fact_id;

  if not found then
    if tg_op = 'UPDATE'
       and old.machine_item_id is not null
       and new.machine_item_id is null then
      return new;
    end if;
    raise exception 'Заголовок факта производства не найден';
  end if;

  v_stage_type := v_header.stage_type;
  if v_stage_type is distinct from new.stage_type then
    raise exception 'Номенклатура не соответствует этапу участка';
  end if;

  if new.machine_item_id is not null then
    select machine_id, quantity, weight, product_name, drawing_number, coating
      into v_item
    from public.machine_items
    where id = new.machine_item_id;

    if not found or v_item.machine_id is distinct from v_header.machine_id then
      raise exception 'Позиция не относится к выбранному заказу';
    end if;
    if new.machine_item_snapshot_id is distinct from new.machine_item_id then
      raise exception 'Некорректный идентификатор снимка позиции';
    end if;
  end if;

  if new.stage_type = 'painting'::public.stage_type
     and new.coating <> 'powder_coating'::public.coating_type then
    raise exception 'Для малярки доступны только позиции с порошковой окраской';
  end if;

  return new;
end;
$$;

create or replace function public.validate_production_capacity_period_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_section record;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.section_id::text, 0));

  select section.factory_id,
         section.parent_id,
         coalesce(section.production_stage_type, parent.production_stage_type) as stage_type
    into v_section
  from public.production_fact_sections section
  left join public.production_fact_sections parent on parent.id = section.parent_id
  where section.id = new.section_id;

  if not found or v_section.factory_id is distinct from new.factory_id then
    raise exception 'Участок мощности относится к другому заводу';
  end if;
  if v_section.parent_id is null then
    raise exception 'Мощность задаётся для подучастка';
  end if;
  if v_section.stage_type not in (
    'assembly'::public.stage_type,
    'cleaning'::public.stage_type,
    'painting'::public.stage_type,
    'packaging'::public.stage_type
  ) then
    raise exception 'Для этого участка мощность не поддерживается';
  end if;

  if exists (
    select 1
    from public.production_section_capacity_periods existing
    where existing.section_id = new.section_id
      and existing.id is distinct from new.id
      and daterange(existing.valid_from, coalesce(existing.valid_to, 'infinity'::date), '[]')
          && daterange(new.valid_from, coalesce(new.valid_to, 'infinity'::date), '[]')
  ) then
    raise exception 'Периоды мощности участка не должны пересекаться';
  end if;

  return new;
end;
$$;

drop trigger if exists production_machine_item_facts_touch_updated_at
  on public.production_machine_item_facts;
create trigger production_machine_item_facts_touch_updated_at
  before update on public.production_machine_item_facts
  for each row execute function public.touch_production_analytics_updated_at();

drop trigger if exists production_machine_item_facts_validate
  on public.production_machine_item_facts;
create trigger production_machine_item_facts_validate
  before insert or update on public.production_machine_item_facts
  for each row execute function public.validate_production_machine_item_fact_v1();

drop trigger if exists factory_work_calendar_exceptions_touch_updated_at
  on public.factory_work_calendar_exceptions;
create trigger factory_work_calendar_exceptions_touch_updated_at
  before update on public.factory_work_calendar_exceptions
  for each row execute function public.touch_production_analytics_updated_at();

drop trigger if exists production_section_capacity_periods_touch_updated_at
  on public.production_section_capacity_periods;
create trigger production_section_capacity_periods_touch_updated_at
  before update on public.production_section_capacity_periods
  for each row execute function public.touch_production_analytics_updated_at();

drop trigger if exists production_section_capacity_periods_validate
  on public.production_section_capacity_periods;
create trigger production_section_capacity_periods_validate
  before insert or update on public.production_section_capacity_periods
  for each row execute function public.validate_production_capacity_period_v1();

alter table public.production_machine_item_facts enable row level security;
alter table public.factory_work_calendar_exceptions enable row level security;
alter table public.production_section_capacity_periods enable row level security;

drop policy if exists production_machine_item_facts_select on public.production_machine_item_facts;
create policy production_machine_item_facts_select
  on public.production_machine_item_facts for select to authenticated
  using (
    exists (
      select 1
      from public.production_machine_facts fact
      where fact.id = production_machine_fact_id
        and (
          public.is_director()
          or (
            public.get_user_role() = 'production_manager'
            and fact.factory_id = public.get_user_factory_id()
          )
        )
    )
  );

revoke all on public.production_machine_item_facts from public, anon;
revoke insert, update, delete on public.production_machine_item_facts from authenticated;
grant select on public.production_machine_item_facts to authenticated;
revoke all on public.factory_work_calendar_exceptions from public, anon, authenticated;
revoke all on public.production_section_capacity_periods from public, anon, authenticated;

revoke all on function public.touch_production_analytics_updated_at() from public, anon, authenticated;
revoke all on function public.validate_production_machine_item_fact_v1() from public, anon, authenticated;
revoke all on function public.validate_production_capacity_period_v1() from public, anon, authenticated;

create or replace function public.fn_save_production_machine_item_fact_v1(
  p_factory_id uuid,
  p_fact_date date,
  p_shift public.production_fact_shift,
  p_machine_id uuid,
  p_section_id uuid,
  p_stage_type public.stage_type,
  p_lines jsonb,
  p_comment text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fact_id uuid;
  v_stage_type public.stage_type;
  v_existing_source text;
  v_total_tonnage numeric(12, 3);
  v_line_count integer;
  v_distinct_count integer;
  v_invalid_count integer;
begin
  if p_actor is null then
    raise exception 'Не указан автор факта производства';
  end if;
  if p_stage_type not in (
    'assembly'::public.stage_type,
    'cleaning'::public.stage_type,
    'painting'::public.stage_type,
    'packaging'::public.stage_type
  ) then
    raise exception 'Этап не поддерживает ввод по номенклатуре';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Укажите изготовленное количество';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat('production-tonnage:', p_factory_id, ':', p_fact_date, ':', p_section_id),
    0
  ));

  perform 1
  from public.machines
  where id = p_machine_id
    and factory_id = p_factory_id
    and is_archived = false
  for update;
  if not found then
    raise exception 'Заказ не найден или архивирован';
  end if;

  select coalesce(section.production_stage_type, parent.production_stage_type)
    into v_stage_type
  from public.production_fact_sections section
  left join public.production_fact_sections parent on parent.id = section.parent_id
  where section.id = p_section_id
    and section.factory_id = p_factory_id
    and section.parent_id is not null
    and section.is_active = true
    and section.archived_at is null
    and parent.is_active = true
    and parent.archived_at is null;

  if not found or v_stage_type is distinct from p_stage_type then
    raise exception 'Выбранный участок не соответствует этапу';
  end if;

  select source into v_existing_source
  from public.production_tonnage_facts
  where factory_id = p_factory_id
    and fact_date = p_fact_date
    and section_id = p_section_id
  for update;
  if found and v_existing_source = 'legacy_manual' then
    raise exception 'На эту дату уже сохранён исторический ручной тоннаж';
  end if;

  select count(*), count(distinct line.machine_item_id)
    into v_line_count, v_distinct_count
  from jsonb_to_recordset(p_lines) as line(machine_item_id uuid, quantity integer);
  if v_line_count <> v_distinct_count then
    raise exception 'Одна позиция указана несколько раз';
  end if;

  perform 1
  from public.machine_items item
  where item.machine_id = p_machine_id
  order by item.id
  for update;

  select count(*) into v_invalid_count
  from jsonb_to_recordset(p_lines) as line(machine_item_id uuid, quantity integer)
  left join public.machine_items item
    on item.id = line.machine_item_id and item.machine_id = p_machine_id
  where item.id is null
     or line.quantity is null
     or line.quantity <= 0
     or item.quantity <= 0
     or item.weight <= 0
     or (
       p_stage_type = 'painting'::public.stage_type
       and item.coating <> 'powder_coating'::public.coating_type
     );
  if v_invalid_count > 0 then
    raise exception 'Номенклатура или количество заполнены некорректно';
  end if;

  select id into v_fact_id
  from public.production_machine_facts
  where factory_id = p_factory_id
    and fact_date = p_fact_date
    and shift = p_shift
    and machine_id = p_machine_id
    and section_id = p_section_id
  for update;

  if v_fact_id is null then
    insert into public.production_machine_facts(
      factory_id, fact_date, shift, machine_id, section_id,
      comment, created_by, updated_by
    ) values (
      p_factory_id, p_fact_date, p_shift, p_machine_id, p_section_id,
      nullif(btrim(p_comment), ''), p_actor, p_actor
    )
    returning id into v_fact_id;
  else
    update public.production_machine_facts
    set comment = nullif(btrim(p_comment), ''), updated_by = p_actor
    where id = v_fact_id;
  end if;

  select count(*) into v_invalid_count
  from jsonb_to_recordset(p_lines) as line(machine_item_id uuid, quantity integer)
  join public.machine_items item on item.id = line.machine_item_id
  where line.quantity + coalesce((
    select sum(existing.quantity)
    from public.production_machine_item_facts existing
    join public.production_machine_facts header
      on header.id = existing.production_machine_fact_id
    where existing.machine_item_snapshot_id = item.id
      and existing.stage_type = p_stage_type
      and existing.production_machine_fact_id <> v_fact_id
      and header.machine_id = p_machine_id
  ), 0) > item.quantity;
  if v_invalid_count > 0 then
    raise exception 'Количество превышает остаток по этапу';
  end if;

  delete from public.production_machine_item_facts
  where production_machine_fact_id = v_fact_id;

  insert into public.production_machine_item_facts(
    production_machine_fact_id,
    machine_item_id,
    machine_item_snapshot_id,
    stage_type,
    product_name,
    drawing_number,
    coating,
    ordered_quantity,
    quantity,
    unit_weight_kg,
    created_by,
    updated_by
  )
  select
    v_fact_id,
    item.id,
    item.id,
    p_stage_type,
    item.product_name,
    item.drawing_number,
    item.coating,
    item.quantity,
    line.quantity,
    item.weight,
    p_actor,
    p_actor
  from jsonb_to_recordset(p_lines) as line(machine_item_id uuid, quantity integer)
  join public.machine_items item
    on item.id = line.machine_item_id and item.machine_id = p_machine_id;

  select round(coalesce(sum(item_fact.total_weight_kg), 0) / 1000, 3)
    into v_total_tonnage
  from public.production_machine_item_facts item_fact
  join public.production_machine_facts header
    on header.id = item_fact.production_machine_fact_id
  where header.factory_id = p_factory_id
    and header.fact_date = p_fact_date
    and header.section_id = p_section_id;

  insert into public.production_tonnage_facts(
    factory_id, fact_date, section_id, tonnage, source,
    comment, created_by, updated_by
  ) values (
    p_factory_id, p_fact_date, p_section_id, v_total_tonnage, 'itemized',
    null, p_actor, p_actor
  )
  on conflict (factory_id, fact_date, section_id)
  do update set
    tonnage = excluded.tonnage,
    source = 'itemized',
    comment = null,
    updated_by = p_actor;

  return jsonb_build_object(
    'fact_id', v_fact_id,
    'line_count', v_line_count,
    'tonnage', v_total_tonnage
  );
end;
$$;

create or replace function public.fn_delete_production_machine_item_fact_v1(
  p_fact_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_header record;
  v_total_tonnage numeric(12, 3);
begin
  if p_actor is null then
    raise exception 'Не указан автор факта производства';
  end if;

  select fact.factory_id, fact.fact_date, fact.section_id
    into v_header
  from public.production_machine_facts fact
  where fact.id = p_fact_id
    and exists (
      select 1 from public.production_machine_item_facts item_fact
      where item_fact.production_machine_fact_id = fact.id
    );

  if not found then
    raise exception 'Детализированный факт не найден';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat('production-tonnage:', v_header.factory_id, ':', v_header.fact_date, ':', v_header.section_id),
    0
  ));

  select fact.factory_id, fact.fact_date, fact.section_id
    into v_header
  from public.production_machine_facts fact
  where fact.id = p_fact_id
    and exists (
      select 1 from public.production_machine_item_facts item_fact
      where item_fact.production_machine_fact_id = fact.id
    )
  for update;

  if not found then
    raise exception 'Детализированный факт не найден';
  end if;

  delete from public.production_machine_facts where id = p_fact_id;

  select round(coalesce(sum(item_fact.total_weight_kg), 0) / 1000, 3)
    into v_total_tonnage
  from public.production_machine_item_facts item_fact
  join public.production_machine_facts header
    on header.id = item_fact.production_machine_fact_id
  where header.factory_id = v_header.factory_id
    and header.fact_date = v_header.fact_date
    and header.section_id = v_header.section_id;

  if v_total_tonnage > 0 then
    update public.production_tonnage_facts
    set tonnage = v_total_tonnage,
        source = 'itemized',
        comment = null,
        updated_by = p_actor
    where factory_id = v_header.factory_id
      and fact_date = v_header.fact_date
      and section_id = v_header.section_id
      and source = 'itemized';
  else
    delete from public.production_tonnage_facts
    where factory_id = v_header.factory_id
      and fact_date = v_header.fact_date
      and section_id = v_header.section_id
      and source = 'itemized';
  end if;

  return jsonb_build_object('tonnage', v_total_tonnage);
end;
$$;

revoke all on function public.fn_save_production_machine_item_fact_v1(
  uuid, date, public.production_fact_shift, uuid, uuid,
  public.stage_type, jsonb, text, uuid
) from public, anon, authenticated;
grant execute on function public.fn_save_production_machine_item_fact_v1(
  uuid, date, public.production_fact_shift, uuid, uuid,
  public.stage_type, jsonb, text, uuid
) to service_role;

revoke all on function public.fn_delete_production_machine_item_fact_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_delete_production_machine_item_fact_v1(uuid, uuid)
  to service_role;
