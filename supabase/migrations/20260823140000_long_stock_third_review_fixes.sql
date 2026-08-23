-- Third-review correctness fixes for long-stock inventory, cutting plans and
-- production facts. Application authorization remains in server actions;
-- privileged mutation functions are service-role-only boundaries.

-- A draft may only be approved against the exact settings revision used for
-- its calculation. Lock the singleton settings row so an approval and a
-- settings update cannot cross between the comparison and commit.
create or replace function public.fn_guard_long_stock_cutting_approval_revision_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_revision bigint;
  v_snapshot_revision bigint;
begin
  if old.status = 'draft' and new.status = 'approved' then
    select revision
    into v_current_revision
    from public.long_stock_layout_settings
    where id = true
    for share;

    v_snapshot_revision := nullif(old.settings_snapshot->>'revision', '')::bigint;
    if v_snapshot_revision is null
      or v_snapshot_revision is distinct from v_current_revision then
      raise exception
        'Настройки раскладки изменились: черновик рассчитан по ревизии %, текущая ревизия %. Пересчитайте карту перед утверждением',
        coalesce(v_snapshot_revision::text, 'не указана'),
        coalesce(v_current_revision::text, 'не найдена');
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.fn_guard_long_stock_cutting_approval_revision_v1()
  from public, anon, authenticated;

drop trigger if exists long_stock_cutting_approval_revision_guard_trigger
  on public.long_stock_cutting_plan_versions;
create trigger long_stock_cutting_approval_revision_guard_trigger
before update of status on public.long_stock_cutting_plan_versions
for each row
when (old.status = 'draft' and new.status = 'approved')
execute function public.fn_guard_long_stock_cutting_approval_revision_v1();

