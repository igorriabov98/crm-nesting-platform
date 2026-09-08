-- Keep long-stock needs hidden until their cutting map is approved, restore
-- plan preparation for corrected legacy rows, and provide a terminal audited
-- cancellation for positions returned by supply.

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array['request_circle', 'request_pipe', 'request_knives'] loop
    execute format(
      'alter table public.%I '
      || 'add column if not exists is_cutting_plan_draft boolean not null default false, '
      || 'add column if not exists cutting_plan_draft_created_by uuid references public.users(id) on delete restrict, '
      || 'add column if not exists cutting_plan_draft_token uuid',
      v_table
    );
    execute format('alter table public.%I drop constraint if exists %I', v_table, v_table || '_cutting_plan_draft_check');
    execute format(
      'alter table public.%1$I add constraint %2$I check ('
      || '(is_cutting_plan_draft and cutting_plan_draft_created_by is not null and cutting_plan_draft_token is not null) '
      || 'or (not is_cutting_plan_draft and cutting_plan_draft_created_by is null and cutting_plan_draft_token is null))',
      v_table,
      v_table || '_cutting_plan_draft_check'
    );
    execute format(
      'create unique index if not exists %I on public.%I(cutting_plan_draft_token) where cutting_plan_draft_token is not null',
      v_table || '_cutting_plan_draft_token_idx',
      v_table
    );
  end loop;
end;
$migration$;

alter table public.supply_position_revisions
  add column if not exists cancelled_by uuid references public.users(id) on delete restrict,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

alter table public.supply_position_revisions
  drop constraint if exists supply_position_revisions_status_check;
alter table public.supply_position_revisions
  add constraint supply_position_revisions_status_check
  check (status in ('requested', 'editing', 'stock_check', 'submitted', 'cancelled'));
alter table public.supply_position_revisions
  drop constraint if exists supply_position_revisions_replacement_check;
alter table public.supply_position_revisions
  add constraint supply_position_revisions_replacement_check check (
    (status = 'requested' and replacement_request_id is null and replacement_request_item_id is null and replacement_request_item_table is null)
    or (status in ('editing', 'stock_check', 'submitted') and replacement_request_id is not null and replacement_request_item_id is not null and replacement_request_item_table = source_request_item_table)
    or status = 'cancelled'
  );
alter table public.supply_position_revisions
  drop constraint if exists supply_position_revisions_submission_check;
alter table public.supply_position_revisions
  add constraint supply_position_revisions_submission_check check (
    ((status = 'submitted') = (submitted_by is not null and submitted_at is not null))
    and ((status = 'cancelled') = (
      cancelled_by is not null and cancelled_at is not null
      and char_length(btrim(coalesce(cancellation_reason, ''))) between 3 and 2000
    ))
  );

alter table public.long_stock_cutting_plan_items
  drop constraint if exists long_stock_cutting_plan_items_cutting_status_check;
alter table public.long_stock_cutting_plan_items
  add constraint long_stock_cutting_plan_items_cutting_status_check
  check (cutting_status in ('planning', 'plan_approved', 'accepted', 'requires_recalculation', 'cancelled'));

alter table public.long_stock_recalculation_replacements
  add column if not exists cancelled_by uuid references public.users(id) on delete restrict,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;
alter table public.long_stock_recalculation_replacements
  drop constraint if exists long_stock_recalculation_replacements_status_check;
alter table public.long_stock_recalculation_replacements
  add constraint long_stock_recalculation_replacements_status_check
  check (status in ('replacement_staging', 'superseded', 'cancelled'));
alter table public.long_stock_recalculation_replacements
  drop constraint if exists long_stock_recalculation_replacements_check;
alter table public.long_stock_recalculation_replacements
  add constraint long_stock_recalculation_replacements_check check (
    (status = 'replacement_staging' and replacement_version_id is null and approved_by is null and approved_at is null
      and cancelled_by is null and cancelled_at is null and cancellation_reason is null)
    or (status = 'superseded' and replacement_version_id is not null and approved_by is not null and approved_at is not null
      and cancelled_by is null and cancelled_at is null and cancellation_reason is null)
    or (status = 'cancelled' and approved_by is null and approved_at is null
      and cancelled_by is not null and cancelled_at is not null
      and char_length(btrim(coalesce(cancellation_reason, ''))) between 3 and 2000)
  );

