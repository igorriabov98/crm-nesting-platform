-- Client price-list bulk adjustments and versioned order-discount approval.

alter type public.task_type add value if not exists 'order_discount_approval';

create table public.client_price_adjustments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  direction text not null check (direction in ('increase', 'decrease')),
  percent numeric(5,2) not null check (percent between 0.01 and 50.00),
  coatings public.coating_type[] not null check (cardinality(coatings) between 1 and 4),
  affected_prices integer not null default 0 check (affected_prices >= 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.client_price_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.client_price_adjustments(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  coating public.coating_type not null,
  old_price numeric(14,2) not null check (old_price >= 0),
  new_price numeric(14,2) not null check (new_price >= 0),
  created_at timestamptz not null default now(),
  unique (adjustment_id, product_id, coating)
);

create table public.client_price_adjustment_order_lines (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.client_price_adjustments(id) on delete restrict,
  machine_id uuid not null references public.machines(id) on delete restrict,
  machine_item_id uuid references public.machine_items(id) on delete set null,
  outcome text not null check (outcome in ('updated', 'skipped')),
  reason text,
  old_price numeric(14,2),
  new_price numeric(14,2),
  applied_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index client_price_adjustments_client_idx
  on public.client_price_adjustments(client_id, created_at desc);
create index client_price_adjustment_lines_adjustment_idx
  on public.client_price_adjustment_lines(adjustment_id);
create index client_price_adjustment_order_lines_lookup_idx
  on public.client_price_adjustment_order_lines(adjustment_id, machine_id, outcome);

create table public.machine_discount_requests (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete restrict,
  revision_number integer not null check (revision_number >= 1),
  status text not null check (status in ('pending', 'approved', 'rejected', 'superseded')),
  discount_percent numeric(5,2) not null check (discount_percent between 0.01 and 50.00),
  reason text not null check (char_length(btrim(reason)) between 3 and 2000),
  items_snapshot jsonb not null check (jsonb_typeof(items_snapshot) = 'array'),
  items_total_before_discount numeric(14,2) not null check (items_total_before_discount >= 0),
  discount_amount numeric(14,2) not null check (discount_amount >= 0),
  discounted_items_total numeric(14,2) not null check (discounted_items_total >= 0),
  expenses_total numeric(14,2) not null check (expenses_total >= 0),
  total_before_discount numeric(14,2) not null check (total_before_discount >= 0),
  total_after_discount numeric(14,2) not null check (total_after_discount >= 0),
  submitted_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  superseded_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (machine_id, revision_number),
  constraint machine_discount_decision_shape check (
    (status = 'pending' and decided_by is null and decided_at is null and decision_comment is null and superseded_reason is null)
    or (status = 'approved' and decided_by is not null and decided_at is not null and superseded_reason is null)
    or (status = 'rejected' and decided_by is not null and decided_at is not null and nullif(btrim(decision_comment), '') is not null and superseded_reason is null)
    or (status = 'superseded' and nullif(btrim(superseded_reason), '') is not null)
  )
);

create unique index machine_discount_one_active_idx
  on public.machine_discount_requests(machine_id)
  where status in ('pending', 'approved');
create index machine_discount_history_idx
  on public.machine_discount_requests(machine_id, revision_number desc);

alter table public.tasks
  add column if not exists machine_discount_request_id uuid
    references public.machine_discount_requests(id) on delete set null;
create index tasks_machine_discount_request_idx
  on public.tasks(machine_discount_request_id);
create unique index tasks_one_active_machine_discount_per_user
  on public.tasks(machine_discount_request_id, assigned_to)
  where machine_discount_request_id is not null and status in ('pending', 'in_progress');

alter table public.client_price_adjustments enable row level security;
alter table public.client_price_adjustment_lines enable row level security;
alter table public.client_price_adjustment_order_lines enable row level security;
alter table public.machine_discount_requests enable row level security;

revoke all on table public.client_price_adjustments from public, anon, authenticated;
revoke all on table public.client_price_adjustment_lines from public, anon, authenticated;
revoke all on table public.client_price_adjustment_order_lines from public, anon, authenticated;
revoke all on table public.machine_discount_requests from public, anon, authenticated;
grant all on table public.client_price_adjustments to service_role;
grant all on table public.client_price_adjustment_lines to service_role;
grant all on table public.client_price_adjustment_order_lines to service_role;
grant all on table public.machine_discount_requests to service_role;

create or replace function public.fn_user_can_manage_client_prices(p_actor uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users app_user
    join public.clients client on client.id = p_client_id
    where app_user.id = p_actor
      and app_user.is_active
      and (
        client.responsible_user_id = app_user.id
        or public.crm_user_is_admin(app_user.id)
        or (
          app_user.role <> 'sales_manager'
          and exists (
            select 1 from public.department_members sales_member
            join public.department_access_permissions sales_permission
              on sales_permission.department_id = sales_member.department_id
             and sales_permission.subject_scope = case when sales_member.is_department_head then 'head' else 'member' end
            where sales_member.user_id = app_user.id
              and sales_permission.resource_key = 'sales_plan'
              and sales_permission.can_manage
          )
          and exists (
            select 1 from public.department_members price_member
            join public.department_access_permissions price_permission
              on price_permission.department_id = price_member.department_id
             and price_permission.subject_scope = case when price_member.is_department_head then 'head' else 'member' end
            where price_member.user_id = app_user.id
              and price_permission.resource_key = 'client_prices'
              and price_permission.can_manage
              and (price_permission.company_manage_scope = 'all' or client.responsible_user_id = app_user.id)
          )
        )
      )
  );
$$;

create or replace function public.fn_user_can_decide_machine_discount(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users app_user
    where app_user.id = p_actor and app_user.is_active and app_user.role = 'financial_director'
  ) or public.crm_user_is_admin(p_actor);
$$;

create or replace function public.fn_machine_discount_items_snapshot(p_machine_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id,
    'productId', item.product_id,
    'coating', item.coating,
    'quantity', item.quantity,
    'price', round(item.price::numeric, 2)
  ) order by item.id), '[]'::jsonb)
  from public.machine_items item
  where item.machine_id = p_machine_id and not coalesce(item.is_sample, false);
