-- Cutting facts and rollbacks mutate inventory and production state. They are
-- reachable only through authorized server actions, never through an
-- authenticated PostgREST client. The actor UUID remains an internal argument
-- populated from the server-side user context.

revoke all on function public.fn_apply_production_fact_cutting(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_apply_production_fact_cutting(uuid, uuid)
  to service_role;

revoke all on function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
