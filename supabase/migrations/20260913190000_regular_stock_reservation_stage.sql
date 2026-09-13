-- Split material reservation into two explicit stages and prevent supply handoff
-- before the technologist has reviewed the regular warehouse.

create or replace function public.fn_complete_business_scrap_stage_v1(
  p_request_id uuid,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.technologist_requests%rowtype;
  v_actor_role public.user_role;
  v_detailing_check jsonb;
  v_is_revision boolean;
begin
  select * into v_request
  from public.technologist_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Заявка технолога не найдена';
  end if;
  if v_request.status <> 'pending_stock_check' then
    raise exception 'Этап делового остатка уже завершён или ещё не открыт';
  end if;

  select role into v_actor_role from public.users where id = p_actor and is_active = true;
  if v_actor_role is null then raise exception 'Пользователь не найден или неактивен'; end if;
  if v_request.created_by is distinct from p_actor
     and v_actor_role not in ('planning_director', 'financial_director', 'commercial_director')
     and (
       v_actor_role <> 'technologist'
       or not exists (
         select 1 from public.tasks t
         where t.machine_id = v_request.machine_id
           and t.task_type = 'technologist_request'
           and t.assigned_to = p_actor
           and t.status in ('pending', 'in_progress', 'completed')
       )
     ) then
    raise exception 'Завершить этап может автор, назначенный технолог или руководитель';
  end if;

  select exists (
    select 1 from public.supply_position_revisions r
    where r.replacement_request_id = p_request_id
  ) into v_is_revision;

  if not v_is_revision then
    v_detailing_check := public.fn_validate_detailing_request_check(p_request_id, p_actor);
    if not coalesce((v_detailing_check->>'ready')::boolean, false) then
      raise exception '%', coalesce(
        v_detailing_check->>'message',
        'Проверьте подходящую деталировку перед переходом к основному складу'
      );
    end if;
  end if;

  update public.technologist_requests
  set status = 'stock_checked', updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'status', 'stock_checked',
    'is_revision', v_is_revision
  );
end;
$$;

revoke all on function public.fn_complete_business_scrap_stage_v1(uuid, uuid) from public, anon;
grant execute on function public.fn_complete_business_scrap_stage_v1(uuid, uuid) to authenticated, service_role;

create or replace function public.fn_guard_regular_stock_stage_submission_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'submitted_to_supply'
     and old.status is distinct from 'submitted_to_supply'
     and old.status is distinct from 'stock_checked' then
    raise exception using
      errcode = '55000',
      message = '[REGULAR_STOCK_CHECK_REQUIRED] Перед передачей в снабжение завершите бронь основного склада';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_guard_regular_stock_stage_submission_v1() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_regular_stock_stage_submission_v1 on public.technologist_requests;
create trigger trg_guard_regular_stock_stage_submission_v1
before update of status on public.technologist_requests
for each row execute function public.fn_guard_regular_stock_stage_submission_v1();