create or replace function public.fn_can_process_returned_supply_position(
  p_actor uuid,
  p_assigned_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users app_user
    where app_user.id = p_actor
      and coalesce(app_user.is_active, true)
      and (
        app_user.id = p_assigned_to
        or app_user.role::text in ('planning_director', 'financial_director', 'commercial_director')
        or exists (
          select 1
          from public.department_members member
          join public.positions position on position.id = member.position_id
          where member.user_id = app_user.id and position.name = 'Администратор CRM'
        )
      )
  );
$$;

revoke all on function public.fn_can_process_returned_supply_position(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.fn_prepare_long_stock_request_item_draft_v1(
  p_request_id uuid,
  p_request_item_table text,
  p_request_item_id uuid,
  p_item_data jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.technologist_requests%rowtype;
  v_item_id uuid := coalesce(p_request_item_id, gen_random_uuid());
  v_token uuid;
  v_row jsonb;
begin
  if p_request_item_table not in ('request_circle', 'request_pipe', 'request_knives') then
    raise exception using errcode = '22023', message = '[INVALID_POSITION_REF] Позиция не относится к длинномеру';
  end if;
  select * into v_request from public.technologist_requests
  where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = '[REQUEST_NOT_FOUND] Заявка не найдена';
  end if;
  if v_request.status <> 'draft' then
    raise exception using errcode = '55000', message = '[CUTTING_DRAFT_STALE] Заявка уже отправлена. Обновите страницу';
  end if;
  if p_actor is distinct from v_request.created_by
    and not public.fn_can_process_returned_supply_position(p_actor, v_request.created_by) then
    raise exception using errcode = '42501', message = '[REVISION_FORBIDDEN] Недостаточно прав для подготовки карты';
  end if;

  if p_request_item_id is not null then
    execute format(
      'select cutting_plan_draft_token from public.%I where id = $1 and request_id = $2 and is_cutting_plan_draft for update',
      p_request_item_table
    ) into v_token using p_request_item_id, p_request_id;
    if v_token is null then
      raise exception using errcode = '55000', message = '[CUTTING_DRAFT_STALE] Черновик позиции уже закрыт. Обновите страницу';
    end if;
  else
    v_token := gen_random_uuid();
  end if;

  if p_request_item_table = 'request_circle' then
    insert into public.request_circle(
      id, request_id, diameter_mm, steel_grade, steel_type_id, is_calibrated,
      remainder_mm, material_id, material_variant_id, is_custom_material_variant,
      is_cutting_plan_draft, cutting_plan_draft_created_by, cutting_plan_draft_token
    ) values (
      v_item_id, p_request_id, nullif(p_item_data->>'diameter_mm', '')::numeric,
      nullif(p_item_data->>'steel_grade', ''), nullif(p_item_data->>'steel_type_id', '')::uuid,
      coalesce((p_item_data->>'is_calibrated')::boolean, false), (p_item_data->>'remainder_mm')::numeric,
      (p_item_data->>'material_id')::uuid, (p_item_data->>'material_variant_id')::uuid, false,
      true, p_actor, v_token
    )
    on conflict (id) do update set
      remainder_mm = excluded.remainder_mm
    returning to_jsonb(request_circle.*) into v_row;
  elsif p_request_item_table = 'request_pipe' then
    insert into public.request_pipe(
      id, request_id, pipe_type, steel_type_id, size, wall_thickness_mm, diameter_mm,
      remainder_length_mm, remainder_qty, remainder_kg, material_id, material_variant_id,
      is_custom_material_variant, is_cutting_plan_draft, cutting_plan_draft_created_by, cutting_plan_draft_token
    ) values (
      v_item_id, p_request_id, (p_item_data->>'pipe_type')::public.pipe_subtype,
      nullif(p_item_data->>'steel_type_id', '')::uuid, nullif(p_item_data->>'size', ''),
      nullif(p_item_data->>'wall_thickness_mm', '')::numeric, nullif(p_item_data->>'diameter_mm', '')::numeric,
      (p_item_data->>'remainder_length_mm')::numeric, coalesce((p_item_data->>'remainder_qty')::numeric, 0),
      coalesce((p_item_data->>'remainder_kg')::numeric, 0), (p_item_data->>'material_id')::uuid,
      (p_item_data->>'material_variant_id')::uuid, false, true, p_actor, v_token
    )
    on conflict (id) do update set
      remainder_length_mm = excluded.remainder_length_mm,
      remainder_qty = excluded.remainder_qty
    returning to_jsonb(request_pipe.*) into v_row;
  else
    insert into public.request_knives(
      id, request_id, knife_type, steel_grade, steel_type_id, length_mm, width_mm, height_mm,
      knife_bevel_count, remainder_meters, remainder_qty, material_id, material_variant_id,
      is_custom_material_variant, is_cutting_plan_draft, cutting_plan_draft_created_by, cutting_plan_draft_token
    ) values (
      v_item_id, p_request_id, coalesce(nullif(p_item_data->>'knife_type', ''), 'Нож'),
      nullif(p_item_data->>'steel_grade', ''), nullif(p_item_data->>'steel_type_id', '')::uuid, null,
      nullif(p_item_data->>'width_mm', '')::numeric, nullif(p_item_data->>'height_mm', '')::numeric,
      nullif(p_item_data->>'knife_bevel_count', '')::integer, (p_item_data->>'remainder_meters')::numeric,
      coalesce((p_item_data->>'remainder_qty')::numeric, 0), (p_item_data->>'material_id')::uuid,
      (p_item_data->>'material_variant_id')::uuid, false, true, p_actor, v_token
    )
    on conflict (id) do update set
      remainder_meters = excluded.remainder_meters,
      remainder_qty = excluded.remainder_qty
    returning to_jsonb(request_knives.*) into v_row;
  end if;

  return jsonb_build_object(
    'table', p_request_item_table,
    'id', v_item_id,
    'row', v_row,
    'draft_token', v_token
  );
end;
$$;

revoke all on function public.fn_prepare_long_stock_request_item_draft_v1(uuid, text, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_prepare_long_stock_request_item_draft_v1(uuid, text, uuid, jsonb, uuid)
  to service_role;

create or replace function public.fn_discard_long_stock_request_item_drafts_v1(
  p_request_id uuid,
  p_actor uuid,
  p_request_item_table text default null,
  p_request_item_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.technologist_requests%rowtype;
  v_item record;
  v_plan_item record;
  v_reservation record;
  v_count integer := 0;
begin
  select * into v_request from public.technologist_requests where id = p_request_id for update;
  if not found then return 0; end if;
  if p_actor is distinct from v_request.created_by
    and not public.fn_can_process_returned_supply_position(p_actor, v_request.created_by) then
    raise exception using errcode = '42501', message = '[REVISION_FORBIDDEN] Недостаточно прав для закрытия черновика';
  end if;

  for v_item in
    select 'request_circle'::text as item_table, id from public.request_circle
      where request_id = p_request_id and is_cutting_plan_draft
        and (p_request_item_table is null or p_request_item_table = 'request_circle')
        and (p_request_item_id is null or id = p_request_item_id)
    union all
    select 'request_pipe', id from public.request_pipe
      where request_id = p_request_id and is_cutting_plan_draft
        and (p_request_item_table is null or p_request_item_table = 'request_pipe')
        and (p_request_item_id is null or id = p_request_item_id)
    union all
    select 'request_knives', id from public.request_knives
      where request_id = p_request_id and is_cutting_plan_draft
        and (p_request_item_table is null or p_request_item_table = 'request_knives')
        and (p_request_item_id is null or id = p_request_item_id)
  loop
    for v_reservation in
      select id from public.inventory_reservations
      where request_item_table = v_item.item_table and request_item_id = v_item.id
        and consumed_at is null
    loop
      perform public.fn_unreserve_inventory_reservation(v_reservation.id, p_actor, 'Закрытие неутверждённого черновика карты');
    end loop;

    for v_plan_item in
      select id, plan_id from public.long_stock_cutting_plan_items
      where request_item_table = v_item.item_table and request_item_id = v_item.id
    loop
      delete from public.long_stock_cutting_bar_cuts where candidate_id in (
        select candidate.id from public.long_stock_cutting_candidates candidate
        join public.long_stock_cutting_plan_versions version on version.id = candidate.version_id
        where version.plan_id = v_plan_item.plan_id and version.status = 'draft'
      );
      delete from public.long_stock_cutting_candidate_bars where version_id in (
        select id from public.long_stock_cutting_plan_versions where plan_id = v_plan_item.plan_id and status = 'draft'
      );
      delete from public.long_stock_cutting_candidates where version_id in (
        select id from public.long_stock_cutting_plan_versions where plan_id = v_plan_item.plan_id and status = 'draft'
      );
      delete from public.long_stock_cutting_segments where version_id in (
        select id from public.long_stock_cutting_plan_versions where plan_id = v_plan_item.plan_id and status = 'draft'
      );
      perform set_config('app.long_stock_cutting_draft_cleanup', '1', true);
      delete from public.long_stock_cutting_plan_versions where plan_id = v_plan_item.plan_id and status = 'draft';
      perform set_config('app.long_stock_cutting_draft_cleanup', '', true);
      perform set_config('app.long_stock_cutting_replacement_lifecycle', '1', true);
      update public.long_stock_cutting_plan_items
      set cutting_status = 'cancelled', link_state = 'superseded'
      where id = v_plan_item.id;
      perform set_config('app.long_stock_cutting_replacement_lifecycle', '', true);
    end loop;

    perform set_config('app.supply_position_revision_lifecycle', '1', true);
    execute format('delete from public.%I where id = $1 and is_cutting_plan_draft', v_item.item_table)
      using v_item.id;
    perform set_config('app.supply_position_revision_lifecycle', '', true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.fn_discard_long_stock_request_item_drafts_v1(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_discard_long_stock_request_item_drafts_v1(uuid, uuid, text, uuid)
  to service_role;

-- The wrapper serialises approval against request submission. The old function
-- remains the complete source of truth for reservations and cutting artefacts.
alter function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  rename to fn_approve_long_stock_before_request_draft_activation_v1;
revoke all on function public.fn_approve_long_stock_before_request_draft_activation_v1(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.fn_approve_long_stock_cutting_plan_version_v2(
  p_version_id uuid,
  p_actor uuid,
  p_pdf_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item_table text;
  v_item_id uuid;
  v_request_id uuid;
  v_is_draft boolean := false;
  v_request_status public.request_status;
  v_result jsonb;
begin
  select item.request_item_table, item.request_item_id, item.request_id
    into v_item_table, v_item_id, v_request_id
  from public.long_stock_cutting_plan_versions version
  join public.long_stock_cutting_plan_items item on item.plan_id = version.plan_id
  where version.id = p_version_id
  order by item.linked_at desc
  limit 1;
  if v_request_id is null then
    raise exception using errcode = 'P0002', message = '[CUTTING_VERSION_NOT_FOUND] Версия карты раскроя не найдена';
  end if;

  select status into v_request_status from public.technologist_requests
  where id = v_request_id for update;
  execute format('select is_cutting_plan_draft from public.%I where id = $1 for update', v_item_table)
    into v_is_draft using v_item_id;
  if v_is_draft and v_request_status <> 'draft' then
    raise exception using errcode = '55000', message = '[CUTTING_DRAFT_STALE] Заявка уже отправлена. Черновик карты не может быть утверждён';
  end if;

  v_result := public.fn_approve_long_stock_before_request_draft_activation_v1(
    p_version_id, p_actor, p_pdf_metadata
  );
  if v_is_draft and v_result->>'status' = 'approved' then
    execute format(
      'update public.%I set is_cutting_plan_draft = false, cutting_plan_draft_created_by = null, cutting_plan_draft_token = null where id = $1 and is_cutting_plan_draft',
      v_item_table
    ) using v_item_id;
    if not found then
      raise exception using errcode = '55000', message = '[CUTTING_DRAFT_STALE] Черновик позиции уже закрыт. Обновите страницу';
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  to service_role;

create or replace function public.fn_cleanup_cutting_drafts_and_guard_revision_stock_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.created_by);
  v_revision record;
begin
  if new.status in ('pending_stock_check', 'stock_checked')
    and new.status is distinct from old.status then
    select * into v_revision from public.supply_position_revisions
    where replacement_request_id = new.id and status in ('editing', 'stock_check')
    limit 1;
    if found and v_revision.replacement_request_item_table in ('request_circle', 'request_pipe', 'request_knives')
      and (
        v_revision.replacement_request_item_table <> 'request_pipe'
        or exists (
          select 1 from public.request_pipe pipe
          where pipe.id = v_revision.replacement_request_item_id and pipe.pipe_type <> 'wire'
        )
      )
      and not exists (
        select 1 from public.long_stock_cutting_plan_items item
        where item.request_item_table = v_revision.replacement_request_item_table
          and item.request_item_id = v_revision.replacement_request_item_id
          and item.cutting_status in ('plan_approved', 'accepted')
          and item.link_state = 'active'
      ) then
      raise exception using errcode = '55000', message = '[CUTTING_PLAN_REQUIRED] Сначала подготовьте и утвердите карту раскроя';
    end if;
    perform public.fn_discard_long_stock_request_item_drafts_v1(new.id, v_actor, null, null);
  end if;
  return new;
end;
$$;

drop trigger if exists cleanup_cutting_drafts_and_guard_revision_stock_check on public.technologist_requests;
create trigger cleanup_cutting_drafts_and_guard_revision_stock_check
before update of status on public.technologist_requests
for each row execute function public.fn_cleanup_cutting_drafts_and_guard_revision_stock_check();

revoke all on function public.fn_cleanup_cutting_drafts_and_guard_revision_stock_check()
  from public, anon, authenticated, service_role;

create or replace function public.fn_guard_long_stock_revision_submission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'submitted' and old.status <> 'submitted'
    and new.replacement_request_item_table in ('request_circle', 'request_pipe', 'request_knives')
    and (
      new.replacement_request_item_table <> 'request_pipe'
      or exists (
        select 1 from public.request_pipe pipe
        where pipe.id = new.replacement_request_item_id and pipe.pipe_type <> 'wire'
      )
    )
    and not exists (
      select 1 from public.long_stock_cutting_plan_items item
      where item.request_item_table = new.replacement_request_item_table
        and item.request_item_id = new.replacement_request_item_id
        and item.cutting_status in ('plan_approved', 'accepted')
        and item.link_state = 'active'
    ) then
    raise exception using errcode = '55000', message = '[CUTTING_PLAN_REQUIRED] Сначала подготовьте и утвердите карту раскроя';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_long_stock_revision_submission on public.supply_position_revisions;
create trigger guard_long_stock_revision_submission
before update of status on public.supply_position_revisions
for each row execute function public.fn_guard_long_stock_revision_submission();

revoke all on function public.fn_guard_long_stock_revision_submission()
  from public, anon, authenticated, service_role;

create or replace function public.fn_cancel_returned_supply_position_v1(
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
  v_reason text := btrim(coalesce(p_reason, ''));
  v_revision public.supply_position_revisions%rowtype;
  v_plan_item public.long_stock_cutting_plan_items%rowtype;
  v_department public.department_requests%rowtype;
  v_replacement public.long_stock_recalculation_replacements%rowtype;
  v_request_id uuid;
  v_reservation record;
  v_cleanup_plan_item record;
  v_replacement_table text;
  v_replacement_item_id uuid;
  v_row jsonb;
begin
  if char_length(v_reason) not between 3 and 2000 then
    raise exception using errcode = '22023', message = '[REASON_REQUIRED] Укажите причину отмены от 3 до 2000 символов';
  end if;
  if public.supply_position_category(p_request_item_table) is null then
    raise exception using errcode = '22023', message = '[INVALID_POSITION_REF] Недопустимая категория позиции';
  end if;

  execute format('select to_jsonb(item) from public.%I item where id = $1 for update', p_request_item_table)
    into v_row using p_request_item_id;
  if v_row is null then
    raise exception using errcode = 'P0002', message = '[POSITION_NOT_FOUND] Позиция не найдена';
  end if;
  v_request_id := (v_row->>'request_id')::uuid;
  perform 1 from public.technologist_requests where id = v_request_id for update;

  select * into v_revision from public.supply_position_revisions
  where source_request_item_table = p_request_item_table
    and source_request_item_id = p_request_item_id
    and status in ('requested', 'editing', 'stock_check', 'submitted', 'cancelled')
  order by created_at desc limit 1 for update;

  if found then
    if v_revision.status = 'cancelled' then
      return jsonb_build_object('status', 'cancelled', 'idempotent', true, 'mode', 'standard');
    end if;
    if v_revision.status = 'submitted' then
      raise exception using errcode = '55000', message = '[REVISION_ALREADY_SUBMITTED] Исправленная позиция уже отправлена в снабжение';
    end if;
    v_replacement_table := v_revision.replacement_request_item_table;
    v_replacement_item_id := v_revision.replacement_request_item_id;
    select * into v_department from public.department_requests
    where id = v_revision.department_request_id for update;
    if not public.fn_can_process_returned_supply_position(p_actor, v_revision.assigned_to) then
      raise exception using errcode = '42501', message = '[REVISION_FORBIDDEN] Отменить позицию может назначенный технолог или руководитель';
    end if;
  elsif p_request_item_table in ('request_circle', 'request_pipe', 'request_knives') then
    select * into v_plan_item from public.long_stock_cutting_plan_items
    where request_item_table = p_request_item_table
      and request_item_id = p_request_item_id
      and cutting_status in ('requires_recalculation', 'cancelled')
    order by linked_at desc limit 1 for update;
    if not found then
      raise exception using errcode = 'P0002', message = '[RETURN_NOT_FOUND] Активный возврат позиции не найден';
    end if;
    if v_plan_item.cutting_status = 'cancelled' then
      return jsonb_build_object('status', 'cancelled', 'idempotent', true, 'mode', 'long_stock_recalculation');
    end if;
    select department.* into v_department
    from public.long_stock_cutting_plan_versions version
    join public.department_requests department
      on department.id = version.invalidation_department_request_id
    where version.plan_id = v_plan_item.plan_id
      and version.status = 'invalid'
      and version.invalidation_department_request_id is not null
    order by version.invalidated_at desc nulls last
    limit 1
    for update of department;
    if not found or not public.fn_can_process_returned_supply_position(p_actor, v_department.assigned_to) then
      raise exception using errcode = '42501', message = '[REVISION_FORBIDDEN] Отменить позицию может назначенный технолог или руководитель';
    end if;
    select * into v_replacement from public.long_stock_recalculation_replacements
    where plan_item_id = v_plan_item.id order by created_at desc limit 1 for update;
    if found and v_replacement.status = 'superseded' then
      raise exception using errcode = '55000', message = '[REVISION_ALREADY_SUBMITTED] Исправленная позиция уже отправлена в снабжение';
    end if;
    v_replacement_table := v_replacement.replacement_request_item_table;
    v_replacement_item_id := v_replacement.replacement_request_item_id;
  else
    raise exception using errcode = 'P0002', message = '[RETURN_NOT_FOUND] Активный возврат позиции не найден';
  end if;

  if exists (
    select 1 from public.supply_order_delivery_schedules schedule
    where schedule.request_item_table = p_request_item_table
      and schedule.request_item_id = p_request_item_id
      and (schedule.status = 'delivered' or schedule.delivered_at is not null or coalesce(schedule.received_quantity, 0) > 0)
  ) or exists (
    select 1 from public.supply_order_delivery_schedules schedule
    where schedule.request_item_table = v_replacement_table
      and schedule.request_item_id = v_replacement_item_id
      and (schedule.status = 'delivered' or schedule.delivered_at is not null or coalesce(schedule.received_quantity, 0) > 0)
  ) or exists (
    select 1 from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_candidate_bars bar on bar.version_id in (
      select version.id from public.long_stock_cutting_plan_versions version where version.plan_id = item.plan_id
    )
    where (
      (item.request_item_table = p_request_item_table and item.request_item_id = p_request_item_id)
      or (item.request_item_table = v_replacement_table and item.request_item_id = v_replacement_item_id)
    ) and bar.status = 'cut'
  ) then
    raise exception using errcode = '55000', message = '[IRREVERSIBLE_POSITION_FACT] Позицию нельзя отменить после приёмки или резки';
  end if;

  perform set_config('app.supply_position_revision_lifecycle', '1', true);
  for v_reservation in
    select id from public.inventory_reservations
    where (
      (request_item_table = p_request_item_table and request_item_id = p_request_item_id)
      or (request_item_table = v_replacement_table and request_item_id = v_replacement_item_id)
    )
      and consumed_at is null
  loop
    perform public.fn_unreserve_inventory_reservation(v_reservation.id, p_actor, 'Окончательная отмена возвращённой позиции');
  end loop;
  update public.supply_order_delivery_schedules
  set status = 'cancelled', change_reason = v_reason, updated_by = p_actor, updated_at = now()
  where (
    (request_item_table = p_request_item_table and request_item_id = p_request_item_id)
    or (request_item_table = v_replacement_table and request_item_id = v_replacement_item_id)
  ) and status = 'planned';

  for v_cleanup_plan_item in
    select id, plan_id
    from public.long_stock_cutting_plan_items
    where (request_item_table = p_request_item_table and request_item_id = p_request_item_id)
      or (request_item_table = v_replacement_table and request_item_id = v_replacement_item_id)
    for update
  loop
    update public.inventory inventory_row
    set total_quantity = 0,
        reserved_quantity = 0,
        total_secondary_quantity = 0,
        reserved_secondary_quantity = 0,
        deleted_at = coalesce(deleted_at, now()),
        deleted_by = coalesce(deleted_by, p_actor),
        delete_comment = coalesce(delete_comment, 'Окончательная отмена возвращённой позиции'),
        last_updated_by = p_actor,
        updated_at = now()
    from public.long_stock_cutting_business_scraps scrap
    join public.long_stock_cutting_plan_versions version on version.id = scrap.version_id
    where version.plan_id = v_cleanup_plan_item.plan_id
      and scrap.inventory_id = inventory_row.id
      and inventory_row.deleted_at is null;

    delete from public.long_stock_cutting_bar_cuts where candidate_id in (
      select candidate.id from public.long_stock_cutting_candidates candidate
      join public.long_stock_cutting_plan_versions version on version.id = candidate.version_id
      where version.plan_id = v_cleanup_plan_item.plan_id and version.status = 'draft'
    );
    delete from public.long_stock_cutting_candidate_bars where version_id in (
      select id from public.long_stock_cutting_plan_versions
      where plan_id = v_cleanup_plan_item.plan_id and status = 'draft'
    );
    delete from public.long_stock_cutting_candidates where version_id in (
      select id from public.long_stock_cutting_plan_versions
      where plan_id = v_cleanup_plan_item.plan_id and status = 'draft'
    );
    delete from public.long_stock_cutting_segments where version_id in (
      select id from public.long_stock_cutting_plan_versions
      where plan_id = v_cleanup_plan_item.plan_id and status = 'draft'
    );
    perform set_config('app.long_stock_cutting_draft_cleanup', '1', true);
    delete from public.long_stock_cutting_plan_versions
    where plan_id = v_cleanup_plan_item.plan_id and status = 'draft';
    perform set_config('app.long_stock_cutting_draft_cleanup', '', true);

    perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
    update public.long_stock_cutting_plan_versions
    set status = 'invalid',
        invalidation_reason = 'Окончательная отмена: ' || v_reason,
        invalidation_receipt_schedule_id = null,
        invalidation_department_request_id = v_department.id,
        invalidated_by = p_actor,
        invalidated_at = now()
    where plan_id = v_cleanup_plan_item.plan_id and status = 'approved';
    perform set_config('app.long_stock_cutting_version_lifecycle', '', true);

    perform set_config('app.long_stock_cutting_replacement_lifecycle', '1', true);
    update public.long_stock_cutting_plan_items
    set cutting_status = 'cancelled', link_state = 'superseded'
    where id = v_cleanup_plan_item.id;
    perform set_config('app.long_stock_cutting_replacement_lifecycle', '', true);
  end loop;

  perform public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);
  if v_replacement_table is not null and v_replacement_item_id is not null then
    perform public.fn_set_request_reserved_quantity(v_replacement_table, v_replacement_item_id);
  end if;
  execute format(
    'update public.%I set order_status = ''cancelled'', cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3 where id = $1',
    p_request_item_table
  ) using p_request_item_id, p_actor, v_reason;

  if v_revision.id is not null then
    if v_revision.replacement_request_id is not null then
      execute format(
        'update public.%I set order_status = ''cancelled'', cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3 where id = $1 and order_status <> ''cancelled''',
        v_revision.replacement_request_item_table
      ) using v_revision.replacement_request_item_id, p_actor, v_reason;
      update public.technologist_requests set status = 'cancelled', updated_at = now()
      where id = v_revision.replacement_request_id and status in ('draft', 'pending_stock_check', 'stock_checked');
    end if;
    update public.supply_position_revisions
    set status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(),
        cancellation_reason = v_reason, updated_at = now()
    where id = v_revision.id;
  else
    if v_replacement.id is not null and v_replacement.status = 'replacement_staging' then
      execute format(
        'update public.%I set order_status = ''cancelled'', cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3 where id = $1 and order_status <> ''cancelled''',
        v_replacement.replacement_request_item_table
      ) using v_replacement.replacement_request_item_id, p_actor, v_reason;
      update public.technologist_requests set status = 'cancelled', updated_at = now()
      where id = v_replacement.replacement_request_id and status = 'draft';
      perform set_config('app.long_stock_replacement_approval', '1', true);
      update public.long_stock_recalculation_replacements
      set status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(), cancellation_reason = v_reason
      where id = v_replacement.id;
      perform set_config('app.long_stock_replacement_approval', '', true);
    end if;
    perform set_config('app.long_stock_cutting_replacement_lifecycle', '1', true);
    update public.long_stock_cutting_plan_items
    set cutting_status = 'cancelled', link_state = 'superseded'
    where id = v_plan_item.id;
    perform set_config('app.long_stock_cutting_replacement_lifecycle', '', true);
  end if;
  perform set_config('app.supply_position_revision_lifecycle', '', true);

  perform set_config(
    case when v_revision.id is null
      then 'app.long_stock_recalculation_request_lifecycle'
      else 'app.supply_position_revision_request_lifecycle'
    end,
    '1', true
  );
  update public.department_requests
  set status = 'cancelled', response = v_reason, completed_by = p_actor,
      completed_at = now(), updated_at = now()
  where id = v_department.id and status in ('new', 'in_progress');
  perform set_config(
    case when v_revision.id is null
      then 'app.long_stock_recalculation_request_lifecycle'
      else 'app.supply_position_revision_request_lifecycle'
    end,
    '', true
  );
  update public.tasks
  set status = 'cancelled', completed_at = now(), updated_at = now()
  where department_request_id = v_department.id and status in ('pending', 'in_progress');
  insert into public.department_request_events(request_id, event_type, actor_id)
  select v_department.id, 'cancelled', p_actor
  where v_department.id is not null
    and not exists (
      select 1 from public.department_request_events event
      where event.request_id = v_department.id and event.event_type = 'cancelled'
    );

  return jsonb_build_object(
    'status', 'cancelled', 'idempotent', false,
    'mode', case when v_revision.id is null then 'long_stock_recalculation' else 'standard' end,
    'department_request_id', v_department.id
  );
end;
$$;

revoke all on function public.fn_cancel_returned_supply_position_v1(text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_cancel_returned_supply_position_v1(text, uuid, text, uuid)
  to service_role;

notify pgrst, 'reload schema';
