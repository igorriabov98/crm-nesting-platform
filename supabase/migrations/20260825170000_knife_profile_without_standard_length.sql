-- Separate the immutable knife profile from request cuts and physical warehouse
-- bar lengths. This migration is deliberately non-destructive: legacy knife
-- data remains readable until the separately approved reset is executed.

comment on column public.material_variants.standard_length_mm is
  'Deprecated for knives. Physical length belongs to inventory.piece_length_mm; required cuts belong to long_stock_cutting_segments.required_length_mm.';
comment on column public.material_variants.knife_dimensions is
  'Deprecated for knives. Knife profile dimensions are width_mm and height_mm.';
comment on column public.request_knives.length_mm is
  'Deprecated compatibility column. Knife cut lengths are stored in long_stock_cutting_segments.required_length_mm.';

create or replace function public.fn_guard_knife_profile_without_length_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.category <> 'knives'::public.material_category then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.standard_length_mm is not null or nullif(btrim(coalesce(new.knife_dimensions, '')), '') is not null then
      raise exception 'В профиле ножа нельзя указывать длину; задайте только ширину, высоту и скос';
    end if;
    return new;
  end if;

  -- Let unrelated updates continue to work for legacy rows before the approved
  -- reset. Any attempt to introduce or change a legacy length representation is
  -- rejected; clearing it is allowed.
  if (
      new.category is distinct from old.category
      or new.standard_length_mm is distinct from old.standard_length_mm
      or new.knife_dimensions is distinct from old.knife_dimensions
    ) and (
      new.standard_length_mm is not null
      or nullif(btrim(coalesce(new.knife_dimensions, '')), '') is not null
    ) then
    raise exception 'В профиле ножа нельзя указывать длину; задайте только ширину, высоту и скос';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_guard_knife_profile_without_length_v1()
  from public, anon, authenticated;

drop trigger if exists material_variants_knife_profile_without_length_guard
  on public.material_variants;
drop trigger if exists aa_material_variants_knife_profile_input_guard
  on public.material_variants;
create trigger aa_material_variants_knife_profile_input_guard
before insert or update of category, standard_length_mm, knife_dimensions
on public.material_variants
for each row
execute function public.fn_guard_knife_profile_without_length_v1();

-- Some compatible installations still have the earlier characteristic-key
-- trigger, which derives knife_dimensions after the input guard has run.
-- This alphabetically-last trigger removes that derived legacy value before
-- constraints and the row write are completed.
create or replace function public.fn_normalize_knife_profile_without_length_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.category = 'knives'::public.material_category then
    new.standard_length_mm := null;
    new.knife_dimensions := null;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_normalize_knife_profile_without_length_v1()
  from public, anon, authenticated;

drop trigger if exists zz_material_variants_knife_profile_normalize
  on public.material_variants;
create trigger zz_material_variants_knife_profile_normalize
before insert or update of category, standard_length_mm, knife_dimensions, width_mm, height_mm
on public.material_variants
for each row
execute function public.fn_normalize_knife_profile_without_length_v1();

create or replace function public.fn_clear_deprecated_request_knife_length_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.length_mm := null;
  return new;
end;
$$;

revoke all on function public.fn_clear_deprecated_request_knife_length_v1()
  from public, anon, authenticated;

drop trigger if exists request_knives_clear_deprecated_length
  on public.request_knives;
create trigger request_knives_clear_deprecated_length
before insert or update of length_mm
on public.request_knives
for each row
execute function public.fn_clear_deprecated_request_knife_length_v1();

