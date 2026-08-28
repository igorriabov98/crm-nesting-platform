-- A source can be taken between calculation and approval. The approval call
-- returns a controlled conflict and removes only that still-draft immutable
-- version, so the losing attempt leaves no version, reservation or transfer.

do $migration$
declare
  v_definition text;
  v_anchor text := E'  if tg_op = \'DELETE\' then\n    raise exception \'Версия карты раскроя неизменяема\';\n  end if;';
  v_replacement text := E'  if tg_op = \'DELETE\' then\n    if current_setting(\'app.long_stock_cutting_draft_cleanup\', true) = \'1\'\n      and old.status = \'draft\' then\n      return old;\n    end if;\n    raise exception \'Версия карты раскроя неизменяема\';\n  end if;';
begin
  v_definition := pg_get_functiondef(
    'public.fn_long_stock_cutting_version_guard()'::regprocedure
  );
  if position(v_anchor in v_definition) = 0 then
    raise exception 'Не найден запрет удаления версии карты раскроя';
  end if;
  execute replace(v_definition, v_anchor, v_replacement);
end;
$migration$;

alter function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  rename to fn_approve_long_stock_before_source_conflict_v1;
revoke all on function public.fn_approve_long_stock_before_source_conflict_v1(uuid, uuid, jsonb)
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
  v_error text;
  v_plan_id uuid;
begin
  begin
    return public.fn_approve_long_stock_before_source_conflict_v1(
      p_version_id, p_actor, p_pdf_metadata
    );
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like 'Хлыст №%' then raise; end if;
  end;

  select plan_id into v_plan_id
  from public.long_stock_cutting_plan_versions
  where id = p_version_id and status = 'draft'
  for update;
  if v_plan_id is null then raise exception '%', v_error; end if;

  perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
  update public.long_stock_cutting_plan_versions
  set definition_sealed = false
  where id = p_version_id and status = 'draft';
  perform set_config('app.long_stock_cutting_version_lifecycle', '', true);

  delete from public.long_stock_cutting_bar_cuts
  where candidate_id in (
    select id from public.long_stock_cutting_candidates where version_id = p_version_id
  );
  delete from public.long_stock_cutting_candidate_bars
  where version_id = p_version_id;
  delete from public.long_stock_cutting_candidates
  where version_id = p_version_id;
  delete from public.long_stock_cutting_segments
  where version_id = p_version_id;

  perform set_config('app.long_stock_cutting_draft_cleanup', '1', true);
  delete from public.long_stock_cutting_plan_versions
  where id = p_version_id and status = 'draft';
  perform set_config('app.long_stock_cutting_draft_cleanup', '', true);

  return jsonb_build_object(
    'status', 'conflict',
    'position_status', 'planning',
    'plan_id', v_plan_id,
    'discarded_version_id', p_version_id,
    'message', v_error
  );
end;
$$;

revoke all on function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';