-- Exact future scraps are created per physical bar by the approved cutting
-- version. The legacy receiving/whole-bar helpers only knew the logical
-- demand, so their aggregate `physical - logical` remainder is never valid:
-- with a map it duplicates the exact rows, without a map it omits kerf.
create or replace function public.fn_prepare_supply_bar_future_scrap(
  p_reservation_id uuid,
  p_performed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_scrap_id uuid;
begin
  select business_scrap_inventory_id
  into v_existing_scrap_id
  from public.inventory_reservations
  where id = p_reservation_id
  for update;

  if not found then
    raise exception 'Бронь принятого хлыста не найдена';
  end if;

  -- Keep already-created historical rows linked, but never calculate a new
  -- aggregate remainder from reservation quantities.
  return v_existing_scrap_id;
end;
$$;

revoke all on function public.fn_prepare_supply_bar_future_scrap(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_prepare_supply_bar_future_scrap(uuid, uuid)
  to service_role;

create or replace function public.fn_prepare_whole_bar_stock_future_scrap(
  p_reservation_id uuid,
  p_performed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_scrap_id uuid;
begin
  select business_scrap_inventory_id
  into v_existing_scrap_id
  from public.inventory_reservations
  where id = p_reservation_id
  for update;

  if not found then
    raise exception 'Бронь складского хлыста не найдена';
  end if;

  return v_existing_scrap_id;
end;
$$;

revoke all on function public.fn_prepare_whole_bar_stock_future_scrap(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_prepare_whole_bar_stock_future_scrap(uuid, uuid)
  to service_role;

-- Knives use the same physical whole-bar lifecycle as circles and non-wire
-- pipes. Exact material_variant_id includes the knife dimensions and bevel.
create or replace function public.fn_whole_bar_request_matches_inventory(
  p_request_item_table text,
  p_request_item_id uuid,
  p_inventory_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_inventory public.inventory%rowtype;
  v_variant public.material_variants%rowtype;
  v_circle public.request_circle%rowtype;
  v_pipe public.request_pipe%rowtype;
  v_knife public.request_knives%rowtype;
begin
  select * into v_inventory
  from public.inventory
  where id = p_inventory_id
    and deleted_at is null;

  if not found or v_inventory.material_variant_id is null then
    return false;
  end if;

  select * into v_variant
  from public.material_variants
  where id = v_inventory.material_variant_id;

  if not found or v_variant.material_id is distinct from v_inventory.material_id then
    return false;
  end if;

  if p_request_item_table = 'request_circle' then
    select * into v_circle from public.request_circle where id = p_request_item_id;
    if not found or v_circle.material_id is distinct from v_inventory.material_id then
      return false;
    end if;
    return v_variant.category = 'circle'::public.material_category
      and v_variant.diameter_mm is not distinct from v_circle.diameter_mm
      and v_variant.steel_type_id is not distinct from v_circle.steel_type_id
      and lower(btrim(coalesce(v_variant.material_grade, ''))) = lower(btrim(coalesce(v_circle.steel_grade, '')))
      and coalesce(v_variant.is_calibrated, false) = coalesce(v_circle.is_calibrated, false);
  end if;

  if p_request_item_table = 'request_pipe' then
    select * into v_pipe from public.request_pipe where id = p_request_item_id;
    if not found
      or v_pipe.pipe_type = 'wire'::public.pipe_subtype
      or v_pipe.material_id is distinct from v_inventory.material_id then
      return false;
    end if;
    return v_variant.category = 'pipe'::public.material_category
      and v_variant.pipe_type is not distinct from v_pipe.pipe_type
      and lower(regexp_replace(coalesce(v_variant.piece_description, ''), '[[:space:]]', '', 'g'))
        = lower(regexp_replace(coalesce(v_pipe.size, ''), '[[:space:]]', '', 'g'))
      and v_variant.wall_thickness_mm is not distinct from v_pipe.wall_thickness_mm
      and v_variant.diameter_mm is not distinct from v_pipe.diameter_mm
      and v_variant.steel_type_id is not distinct from v_pipe.steel_type_id;
  end if;

  if p_request_item_table = 'request_knives' then
    select * into v_knife from public.request_knives where id = p_request_item_id;
    if not found or v_knife.material_id is distinct from v_inventory.material_id then
      return false;
    end if;
    return v_variant.category = 'knives'::public.material_category
      and v_knife.material_variant_id is not distinct from v_inventory.material_variant_id;
  end if;

  return false;
end;
$$;

revoke all on function public.fn_whole_bar_request_matches_inventory(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_whole_bar_request_matches_inventory(text, uuid, uuid)
  to service_role;

-- Remove the obsolete material-only overload. It cannot preserve exact
-- variant/length identity and is no longer used by the application.
drop function if exists public.fn_reserve_inventory_for_machine(
  uuid, uuid, numeric, text, uuid, uuid, numeric
);

-- Retain the generic implementations for non-long-stock rows, but force every
-- measured long-stock call through whole-bar reservations. That path leaves
-- remainder ownership to the approved map.
alter function public.fn_reserve_inventory_for_machine(
  uuid, uuid, numeric, text, uuid, uuid, numeric, uuid, numeric
) rename to fn_reserve_inventory_for_machine_before_long_stock_map_v1;

revoke all on function public.fn_reserve_inventory_for_machine_before_long_stock_map_v1(
  uuid, uuid, numeric, text, uuid, uuid, numeric, uuid, numeric
) from public, anon, authenticated;

create function public.fn_reserve_inventory_for_machine(
  p_material_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric default null,
  p_material_variant_id uuid default null,
  p_piece_length_mm numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_request_item_table in ('request_knives', 'request_circle', 'request_pipe')
    and p_piece_length_mm is not null then
    raise exception
      'Мерный длинномер резервируется только из конкретной складской строки по карте раскроя';
  end if;

  return public.fn_reserve_inventory_for_machine_before_long_stock_map_v1(
    p_material_id,
    p_machine_id,
    p_quantity,
    p_request_item_table,
    p_request_item_id,
    p_reserved_by,
    p_secondary_quantity,
    p_material_variant_id,
    p_piece_length_mm
  );
end;
$$;

alter function public.fn_reserve_inventory_row_for_machine(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) rename to fn_reserve_inventory_row_for_machine_before_long_stock_map_v1;

revoke all on function public.fn_reserve_inventory_row_for_machine_before_long_stock_map_v1(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) from public, anon, authenticated;

create function public.fn_reserve_inventory_row_for_machine(
  p_inventory_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric default null,
  p_is_cut_reservation boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_piece_length_mm numeric;
begin
  select piece_length_mm
  into v_piece_length_mm
  from public.inventory
  where id = p_inventory_id
    and deleted_at is null;

  if p_request_item_table in ('request_knives', 'request_circle', 'request_pipe')
    and v_piece_length_mm is not null then
    return public.fn_reserve_whole_bar_inventory_row_for_machine(
      p_inventory_id,
      p_machine_id,
      p_quantity,
      p_request_item_table,
      p_request_item_id,
      p_reserved_by
    );
  end if;

  return public.fn_reserve_inventory_row_for_machine_before_long_stock_map_v1(
    p_inventory_id,
    p_machine_id,
    p_quantity,
    p_request_item_table,
    p_request_item_id,
    p_reserved_by,
    p_secondary_quantity,
    p_is_cut_reservation
  );
end;
$$;

-- The inter-factory row RPC used the same kerf-blind cutting branch. Preserve
-- its public business API for non-long-stock transfers, but route measured
-- long stock through the physical whole-bar transfer function.
alter function public.fn_reserve_inventory_row_for_machine_transfer(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) rename to fn_reserve_inventory_row_transfer_pre_map_v1;

revoke all on function public.fn_reserve_inventory_row_transfer_pre_map_v1(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) from public, anon, authenticated;
grant execute on function public.fn_reserve_inventory_row_transfer_pre_map_v1(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) to service_role;

create function public.fn_reserve_inventory_row_for_machine_transfer(
  p_inventory_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric default null,
  p_is_cut_reservation boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_piece_length_mm numeric;
begin
  select piece_length_mm
  into v_piece_length_mm
  from public.inventory
  where id = p_inventory_id
    and deleted_at is null;

  if p_request_item_table in ('request_knives', 'request_circle', 'request_pipe')
    and v_piece_length_mm is not null then
    return public.fn_reserve_whole_bar_inventory_row_for_machine_transfer(
      p_inventory_id,
      p_machine_id,
      p_quantity,
      p_request_item_table,
      p_request_item_id,
      p_reserved_by
    );
  end if;

  return public.fn_reserve_inventory_row_transfer_pre_map_v1(
    p_inventory_id,
    p_machine_id,
    p_quantity,
    p_request_item_table,
    p_request_item_id,
    p_reserved_by,
    p_secondary_quantity,
    p_is_cut_reservation
  );
end;
$$;

revoke all on function public.fn_reserve_inventory_row_for_machine_transfer(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) from public, anon;
grant execute on function public.fn_reserve_inventory_row_for_machine_transfer(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) to authenticated, service_role;

-- A measured warehouse row represents whole physical pieces. Enforce that
-- identity on every future insert/change, regardless of which RPC performs it.
create or replace function public.fn_inventory_measured_quantity_consistency_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected_total numeric;
begin
  if new.piece_length_mm is null then
    return new;
  end if;

  if new.piece_length_mm <= 0 then
    raise exception 'Длина мерной складской строки должна быть больше 0';
  end if;
  if new.total_secondary_quantity is null
    or new.total_secondary_quantity < 0
    or new.total_secondary_quantity <> trunc(new.total_secondary_quantity) then
    raise exception 'Для мерной складской строки нужно целое количество штук';
  end if;

  v_expected_total := new.piece_length_mm * new.total_secondary_quantity;
  if new.total_quantity is distinct from v_expected_total then
    raise exception
      'Введено общее количество % мм, но по длине и числу штук получилось бы % мм',
      coalesce(new.total_quantity::text, 'NULL'),
      v_expected_total;
  end if;

  return new;
end;
$$;

revoke all on function public.fn_inventory_measured_quantity_consistency_v1()
  from public, anon, authenticated;

drop trigger if exists inventory_piece_quantity_consistency_trigger
  on public.inventory;
create trigger inventory_piece_quantity_consistency_trigger
before insert or update of piece_length_mm, total_quantity, total_secondary_quantity
on public.inventory
for each row
execute function public.fn_inventory_measured_quantity_consistency_v1();

create or replace function public.fn_adjust_inventory_record(
  p_inventory_id uuid,
  p_new_total numeric,
  p_performed_by uuid,
  p_comment text,
  p_new_secondary_total numeric default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inventory public.inventory%rowtype;
  v_effective_total numeric;
  v_expected_total numeric;
  v_diff numeric;
  v_secondary_diff numeric;
begin
  if p_comment is null or btrim(p_comment) = '' then
    raise exception 'Укажите причину корректировки';
  end if;

  select * into v_inventory
  from public.inventory
  where id = p_inventory_id
  for update;
  if not found then
    raise exception 'Остаток материала не найден';
  end if;

  v_effective_total := p_new_total;
  if v_inventory.piece_length_mm is not null then
    if p_new_secondary_total is null
      or p_new_secondary_total < 0
      or p_new_secondary_total <> trunc(p_new_secondary_total) then
      raise exception 'Для мерной складской строки корректируется целое количество штук';
    end if;

    v_expected_total := v_inventory.piece_length_mm * p_new_secondary_total;
    if p_new_total is distinct from v_expected_total then
      raise exception
        'Введено общее количество % мм, но по длине и числу штук получилось бы % мм',
        coalesce(p_new_total::text, 'NULL'),
        v_expected_total;
    end if;
    v_effective_total := v_expected_total;
  elsif p_new_total is null or p_new_total < 0 then
    raise exception 'Новое количество должно быть неотрицательным';
  end if;

  if v_effective_total < v_inventory.reserved_quantity then
    raise exception 'Новый остаток меньше забронированного количества';
  end if;
  if p_new_secondary_total is not null
    and p_new_secondary_total < coalesce(v_inventory.reserved_secondary_quantity, 0) then
    raise exception 'Новый вторичный остаток меньше забронированного количества';
  end if;

  v_diff := v_effective_total - v_inventory.total_quantity;
  v_secondary_diff := case
    when p_new_secondary_total is null then null
    else p_new_secondary_total - coalesce(v_inventory.total_secondary_quantity, 0)
  end;

  update public.inventory
  set total_quantity = v_effective_total,
      total_secondary_quantity = coalesce(p_new_secondary_total, total_secondary_quantity),
      reserved_secondary_quantity = case
        when p_new_secondary_total is null then reserved_secondary_quantity
        else coalesce(reserved_secondary_quantity, 0)
      end,
      last_updated_by = p_performed_by,
      updated_at = now()
  where id = p_inventory_id;

  insert into public.inventory_transactions(
    factory_id, inventory_id, material_id, material_variant_id,
    transaction_type, quantity, secondary_quantity, performed_by, comment
  ) values (
    v_inventory.factory_id,
    v_inventory.id,
    v_inventory.material_id,
    v_inventory.material_variant_id,
    'adjustment',
    v_diff,
    v_secondary_diff,
    p_performed_by,
    p_comment
  );
end;
$$;

-- Delete the fact and create/update the rollback review task, event links and
-- notification in one PostgreSQL transaction. Any failure rolls back DELETE.
create or replace function public.fn_delete_production_machine_fact_atomic_v1(
  p_fact_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fact public.production_machine_facts%rowtype;
  v_machine_id uuid;
  v_machine_name text;
  v_machine_factory_id uuid;
  v_effective_stage public.stage_type;
  v_assigned_to uuid;
  v_task_id uuid;
  v_today date := (now() at time zone 'Europe/Chisinau')::date;
  v_title text;
  v_description text;
begin
  if p_actor is null then
    raise exception 'Не указан автор удаления факта';
  end if;

  select machine_id
  into v_machine_id
  from public.production_machine_facts
  where id = p_fact_id;
  if not found then
    raise exception 'Запись факта не найдена';
  end if;

  perform public.fn_lock_production_cutting_machine_v1(v_machine_id);

  select fact.*
  into v_fact
  from public.production_machine_facts fact
  where fact.id = p_fact_id
  for update of fact;
  if not found then
    raise exception 'Запись факта не найдена';
  end if;
  if v_fact.machine_id is distinct from v_machine_id then
    raise exception 'Машина факта изменилась во время удаления';
  end if;

  select coalesce(section.production_stage_type, parent.production_stage_type)
  into v_effective_stage
  from public.production_fact_sections section
  left join public.production_fact_sections parent on parent.id = section.parent_id
  where section.id = v_fact.section_id;

  delete from public.production_machine_facts
  where id = v_fact.id;

  if v_effective_stage is distinct from 'cutting'::public.stage_type
    or exists (
      select 1
      from public.production_machine_facts remaining_fact
      join public.production_fact_sections section on section.id = remaining_fact.section_id
      left join public.production_fact_sections parent on parent.id = section.parent_id
      where remaining_fact.machine_id = v_machine_id
        and coalesce(section.production_stage_type, parent.production_stage_type)
          = 'cutting'::public.stage_type
    ) then
    return jsonb_build_object(
      'machine_id', v_machine_id,
      'task_id', null,
      'assigned_to', null
    );
  end if;

  select machine.name, machine.factory_id
  into v_machine_name, v_machine_factory_id
  from public.machines machine
  where machine.id = v_machine_id;
  v_machine_name := coalesce(v_machine_name, 'машина');

  select app_user.id
  into v_assigned_to
  from public.company_settings settings
  join public.users app_user
    on app_user.id = settings.auto_task_technologist_user_id
   and app_user.role = 'technologist'::public.user_role
   and app_user.is_active = true
  limit 1;

  if v_assigned_to is null then
    select app_user.id
    into v_assigned_to
    from public.users app_user
    where app_user.role = 'technologist'::public.user_role
      and app_user.is_active = true
    order by
      case when v_machine_factory_id is not null
        and app_user.factory_id = v_machine_factory_id then 0 else 1 end,
      app_user.full_name,
      app_user.id
    limit 1;
  end if;
  v_assigned_to := coalesce(v_assigned_to, p_actor);

  v_title := 'Проверить откат заготовки: ' || v_machine_name;
  v_description := concat_ws(E'\n',
    'Последний факт заготовки по машине удален или перенесен.',
    'Склад автоматически не откатывался.',
    'Откройте задачу, чтобы посмотреть preview и выбрать автоматический откат или оставить списание как есть.',
    'Причина: Факт заготовки удален'
  );

  select task.id
  into v_task_id
  from public.tasks task
  where task.machine_id = v_machine_id
    and task.task_type = 'production_cutting_rollback_review'::public.task_type
    and task.status in ('pending'::public.task_status, 'in_progress'::public.task_status)
  order by task.created_at, task.id
  limit 1
  for update;

  if v_task_id is null then
    insert into public.tasks(
      machine_id, assigned_to, task_type, title, description,
      status, start_date, deadline
    ) values (
      v_machine_id,
      v_assigned_to,
      'production_cutting_rollback_review'::public.task_type,
      v_title,
      v_description,
      'pending'::public.task_status,
      v_today,
      v_today
    )
    returning id into v_task_id;
  else
    update public.tasks
    set assigned_to = v_assigned_to,
        title = v_title,
        description = v_description,
        status = 'pending'::public.task_status,
        start_date = v_today,
        deadline = v_today,
        completed_at = null,
        updated_at = now()
    where id = v_task_id;
  end if;

  update public.production_fact_cutting_events
  set rollback_task_id = v_task_id
  where machine_id = v_machine_id
    and status = 'applied';

  insert into public.notifications(
    user_id, type, title, message, related_machine_id
  ) values (
    v_assigned_to,
    'task_created',
    'Нужен review отката заготовки',
    'По машине "' || v_machine_name
      || '" удален или перенесен последний факт заготовки. Откройте задачу для preview автоматического отката.',
    v_machine_id
  );

  return jsonb_build_object(
    'machine_id', v_machine_id,
    'task_id', v_task_id,
    'assigned_to', v_assigned_to
  );
end;
$$;

-- Close every overload of the privileged mutation names, including any old
-- signatures left by rename-based migrations. Only current wrappers are
-- granted back to service_role below.
do $$
declare
  v_function record;
begin
  for v_function in
    select procedure.proname,
           pg_get_function_identity_arguments(procedure.oid) as identity_arguments
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'fn_reserve_inventory_for_machine',
        'fn_reserve_inventory_row_for_machine',
        'fn_adjust_inventory_record',
        'fn_archive_inventory_item',
        'fn_reserve_whole_bar_inventory_row_for_machine',
        'fn_unreserve_inventory_reservation',
        'fn_unreserve_inventory_reservation_before_whole_bar',
        'fn_promote_due_future_business_scrap'
      ])
  loop
    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated',
      v_function.proname,
      v_function.identity_arguments
    );
  end loop;
end;
$$;

grant execute on function public.fn_reserve_inventory_for_machine(
  uuid, uuid, numeric, text, uuid, uuid, numeric, uuid, numeric
) to service_role;
grant execute on function public.fn_reserve_inventory_row_for_machine(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) to service_role;
grant execute on function public.fn_adjust_inventory_record(
  uuid, numeric, uuid, text, numeric
) to service_role;
grant execute on function public.fn_archive_inventory_item(uuid, uuid, text)
  to service_role;
grant execute on function public.fn_delete_production_machine_fact_atomic_v1(uuid, uuid)
  to service_role;

revoke all on function public.fn_delete_production_machine_fact_atomic_v1(uuid, uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