-- A virtual receiving row has no schedule id yet. Create that row under the
-- request-item lock before previewing the receipt, so every inventory-changing
-- call is tied to one stable schedule id and a retry cannot create a second
-- receipt for the same operation.
create or replace function public.fn_ensure_long_stock_receiving_schedule_v1(
  p_request_item_table text,
  p_request_item_id uuid,
  p_delivery_date date,
  p_quantity numeric,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_schedule_id uuid;
  v_supplier_id uuid;
begin
  if p_request_item_table not in ('request_knives', 'request_circle', 'request_pipe') then
    raise exception 'Некорректная категория длинномера';
  end if;
  if p_delivery_date is null or coalesce(p_quantity, 0) <= 0 then
    raise exception 'Некорректный план поставки длинномера';
  end if;
  if not exists (select 1 from public.users where id = p_actor) then
    raise exception 'Пользователь приёмки не найден';
  end if;

  execute format(
    'select to_jsonb(item) from public.%I item where item.id = $1 for update',
    p_request_item_table
  ) into v_item using p_request_item_id;

  if v_item is null then
    raise exception 'Позиция закупки не найдена';
  end if;
  if coalesce(v_item->>'order_status', '') <> 'ordered' then
    raise exception 'Поставку можно принять только после отметки позиции "Заказано"';
  end if;
  if p_request_item_table = 'request_pipe'
    and coalesce(v_item->>'pipe_type', '') = 'wire' then
    raise exception 'Проволока не принимается как хлыст';
  end if;

  select schedule.id
  into v_schedule_id
  from public.supply_order_delivery_schedules schedule
  where schedule.request_item_table = p_request_item_table
    and schedule.request_item_id = p_request_item_id
    and schedule.status = 'planned'
  order by schedule.created_at, schedule.id
  limit 1
  for update;

  if v_schedule_id is not null then
    return v_schedule_id;
  end if;

  v_supplier_id := nullif(v_item->>'supplier_id', '')::uuid;
  if v_supplier_id is null then
    raise exception 'Назначьте поставщика для позиции';
  end if;

  insert into public.supply_order_delivery_schedules (
    request_item_table,
    request_item_id,
    delivery_date,
    quantity,
    unit,
    supplier_id,
    created_by,
    updated_by
  ) values (
    p_request_item_table,
    p_request_item_id,
    p_delivery_date,
    p_quantity,
    'мм',
    v_supplier_id,
    p_actor,
    p_actor
  )
  returning id into v_schedule_id;

  return v_schedule_id;
end;
$$;

revoke all on function public.fn_ensure_long_stock_receiving_schedule_v1(text, uuid, date, numeric, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_ensure_long_stock_receiving_schedule_v1(text, uuid, date, numeric, uuid)
  to service_role;

-- Preserve the legacy function for non-long-stock categories, but make the
-- public entry point reject knives, circles and non-wire pipes. Their receipt
-- must use fn_receive_supply_order_schedule_v2 with one measured length.
alter function public.fn_mark_supply_order_delivered(jsonb, uuid)
  rename to fn_mark_supply_order_delivered_before_measured_long_stock_v1;

revoke all on function public.fn_mark_supply_order_delivered_before_measured_long_stock_v1(jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_mark_supply_order_delivered_before_measured_long_stock_v1(jsonb, uuid)
  to service_role;

create function public.fn_mark_supply_order_delivered(
  p_items jsonb,
  p_performed_by uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_table text;
  v_id uuid;
  v_pipe_type public.pipe_subtype;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Выберите позиции';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_table := v_item->>'table';
    v_id := nullif(v_item->>'id', '')::uuid;

    if v_table in ('request_knives', 'request_circle') then
      raise exception 'Длинномер принимается только через форму фактической приёмки';
    end if;

    if v_table = 'request_pipe' then
      select pipe_type into v_pipe_type
      from public.request_pipe
      where id = v_id;
      if not found then
        raise exception 'Позиция закупки не найдена';
      end if;
      if v_pipe_type <> 'wire'::public.pipe_subtype then
        raise exception 'Длинномер принимается только через форму фактической приёмки';
      end if;
    end if;
  end loop;

  perform public.fn_mark_supply_order_delivered_before_measured_long_stock_v1(
    p_items,
    p_performed_by
  );
end;
$$;

revoke all on function public.fn_mark_supply_order_delivered(jsonb, uuid)
  from public, anon;
grant execute on function public.fn_mark_supply_order_delivered(jsonb, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
