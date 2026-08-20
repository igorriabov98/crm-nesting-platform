-- Supply reads the approved long-stock purchase composition and can return one
-- exact request item to the plan author. The return invalidates the version,
-- releases still-untouched plan reservations and blocks cutting until approval.

alter table public.long_stock_cutting_plan_items
  drop constraint if exists long_stock_cutting_plan_items_cutting_status_check;

alter table public.long_stock_cutting_plan_items
  add constraint long_stock_cutting_plan_items_cutting_status_check
  check (cutting_status in ('planning', 'plan_approved', 'accepted', 'requires_recalculation'));

alter table public.department_requests
  add column if not exists request_item_table text,
  add column if not exists request_item_id uuid,
  add column if not exists technologist_request_id uuid
    references public.technologist_requests(id) on delete restrict,
  add column if not exists long_stock_plan_id uuid
    references public.long_stock_cutting_plans(id) on delete restrict,
  add column if not exists long_stock_returned_version_id uuid
    references public.long_stock_cutting_plan_versions(id) on delete restrict,
  add column if not exists request_item_label text;

alter table public.department_requests
  drop constraint if exists department_requests_kind_check;

alter table public.department_requests
  add constraint department_requests_kind_check
  check (request_kind in ('manual', 'machine_layout', 'long_stock_recalculation'));

alter table public.department_requests
  add constraint department_requests_long_stock_reference_check
  check (
    (
      request_kind = 'long_stock_recalculation'
      and request_item_table in ('request_circle', 'request_pipe', 'request_knives')
      and request_item_id is not null
      and technologist_request_id is not null
      and long_stock_plan_id is not null
      and long_stock_returned_version_id is not null
      and btrim(coalesce(request_item_label, '')) <> ''
    )
    or (
      request_kind <> 'long_stock_recalculation'
      and request_item_table is null
      and request_item_id is null
      and technologist_request_id is null
      and long_stock_plan_id is null
      and long_stock_returned_version_id is null
      and request_item_label is null
    )
  );

create unique index department_requests_open_long_stock_plan_idx
  on public.department_requests(long_stock_plan_id)
  where request_kind = 'long_stock_recalculation'
    and status in ('new', 'in_progress');

alter table public.long_stock_cutting_plan_versions
  add column if not exists invalidation_department_request_id uuid
  references public.department_requests(id) on delete restrict;

do $migration$
declare
  v_constraint_name text;
begin
  select constraint_row.conname
    into v_constraint_name
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.long_stock_cutting_plan_versions'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) like '%invalidation_receipt_schedule_id%'
    and pg_get_constraintdef(constraint_row.oid) like '%status%invalid%'
  limit 1;

  if v_constraint_name is null then
    raise exception 'Не найдено ограничение реквизитов инвалидации версии карты раскроя';
  end if;

  execute format(
    'alter table public.long_stock_cutting_plan_versions drop constraint %I',
    v_constraint_name
  );
end;
$migration$;

alter table public.long_stock_cutting_plan_versions
  add constraint long_stock_cutting_plan_versions_invalidation_check
  check (
    status <> 'invalid'
    or (
      btrim(coalesce(invalidation_reason, '')) <> ''
      and invalidated_by is not null
      and invalidated_at is not null
      and num_nonnulls(
        invalidation_receipt_schedule_id,
        invalidation_department_request_id
      ) = 1
    )
  );

create table public.long_stock_cutting_bar_reservations (
  version_id uuid not null,
  bar_id uuid primary key,
  reservation_id uuid not null unique
    references public.inventory_reservations(id) on delete cascade,
  linked_at timestamptz not null default now(),
  foreign key (version_id, bar_id)
    references public.long_stock_cutting_candidate_bars(version_id, id) on delete restrict
);

revoke all on table public.long_stock_cutting_bar_reservations
  from public, anon, authenticated;
grant select, insert, delete on table public.long_stock_cutting_bar_reservations
  to service_role;