$$;

create or replace function public.fn_supersede_machine_discount(p_machine_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_request_id uuid; v_submitted_by uuid; v_count integer := 0;
begin
  for v_request_id, v_submitted_by in
    select request.id, request.submitted_by
    from public.machine_discount_requests request
    where request.machine_id = p_machine_id and request.status in ('pending', 'approved')
    order by request.id for update
  loop
    update public.machine_discount_requests
    set status = 'superseded', superseded_reason = btrim(p_reason), updated_at = now()
    where id = v_request_id;
    update public.tasks
    set status = 'cancelled', completed_at = now(), updated_at = now()
    where machine_discount_request_id = v_request_id and status in ('pending', 'in_progress');
    if v_submitted_by is not null then
      insert into public.notifications(user_id, type, title, message, related_machine_id)
      values (v_submitted_by, 'order_discount_approval', 'Скидка требует нового согласования', btrim(p_reason), p_machine_id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.fn_adjust_client_product_prices(
  p_client_id uuid,
  p_direction text,
  p_percent numeric,
  p_coatings public.coating_type[],
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_adjustment_id uuid; v_affected integer;
begin
  if p_direction not in ('increase', 'decrease') then raise exception 'Некорректное направление изменения'; end if;
  if p_percent is null or p_percent < 0.01 or p_percent > 50 then raise exception 'Процент должен быть от 0,01 до 50'; end if;
  if p_coatings is null or cardinality(p_coatings) = 0
     or not (p_coatings <@ array['cold_zinc','zinc','powder_coating','none']::public.coating_type[]) then
    raise exception 'Выберите хотя бы один тип покрытия';
  end if;
  if not public.fn_user_can_manage_client_prices(p_actor, p_client_id) then raise exception 'Недостаточно прав для изменения прайса'; end if;

  perform 1 from public.client_product_prices price
  where price.client_id = p_client_id and price.coating = any(p_coatings)
  order by price.id for update;

  insert into public.client_price_adjustments(client_id, direction, percent, coatings, created_by)
  values (p_client_id, p_direction, round(p_percent, 2), p_coatings, p_actor)
  returning id into v_adjustment_id;

  insert into public.client_price_adjustment_lines(adjustment_id, product_id, coating, old_price, new_price)
  select v_adjustment_id, price.product_id, price.coating, round(price.price_eur::numeric, 2),
    round(price.price_eur::numeric * case when p_direction = 'increase' then 1 + p_percent / 100 else 1 - p_percent / 100 end, 2)
  from public.client_product_prices price
  where price.client_id = p_client_id and price.coating = any(p_coatings);
  get diagnostics v_affected = row_count;

  update public.client_product_prices price
  set price_eur = line.new_price, updated_by = p_actor, updated_at = now()
  from public.client_price_adjustment_lines line
  where line.adjustment_id = v_adjustment_id
    and price.client_id = p_client_id
    and price.product_id = line.product_id
    and price.coating = line.coating;
  update public.client_price_adjustments set affected_prices = v_affected where id = v_adjustment_id;

  return jsonb_build_object('adjustmentId', v_adjustment_id, 'affectedPrices', v_affected);
end;
$$;

create or replace function public.fn_apply_client_price_adjustment_to_orders(
  p_adjustment_id uuid,
  p_machine_ids uuid[],
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adjustment public.client_price_adjustments%rowtype;
  v_machine public.machines%rowtype;
  v_machine_id uuid;
  v_item record;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_machine_skipped integer := 0;
  v_reason text;
  v_skip_reasons jsonb := '{}'::jsonb;
begin
  select * into v_adjustment from public.client_price_adjustments where id = p_adjustment_id for update;
  if not found then raise exception 'Операция изменения прайса не найдена'; end if;
  if not public.fn_user_can_manage_client_prices(p_actor, v_adjustment.client_id) then raise exception 'Недостаточно прав для обновления заказов'; end if;
  if p_machine_ids is null or cardinality(p_machine_ids) = 0 then
    return jsonb_build_object('updatedPositions', 0, 'skippedPositions', 0, 'skipReasons', '{}'::jsonb);
  end if;

  for v_machine_id in select distinct id from unnest(p_machine_ids) id order by id loop
    select * into v_machine from public.machines where id = v_machine_id for update;
    v_reason := null;
    if not found then raise exception 'Заказ не найден';
    elsif v_machine.client_id is distinct from v_adjustment.client_id then v_reason := 'Заказ не относится к клиенту';
    elsif coalesce(v_machine.is_archived, false) then v_reason := 'Заказ архивирован';
    elsif v_machine.status::text = 'shipped' or v_machine.actual_shipping_date is not null then v_reason := 'Заказ уже отгружен';
    elsif exists (select 1 from public.invoices invoice where invoice.machine_id = v_machine_id and invoice.cancelled_at is null) then v_reason := 'По заказу есть активный инвойс';
    end if;

    if v_reason is not null then
      insert into public.client_price_adjustment_order_lines(
        adjustment_id, machine_id, machine_item_id, outcome, reason, old_price, new_price, applied_by
      )
      select p_adjustment_id, v_machine_id, item.id, 'skipped', v_reason,
        round(item.price::numeric, 2), line.new_price, p_actor
      from public.machine_items item
      join public.client_price_adjustment_lines line
        on line.adjustment_id = p_adjustment_id
       and line.product_id = item.product_id
       and line.coating = item.coating
      where item.machine_id = v_machine_id and not coalesce(item.is_sample, false);
      get diagnostics v_machine_skipped = row_count;
      if v_machine_skipped = 0 then
        insert into public.client_price_adjustment_order_lines(adjustment_id, machine_id, outcome, reason, applied_by)
        values (p_adjustment_id, v_machine_id, 'skipped', v_reason, p_actor);
      else
        v_skipped := v_skipped + v_machine_skipped;
        v_skip_reasons := jsonb_set(
          v_skip_reasons,
          array[v_reason],
          to_jsonb(coalesce((v_skip_reasons ->> v_reason)::integer, 0) + v_machine_skipped)
        );
      end if;
      continue;
    end if;

    for v_item in
      select item.id, item.price, line.old_price, line.new_price
      from public.machine_items item
      join public.client_price_adjustment_lines line
        on line.adjustment_id = p_adjustment_id
       and line.product_id = item.product_id
       and line.coating = item.coating
      where item.machine_id = v_machine_id and not coalesce(item.is_sample, false)
      order by item.id for update of item
    loop
      if round(v_item.price::numeric, 2) = v_item.old_price then
        update public.machine_items set price = v_item.new_price, updated_at = now() where id = v_item.id;
        insert into public.client_price_adjustment_order_lines(
          adjustment_id, machine_id, machine_item_id, outcome, old_price, new_price, applied_by
        ) values (p_adjustment_id, v_machine_id, v_item.id, 'updated', v_item.old_price, v_item.new_price, p_actor);
        v_updated := v_updated + 1;
      else
        insert into public.client_price_adjustment_order_lines(
          adjustment_id, machine_id, machine_item_id, outcome, reason, old_price, new_price, applied_by
        ) values (p_adjustment_id, v_machine_id, v_item.id, 'skipped', 'Индивидуальная цена не совпадает со старым прайсом', v_item.price, v_item.new_price, p_actor);
        v_skipped := v_skipped + 1;
        v_reason := 'Индивидуальная цена не совпадает со старым прайсом';
        v_skip_reasons := jsonb_set(
          v_skip_reasons,
          array[v_reason],
          to_jsonb(coalesce((v_skip_reasons ->> v_reason)::integer, 0) + 1)
        );
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'updatedPositions', v_updated,
    'skippedPositions', v_skipped,
    'skipReasons', v_skip_reasons
  );
end;
$$;

create or replace function public.fn_submit_machine_discount_request(
  p_machine_id uuid,
  p_discount_percent numeric,
  p_reason text,
  p_actor uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_machine public.machines%rowtype;
  v_snapshot jsonb;
  v_goods numeric(14,2);
  v_expenses numeric(14,2);
  v_discount numeric(14,2);
  v_revision integer;
  v_request_id uuid;
  v_recipients uuid[];
  v_recipient uuid;
begin
  if p_discount_percent is null or p_discount_percent < 0.01 or p_discount_percent > 50 then raise exception 'Скидка должна быть от 0,01 до 50%%'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Укажите причину скидки'; end if;
  select * into v_machine from public.machines where id = p_machine_id for update;
  if not found or v_machine.client_id is null then raise exception 'Заказ не найден'; end if;
  if not public.fn_user_can_manage_client_prices(p_actor, v_machine.client_id) then raise exception 'Недостаточно прав для запроса скидки'; end if;
  if coalesce(v_machine.is_archived, false) then raise exception 'Заказ находится в архиве'; end if;
  if exists (select 1 from public.invoices invoice where invoice.machine_id = p_machine_id and invoice.cancelled_at is null) then raise exception 'Сначала аннулируйте активный инвойс'; end if;
  if exists (select 1 from public.machine_discount_requests request where request.machine_id = p_machine_id and request.status = 'pending') then raise exception 'Скидка уже ожидает согласования'; end if;

  v_snapshot := public.fn_machine_discount_items_snapshot(p_machine_id);
  if jsonb_array_length(v_snapshot) = 0 then raise exception 'В заказе нет изделий'; end if;
  select round(coalesce(sum(item.price::numeric * item.quantity), 0), 2) into v_goods
  from public.machine_items item where item.machine_id = p_machine_id and not coalesce(item.is_sample, false);
  select round(coalesce(sum(expense.amount::numeric), 0), 2) into v_expenses
  from public.machine_expenses expense where expense.machine_id = p_machine_id;
  v_discount := round(v_goods * p_discount_percent / 100, 2);

  perform public.fn_supersede_machine_discount(p_machine_id, 'Создана новая заявка на скидку');
  select coalesce(max(request.revision_number), 0) + 1 into v_revision
  from public.machine_discount_requests request where request.machine_id = p_machine_id;

  select coalesce(array_agg(app_user.id order by app_user.id), '{}'::uuid[]) into v_recipients
  from public.users app_user where app_user.is_active and app_user.role = 'financial_director';
  if cardinality(v_recipients) = 0 then
    select coalesce(array_agg(distinct app_user.id order by app_user.id), '{}'::uuid[]) into v_recipients
    from public.users app_user
    join public.department_members member on member.user_id = app_user.id
    join public.positions position on position.id = member.position_id
    where app_user.is_active and position.is_active and position.name = 'Администратор CRM';
  end if;
  if cardinality(v_recipients) = 0 then raise exception 'Нет активного финансового директора или администратора CRM'; end if;

  insert into public.machine_discount_requests(
    machine_id, revision_number, status, discount_percent, reason, items_snapshot,
    items_total_before_discount, discount_amount, discounted_items_total, expenses_total,
    total_before_discount, total_after_discount, submitted_by
  ) values (
    p_machine_id, v_revision, 'pending', round(p_discount_percent, 2), btrim(p_reason), v_snapshot,
    v_goods, v_discount, v_goods - v_discount, v_expenses,
    v_goods + v_expenses, v_goods - v_discount + v_expenses, p_actor
  ) returning id into v_request_id;

  foreach v_recipient in array v_recipients loop
    insert into public.tasks(machine_id, assigned_to, task_type, title, description, status, start_date, deadline, machine_discount_request_id)
    values (
      p_machine_id, v_recipient, 'order_discount_approval', 'Согласовать скидку на заказ',
      'Заказ «' || coalesce(v_machine.name, 'Без названия') || '», скидка ' || round(p_discount_percent, 2) || '%',
      'pending', (now() at time zone 'Europe/Kyiv')::date, (now() at time zone 'Europe/Kyiv')::date, v_request_id
    );
  end loop;
  return v_request_id;
end;
$$;

create or replace function public.fn_approve_machine_discount_request(p_request_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.machine_discount_requests%rowtype; v_expenses numeric(14,2);
begin
  if not public.fn_user_can_decide_machine_discount(p_actor) then raise exception 'Одобрить скидку может финансовый директор или администратор CRM'; end if;
  perform 1 from public.machines machine join public.machine_discount_requests request on request.machine_id = machine.id
    where request.id = p_request_id order by machine.id for update of machine;
  select * into v_request from public.machine_discount_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then raise exception 'Решение по заявке уже принято'; end if;
  if exists (select 1 from public.machines where id = v_request.machine_id and is_archived) then raise exception 'Заказ находится в архиве'; end if;
  if exists (select 1 from public.invoices invoice where invoice.machine_id = v_request.machine_id and invoice.cancelled_at is null) then raise exception 'По заказу уже есть активный инвойс'; end if;
  if v_request.items_snapshot is distinct from public.fn_machine_discount_items_snapshot(v_request.machine_id) then
    perform public.fn_supersede_machine_discount(v_request.machine_id, 'Состав или цены заказа изменились');
    return null;
  end if;
  select round(coalesce(sum(expense.amount::numeric), 0), 2) into v_expenses
  from public.machine_expenses expense where expense.machine_id = v_request.machine_id;
  update public.machine_discount_requests set
    status = 'approved', expenses_total = v_expenses,
    total_before_discount = items_total_before_discount + v_expenses,
    total_after_discount = discounted_items_total + v_expenses,
    decided_by = p_actor, decided_at = now(), updated_at = now()
  where id = p_request_id;
  update public.tasks set status = 'completed', completed_at = now(), updated_at = now()
  where machine_discount_request_id = p_request_id and status in ('pending', 'in_progress');
  if v_request.submitted_by is not null then
    insert into public.notifications(user_id, type, title, message, related_machine_id)
    values (v_request.submitted_by, 'order_discount_approval', 'Скидка одобрена', 'Скидка ' || v_request.discount_percent || '% применена к изделиям заказа.', v_request.machine_id);
  end if;
  return p_request_id;
end;
$$;

create or replace function public.fn_reject_machine_discount_request(p_request_id uuid, p_actor uuid, p_comment text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.machine_discount_requests%rowtype;
begin
  if not public.fn_user_can_decide_machine_discount(p_actor) then raise exception 'Отклонить скидку может финансовый директор или администратор CRM'; end if;
  if char_length(btrim(coalesce(p_comment, ''))) < 3 then raise exception 'Укажите причину отклонения'; end if;
  perform 1 from public.machines machine join public.machine_discount_requests request on request.machine_id = machine.id
    where request.id = p_request_id order by machine.id for update of machine;
  select * into v_request from public.machine_discount_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then raise exception 'Решение по заявке уже принято'; end if;
  update public.machine_discount_requests set status = 'rejected', decision_comment = btrim(p_comment),
    decided_by = p_actor, decided_at = now(), updated_at = now() where id = p_request_id;
  update public.tasks set status = 'completed', completed_at = now(), updated_at = now()
  where machine_discount_request_id = p_request_id and status in ('pending', 'in_progress');
  if v_request.submitted_by is not null then
    insert into public.notifications(user_id, type, title, message, related_machine_id)
    values (v_request.submitted_by, 'order_discount_approval', 'Скидка отклонена', btrim(p_comment), v_request.machine_id);
  end if;
  return p_request_id;
end;
$$;

create or replace function public.fn_guard_machine_discount_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Историю согласования скидки нельзя удалять'; end if;
  if old.status not in ('pending', 'approved')
     or new.status not in ('approved', 'rejected', 'superseded')
     or (to_jsonb(new) - array['status','expenses_total','total_before_discount','total_after_discount','decided_by','decided_at','decision_comment','superseded_reason','updated_at'])
        is distinct from
        (to_jsonb(old) - array['status','expenses_total','total_before_discount','total_after_discount','decided_by','decided_at','decision_comment','superseded_reason','updated_at']) then
    raise exception 'Снимок заявки на скидку неизменяем';
  end if;
  return new;
end;
$$;
create trigger machine_discount_request_immutable
before update or delete on public.machine_discount_requests
for each row execute function public.fn_guard_machine_discount_request();

create or replace function public.fn_supersede_machine_discount_from_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_machine_id uuid;
begin
  -- Samples are not discounted, so edits that remain sample-only must not
  -- invalidate an otherwise current product discount.
  if tg_op = 'INSERT' and coalesce(new.is_sample, false) then return new; end if;
  if tg_op = 'DELETE' and coalesce(old.is_sample, false) then return old; end if;
  if tg_op = 'UPDATE'
     and coalesce(old.is_sample, false)
     and coalesce(new.is_sample, false) then return new; end if;
  if tg_op = 'UPDATE' and new.machine_id is not distinct from old.machine_id
     and new.product_id is not distinct from old.product_id
     and new.coating is not distinct from old.coating
     and new.quantity is not distinct from old.quantity
     and new.price is not distinct from old.price
     and new.is_sample is not distinct from old.is_sample then return new; end if;
  v_machine_id := case when tg_op = 'DELETE' then old.machine_id else new.machine_id end;
  perform public.fn_supersede_machine_discount(v_machine_id, 'Изменён состав, изделие, покрытие, количество или цена заказа');
  if tg_op = 'UPDATE' and old.machine_id is distinct from new.machine_id then
    perform public.fn_supersede_machine_discount(old.machine_id, 'Позиция перенесена в другой заказ');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger machine_item_supersedes_discount
after insert or update of machine_id, product_id, coating, quantity, price, is_sample or delete on public.machine_items
for each row execute function public.fn_supersede_machine_discount_from_item();

create or replace function public.fn_supersede_machine_discount_from_machine()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is distinct from old.client_id then
    perform public.fn_supersede_machine_discount(new.id, 'Изменён клиент заказа');
  elsif new.is_archived and not old.is_archived then
    perform public.fn_supersede_machine_discount(new.id, 'Заказ архивирован');
  end if;
  return new;
end;
$$;
create trigger machine_change_supersedes_discount
after update of client_id, is_archived on public.machines
for each row execute function public.fn_supersede_machine_discount_from_machine();

create or replace function public.fn_guard_invoice_pending_machine_discount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cancelled_at is null then
    perform 1 from public.machines machine where machine.id = new.machine_id for update;
    if exists (
      select 1 from public.machine_discount_requests request
      where request.machine_id = new.machine_id and request.status = 'pending'
    ) then
      raise exception 'Новый инвойс заблокирован: скидка ожидает подтверждения';
    end if;
  end if;
  return new;
end;
$$;
create trigger invoice_pending_machine_discount_guard
before insert or update of machine_id, cancelled_at on public.invoices
for each row execute function public.fn_guard_invoice_pending_machine_discount();

create or replace function public.fn_guard_machine_discount_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.machine_discount_request_id is not null
     and exists (select 1 from public.machine_discount_requests request where request.id = old.machine_discount_request_id and request.status = 'pending')
     and (tg_op = 'DELETE' or new.machine_discount_request_id is distinct from old.machine_discount_request_id
       or new.assigned_to is distinct from old.assigned_to or new.machine_id is distinct from old.machine_id
       or new.status in ('completed','cancelled')) then
    raise exception 'Задача закрывается только решением по скидке';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger machine_discount_task_guard
before update or delete on public.tasks
for each row execute function public.fn_guard_machine_discount_task();

revoke all on function public.fn_user_can_manage_client_prices(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_user_can_decide_machine_discount(uuid) from public, anon, authenticated;
revoke all on function public.fn_machine_discount_items_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.fn_supersede_machine_discount(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_adjust_client_product_prices(uuid, text, numeric, public.coating_type[], uuid) from public, anon, authenticated;
revoke all on function public.fn_apply_client_price_adjustment_to_orders(uuid, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.fn_submit_machine_discount_request(uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.fn_approve_machine_discount_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_reject_machine_discount_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fn_guard_machine_discount_request() from public, anon, authenticated;
revoke all on function public.fn_supersede_machine_discount_from_item() from public, anon, authenticated;
revoke all on function public.fn_supersede_machine_discount_from_machine() from public, anon, authenticated;
revoke all on function public.fn_guard_invoice_pending_machine_discount() from public, anon, authenticated;
revoke all on function public.fn_guard_machine_discount_task() from public, anon, authenticated;

grant execute on function public.fn_adjust_client_product_prices(uuid, text, numeric, public.coating_type[], uuid) to service_role;
grant execute on function public.fn_apply_client_price_adjustment_to_orders(uuid, uuid[], uuid) to service_role;
grant execute on function public.fn_submit_machine_discount_request(uuid, numeric, text, uuid) to service_role;
grant execute on function public.fn_approve_machine_discount_request(uuid, uuid) to service_role;
grant execute on function public.fn_reject_machine_discount_request(uuid, uuid, text) to service_role;

comment on table public.client_price_adjustments is 'Atomic client price-list bulk operations.';
comment on table public.client_price_adjustment_order_lines is 'Exact per-order position outcomes for a client price adjustment.';
comment on table public.machine_discount_requests is 'Immutable version history of order discount approvals.';