create or replace function public.fn_long_stock_cutting_plan_item_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
  v_material_variant_id uuid;
  v_pipe_type public.pipe_subtype;
  v_plan_variant_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'Связь карты раскроя с позицией заявки неизменяема';
  end if;

  if tg_op = 'UPDATE' then
    if current_setting('app.long_stock_cutting_item_status', true) <> '1' then
      raise exception 'Статус позиции карты раскроя меняется только атомарным RPC';
    end if;
    if new.id is distinct from old.id
      or new.plan_id is distinct from old.plan_id
      or new.request_item_table is distinct from old.request_item_table
      or new.request_item_id is distinct from old.request_item_id
      or new.request_id is distinct from old.request_id
      or new.linked_by is distinct from old.linked_by
      or new.linked_at is distinct from old.linked_at then
      raise exception 'Связь карты раскроя с позицией заявки неизменяема';
    end if;
    return new;
  end if;

  if new.request_item_table = 'request_circle' then
    select request_id, material_variant_id
    into v_request_id, v_material_variant_id
    from public.request_circle where id = new.request_item_id;
  elsif new.request_item_table = 'request_pipe' then
    select request_id, material_variant_id, pipe_type
    into v_request_id, v_material_variant_id, v_pipe_type
    from public.request_pipe where id = new.request_item_id;
    if v_pipe_type = 'wire' then
      raise exception 'Проволока не входит в раскрой длинномера';
    end if;
  elsif new.request_item_table = 'request_knives' then
    select request_id, material_variant_id
    into v_request_id, v_material_variant_id
    from public.request_knives where id = new.request_item_id;
  end if;

  if v_request_id is null then
    raise exception 'Позиция заявки длинномера не найдена';
  end if;
  if v_material_variant_id is null then
    raise exception 'Для позиции заявки не выбран точный вариант материала';
  end if;

  select material_variant_id into v_plan_variant_id
  from public.long_stock_cutting_plans where id = new.plan_id;
  if v_plan_variant_id is distinct from v_material_variant_id then
    raise exception 'Позиции одного плана должны иметь одинаковый вариант материала';
  end if;

  new.request_id := v_request_id;
  return new;
end;
$$;

create or replace function public.protect_department_request_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  is_layout_claim boolean :=
    old.request_kind = 'machine_layout'
    and old.status = 'new'
    and old.assigned_to is null
    and new.status = 'in_progress'
    and new.assigned_to is not null;
  is_long_stock_lifecycle boolean :=
    old.request_kind = 'long_stock_recalculation'
    and current_setting('app.long_stock_recalculation_request_lifecycle', true) = '1';
begin
  if new.created_by is distinct from old.created_by
    or new.target_department is distinct from old.target_department
    or new.factory_id is distinct from old.factory_id
    or new.machine_id is distinct from old.machine_id
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.priority is distinct from old.priority
    or new.request_kind is distinct from old.request_kind
    or new.request_item_table is distinct from old.request_item_table
    or new.request_item_id is distinct from old.request_item_id
    or new.technologist_request_id is distinct from old.technologist_request_id
    or new.long_stock_plan_id is distinct from old.long_stock_plan_id
    or new.long_stock_returned_version_id is distinct from old.long_stock_returned_version_id
    or new.request_item_label is distinct from old.request_item_label
    or (
      new.due_date is distinct from old.due_date
      and not is_layout_claim
    ) then
    raise exception 'Основные данные запроса нельзя менять после отправки';
  end if;

  if old.request_kind = 'long_stock_recalculation'
    and not is_long_stock_lifecycle
    and (
      new.status is distinct from old.status
      or new.assigned_to is distinct from old.assigned_to
      or new.completed_by is distinct from old.completed_by
      or new.completed_at is distinct from old.completed_at
      or new.response is distinct from old.response
    ) then
    raise exception 'Запрос на пересчёт закрывается только утверждением новой версии карты';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.protect_department_request_identity()
  from public, anon, authenticated;

create or replace function public.notify_department_request_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  author_name text;
  actor_name text;
  target_label text;
  status_message text;
begin
  target_label := case new.target_department
    when 'technologist' then 'технологу'
    when 'supply' then 'снабжению'
    else 'производству'
  end;

  if tg_op = 'INSERT' then
    select coalesce(full_name, 'Сотрудник') into author_name
    from public.users
    where id = new.created_by;

    if new.request_kind = 'long_stock_recalculation' then
      insert into public.notifications (
        user_id, type, title, message, related_machine_id,
        related_department_request_id
      )
      select
        new.assigned_to,
        'department_request_new_technologist',
        'Позиция возвращена на пересчёт',
        new.request_item_label || ' · ' || new.description,
        new.machine_id,
        new.id
      where new.assigned_to is not null;
    else
      insert into public.notifications (
        user_id, type, title, message, related_department_request_id
      )
      select distinct
        recipient.user_id,
        'department_request_new_' || new.target_department,
        'Новый запрос: ' || new.title,
        coalesce(author_name, 'Сотрудник') || ' отправил запрос ' || target_label,
        new.id
      from (
        select member.user_id
        from public.department_members member
        join public.departments department on department.id = member.department_id
        where department.is_active
          and (
            (new.target_department = 'technologist'
              and (lower(department.name) like '%техническ%' or lower(department.name) like '%технолог%'))
            or (new.target_department = 'supply'
              and (lower(department.name) like '%снабжен%' or lower(department.name) like '%закуп%'))
            or (new.target_department = 'production'
              and (lower(department.name) like '%производств%' or lower(department.name) like '%цех%')
              and (
                new.factory_id is null
                or department.factory_id is null
                or department.factory_id = new.factory_id
              ))
          )

        union

        select app_user.id
        from public.users app_user
        where app_user.is_active
          and (
            (new.target_department = 'technologist' and app_user.role::text in ('engineer', 'technologist'))
            or (new.target_department = 'supply' and app_user.role::text in ('supply_manager', 'procurement_head'))
            or (
              new.target_department = 'production'
              and app_user.role::text in ('production_manager', 'painting_head')
              and (new.factory_id is null or app_user.factory_id = new.factory_id)
            )
          )
      ) recipient
      where recipient.user_id <> new.created_by;
    end if;
  elsif new.status is distinct from old.status then
    select coalesce(full_name, 'Сотрудник')
      into actor_name
    from public.users
    where id = case
      when new.status = 'in_progress' then new.assigned_to
      when new.status in ('done', 'rejected') then new.completed_by
      else new.created_by
    end;

    status_message := new.title || ': ' || case new.status
      when 'in_progress' then 'в работе · ' || coalesce(actor_name, 'исполнитель назначен')
      when 'done' then 'решён · ' || coalesce(actor_name, 'отдел')
      when 'rejected' then 'отклонён · ' || coalesce(actor_name, 'отдел')
      when 'cancelled' then 'отменён'
      else 'новый'
    end;

    insert into public.notifications (
      user_id, type, title, message, related_machine_id,
      related_department_request_id
    )
    values (
      new.created_by,
      'department_request_status_' || new.target_department,
      'Статус запроса изменён',
      status_message,
      new.machine_id,
      new.id
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_department_request_change()
  from public, anon, authenticated;

create or replace function public.fn_return_long_stock_position_to_technologist_v1(
  p_request_item_table text,
  p_request_item_id uuid,
  p_reason text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_item public.long_stock_cutting_plan_items%rowtype;
  v_plan public.long_stock_cutting_plans%rowtype;
  v_version public.long_stock_cutting_plan_versions%rowtype;
  v_request_id uuid;
  v_machine_id uuid;
  v_factory_id uuid;
  v_plan_author uuid;
  v_material_name text;
  v_variant_label text;
  v_item_label text;
  v_department_request_id uuid;
  v_task_id uuid;
  v_business_bar_count integer;
  v_linked_reservation_count integer;
  v_reservation record;
begin
  if p_request_item_table not in ('request_circle', 'request_pipe', 'request_knives') then
    raise exception 'Позиция не относится к длинномеру';
  end if;
  if p_request_item_id is null then
    raise exception 'Позиция заявки не указана';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Укажите причину возврата';
  end if;
  if not exists (
    select 1 from public.users
    where id = p_actor and coalesce(is_active, true)
  ) then
    raise exception 'Необходим активный автор возврата';
  end if;

  select item.* into v_plan_item
  from public.long_stock_cutting_plan_items item
  where item.request_item_table = p_request_item_table
    and item.request_item_id = p_request_item_id
  order by item.linked_at desc, item.id desc
  limit 1
  for update;
  if not found then
    raise exception 'У позиции нет карты раскроя';
  end if;

  select request.id, request.machine_id, machine.factory_id
    into v_request_id, v_machine_id, v_factory_id
  from public.technologist_requests request
  join public.machines machine on machine.id = request.machine_id
  where request.id = v_plan_item.request_id;
  if v_machine_id is null or v_factory_id is null then
    raise exception 'Для позиции не найдены машина и завод';
  end if;

  select request.id, request.assigned_to
    into v_department_request_id, v_plan_author
  from public.department_requests request
  where request.long_stock_plan_id = v_plan_item.plan_id
    and request.request_kind = 'long_stock_recalculation'
    and request.status in ('new', 'in_progress')
  order by request.created_at desc
  limit 1;
  if v_department_request_id is not null then
    return jsonb_build_object(
      'department_request_id', v_department_request_id,
      'plan_id', v_plan_item.plan_id,
      'technologist_request_id', v_request_id,
      'machine_id', v_machine_id,
      'assigned_to', v_plan_author,
      'position_status', v_plan_item.cutting_status
    );
  end if;

  if v_plan_item.cutting_status <> 'plan_approved' then
    raise exception 'Вернуть можно только позицию с утверждённым планом закупки';
  end if;

  select * into v_plan
  from public.long_stock_cutting_plans
  where id = v_plan_item.plan_id
  for update;

  select * into v_version
  from public.long_stock_cutting_plan_versions
  where plan_id = v_plan.id and status = 'approved'
  for update;
  if not found then
    raise exception 'Утверждённая версия карты раскроя не найдена';
  end if;

  v_plan_author := v_version.created_by;
  if not exists (
    select 1 from public.users
    where id = v_plan_author and coalesce(is_active, true)
  ) then
    raise exception 'Автор утверждённой версии недоступен';
  end if;

  if exists (
    select 1
    from public.long_stock_cutting_candidate_bars bar
    join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
    where candidate.version_id = v_version.id
      and candidate.candidate_number = v_version.selected_candidate_number
      and bar.status <> 'planned'
  ) then
    raise exception 'Позицию уже начали резать; возврат из снабжения недоступен';
  end if;

  if exists (
    select 1
    from public.long_stock_cutting_business_scraps scrap_link
    join public.inventory scrap on scrap.id = scrap_link.inventory_id
    where scrap_link.version_id = v_version.id
      and (
        scrap.deleted_at is not null
        or scrap.business_scrap_state is distinct from 'future'
        or coalesce(scrap.reserved_quantity, 0) > 0
        or coalesce(scrap.reserved_secondary_quantity, 0) > 0
      )
  ) then
    raise exception 'Будущий остаток карты уже изменён; автоматический возврат невозможен';
  end if;

  insert into public.long_stock_cutting_bar_reservations(version_id, bar_id, reservation_id)
  select distinct on (bar.id)
    v_version.id,
    bar.id,
    reservation.id
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  join public.inventory_reservations reservation
    on reservation.request_item_table = v_plan_item.request_item_table
   and reservation.request_item_id = v_plan_item.request_item_id
   and reservation.source_inventory_id = bar.source_inventory_id
   and reservation.original_piece_length_mm = bar.stock_length_mm
   and reservation.consumed_at is null
  where candidate.version_id = v_version.id
    and candidate.candidate_number = v_version.selected_candidate_number
    and bar.source_type = 'business_remnant'
  order by bar.id, reservation.created_at desc, reservation.id desc
  on conflict do nothing;

  select count(*) into v_business_bar_count
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  where candidate.version_id = v_version.id
    and candidate.candidate_number = v_version.selected_candidate_number
    and bar.source_type = 'business_remnant';

  select count(*) into v_linked_reservation_count
  from public.long_stock_cutting_bar_reservations
  where version_id = v_version.id;

  if v_business_bar_count <> v_linked_reservation_count then
    raise exception 'Не найдены все резервы деловых остатков утверждённой карты';
  end if;

  select material.name,
         coalesce(
           nullif(variant.piece_description, ''),
           nullif(variant.knife_dimensions, ''),
           nullif(variant.material_grade, ''),
           nullif(variant.knife_material, ''),
           'точный вариант'
         )
    into v_material_name, v_variant_label
  from public.material_variants variant
  join public.materials material on material.id = variant.material_id
  where variant.id = v_plan.material_variant_id;

  v_item_label := coalesce(v_material_name, 'Длинномер') || ' · ' || coalesce(v_variant_label, 'точный вариант');
  v_department_request_id := gen_random_uuid();

  insert into public.department_requests (
    id, request_kind, target_department, title, description,
    status, created_by, assigned_to, factory_id, machine_id,
    request_item_table, request_item_id, technologist_request_id,
    long_stock_plan_id, long_stock_returned_version_id, request_item_label
  ) values (
    v_department_request_id,
    'long_stock_recalculation',
    'technologist',
    'Пересчитать позицию карты №' || v_plan.plan_number,
    btrim(p_reason),
    'in_progress',
    p_actor,
    v_plan_author,
    v_factory_id,
    v_machine_id,
    v_plan_item.request_item_table,
    v_plan_item.request_item_id,
    v_request_id,
    v_plan.id,
    v_version.id,
    v_item_label
  );

  insert into public.tasks (
    department_request_id, machine_id, assigned_to, task_type,
    title, description, status, start_date
  ) values (
    v_department_request_id,
    v_machine_id,
    v_plan_author,
    'department_request',
    'Пересчитать позицию карты №' || v_plan.plan_number,
    btrim(p_reason),
    'in_progress',
    current_date
  ) returning id into v_task_id;

  update public.inventory inventory_row
  set total_quantity = 0,
      reserved_quantity = 0,
      total_secondary_quantity = 0,
      reserved_secondary_quantity = 0,
      deleted_at = now(),
      deleted_by = p_actor,
      delete_comment = 'Возврат позиции снабжением на пересчёт',
      last_updated_by = p_actor,
      updated_at = now()
  from public.long_stock_cutting_business_scraps scrap_link
  where scrap_link.version_id = v_version.id
    and scrap_link.inventory_id = inventory_row.id;

  for v_reservation in
    select reservation_id
    from public.long_stock_cutting_bar_reservations
    where version_id = v_version.id
    order by bar_id
  loop
    perform public.fn_unreserve_inventory_reservation(
      v_reservation.reservation_id,
      p_actor,
      'Возврат позиции снабжением на пересчёт'
    );
  end loop;

  perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
  update public.long_stock_cutting_plan_versions
  set status = 'invalid',
      invalidation_reason = 'Возврат снабжением: ' || btrim(p_reason),
      invalidation_receipt_schedule_id = null,
      invalidation_department_request_id = v_department_request_id,
      invalidated_by = p_actor,
      invalidated_at = now()
  where id = v_version.id;
  perform set_config('app.long_stock_cutting_version_lifecycle', '', true);

  perform set_config('app.long_stock_cutting_item_status', '1', true);
  update public.long_stock_cutting_plan_items
  set cutting_status = 'requires_recalculation'
  where id = v_plan_item.id;
  perform set_config('app.long_stock_cutting_item_status', '', true);

  return jsonb_build_object(
    'department_request_id', v_department_request_id,
    'task_id', v_task_id,
    'plan_id', v_plan.id,
    'technologist_request_id', v_request_id,
    'machine_id', v_machine_id,
    'assigned_to', v_plan_author,
    'invalidated_version_id', v_version.id,
    'position_status', 'requires_recalculation'
  );
end;
$$;

revoke all on function public.fn_return_long_stock_position_to_technologist_v1(text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_return_long_stock_position_to_technologist_v1(text, uuid, text, uuid)
  to service_role;

alter function public.fn_approve_long_stock_cutting_plan_version_core_v1(uuid, uuid)
  rename to fn_approve_long_stock_cutting_plan_version_before_supply_return;

revoke all on function public.fn_approve_long_stock_cutting_plan_version_before_supply_return(uuid, uuid)
  from public, anon, authenticated, service_role;

do $migration$
declare
  v_definition text;
  v_anchor text := E'    if exists (\n      select 1\n      from public.long_stock_cutting_plan_versions version\n      join public.long_stock_cutting_candidates candidate';
  v_replacement text := E'    if (\n      select invalidation_receipt_schedule_id\n      from public.long_stock_cutting_plan_versions\n      where id = v_invalid_version_id\n    ) is not null and exists (\n      select 1\n      from public.long_stock_cutting_plan_versions version\n      join public.long_stock_cutting_candidates candidate';
begin
  v_definition := pg_get_functiondef(
    'public.fn_approve_long_stock_cutting_plan_version_before_supply_return(uuid,uuid)'::regprocedure
  );

  if position(v_anchor in v_definition) = 0 then
    raise exception 'Не удалось ограничить проверку фактической приёмки причиной пересчёта';
  end if;

  execute replace(v_definition, v_anchor, v_replacement);
end;
$migration$;

create or replace function public.fn_approve_long_stock_cutting_plan_version_core_v1(
  p_version_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_version public.long_stock_cutting_plan_versions%rowtype;
  v_plan_item public.long_stock_cutting_plan_items%rowtype;
  v_request_id uuid;
begin
  v_result := public.fn_approve_long_stock_cutting_plan_version_before_supply_return(
    p_version_id,
    p_actor
  );

  select * into v_version
  from public.long_stock_cutting_plan_versions
  where id = p_version_id;

  select * into v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_version.plan_id
  order by linked_at, id
  limit 1;

  insert into public.long_stock_cutting_bar_reservations(version_id, bar_id, reservation_id)
  select distinct on (bar.id)
    v_version.id,
    bar.id,
    reservation.id
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  join public.inventory_reservations reservation
    on reservation.request_item_table = v_plan_item.request_item_table
   and reservation.request_item_id = v_plan_item.request_item_id
   and reservation.source_inventory_id = bar.source_inventory_id
   and reservation.original_piece_length_mm = bar.stock_length_mm
   and reservation.consumed_at is null
  where candidate.version_id = v_version.id
    and candidate.candidate_number = v_version.selected_candidate_number
    and bar.source_type = 'business_remnant'
  order by bar.id, reservation.created_at desc, reservation.id desc
  on conflict do nothing;

  select request.id into v_request_id
  from public.department_requests request
  where request.long_stock_plan_id = v_version.plan_id
    and request.request_kind = 'long_stock_recalculation'
    and request.status in ('new', 'in_progress')
  order by request.created_at desc
  limit 1
  for update;

  if v_request_id is not null then
    perform set_config('app.long_stock_recalculation_request_lifecycle', '1', true);
    update public.department_requests
    set status = 'done',
        response = 'Новая версия карты раскроя утверждена',
        completed_by = p_actor,
        completed_at = now()
    where id = v_request_id;
    perform set_config('app.long_stock_recalculation_request_lifecycle', '', true);

    update public.tasks
    set status = 'completed', completed_at = now(), updated_at = now()
    where department_request_id = v_request_id
      and status <> 'completed';
  end if;

  return v_result || jsonb_build_object(
    'closed_department_request_id', v_request_id
  );
end;
$$;

revoke all on function public.fn_approve_long_stock_cutting_plan_version_core_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

-- SQL integration fixtures created before immutable plan PDFs still exercise
-- the v1 signature directly. Keep it closed to every API role so production
-- approval cannot bypass fn_approve_long_stock_cutting_plan_version_v2.
create or replace function public.fn_approve_long_stock_cutting_plan_version_v1(
  p_version_id uuid,
  p_actor uuid
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.fn_approve_long_stock_cutting_plan_version_core_v1(
    p_version_id,
    p_actor
  );
$$;

revoke all on function public.fn_approve_long_stock_cutting_plan_version_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.fn_assert_long_stock_cutting_ready(p_machine_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.long_stock_cutting_plan_items item
    join public.technologist_requests request on request.id = item.request_id
    where request.machine_id = p_machine_id
      and item.cutting_status = 'requires_recalculation'
  ) then
    raise exception 'Резка заблокирована: позиция длинномера требует пересчёта';
  end if;
end;
$$;

revoke all on function public.fn_assert_long_stock_cutting_ready(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_assert_long_stock_cutting_ready(uuid)
  to service_role;

alter function public.fn_apply_production_fact_cutting(uuid, uuid)
  rename to fn_apply_production_fact_cutting_before_long_stock_return;

revoke all on function public.fn_apply_production_fact_cutting_before_long_stock_return(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.fn_apply_production_fact_cutting(
  p_fact_id uuid,
  p_performed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_machine_id uuid;
  v_effective_stage public.stage_type;
begin
  select fact.machine_id,
         coalesce(section.production_stage_type, parent.production_stage_type)
  into v_machine_id, v_effective_stage
  from public.production_machine_facts fact
  join public.production_fact_sections section on section.id = fact.section_id
  left join public.production_fact_sections parent on parent.id = section.parent_id
  where fact.id = p_fact_id;

  if v_effective_stage = 'cutting'::public.stage_type then
    perform public.fn_assert_long_stock_cutting_ready(v_machine_id);
  end if;

  return public.fn_apply_production_fact_cutting_before_long_stock_return(
    p_fact_id,
    p_performed_by
  );
end;
$$;

revoke all on function public.fn_apply_production_fact_cutting(uuid, uuid)
  from public, anon;
grant execute on function public.fn_apply_production_fact_cutting(uuid, uuid)
  to authenticated, service_role;

comment on column public.department_requests.request_item_id is
  'Exact technologist request item returned by supply; immutable with the department request.';
comment on column public.long_stock_cutting_plan_versions.invalidation_department_request_id is
  'Supply return request that invalidated this immutable plan version.';
comment on function public.fn_return_long_stock_position_to_technologist_v1(text, uuid, text, uuid) is
  'Atomically returns one approved long-stock request item to its plan author and blocks cutting.';

notify pgrst, 'reload schema';
