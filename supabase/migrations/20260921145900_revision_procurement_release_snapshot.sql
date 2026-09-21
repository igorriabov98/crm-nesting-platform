-- A restricted pre-change snapshot for rollback/audit; no account, request or stock mutations.
create table private.revision_procurement_release_snapshot (
 kind text not null, identity text not null, payload jsonb not null,
 captured_at timestamptz not null default now(), primary key(kind,identity)
);
revoke all on private.revision_procurement_release_snapshot from public,anon,authenticated;
grant select on private.revision_procurement_release_snapshot to service_role;
insert into private.revision_procurement_release_snapshot
 select 'function',p.oid::regprocedure::text,jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in (
 'fn_restore_technologist_revision_positions','fn_supply_position_revision_item_guard',
 'fn_submit_supply_position_revision_v1','fn_cleanup_cutting_drafts_and_guard_revision_stock_check',
 'fn_guard_long_stock_revision_submission','fn_cancel_returned_supply_position_v1',
 'fn_replace_supply_order_delivery_schedules_v1','activate_supply_start_task');
insert into private.revision_procurement_release_snapshot
 select 'department_permissions',id::text,to_jsonb(p) from public.department_access_permissions p;
insert into private.revision_procurement_release_snapshot
 select 'revision',id::text,to_jsonb(r) from public.supply_position_revisions r;
insert into private.revision_procurement_release_snapshot
 select 'archive',id::text,to_jsonb(a) from public.technologist_request_approval_archives a;
insert into private.revision_procurement_release_snapshot
 select 'task',id::text,to_jsonb(t) from public.tasks t where task_type='supply_start' and status in ('pending','in_progress')
 and title like 'Забронировать материал со склада и начать обработку заявки: %';
insert into private.revision_procurement_release_snapshot
 select 'schedule',id::text,to_jsonb(s) from public.supply_order_delivery_schedules s where request_item_id in (
 '3f7e5b34-9d90-4514-a95e-56ccb7e6df98','c5f8e59b-57dd-4c97-b242-9a6ccd820fe8',
 '4aa81ed9-3e2d-4df4-b43b-d158a84370e5','076cb110-0d2d-4706-abbf-22e4e5ae4d8b','743a3fcc-f26f-4853-832e-5c5ef908647b');
do $$ declare t text; begin
 foreach t in array array['request_circle','request_sheet_metal','request_paint'] loop
 execute format('insert into private.revision_procurement_release_snapshot select %L,id::text,to_jsonb(i) from public.%I i where request_id=%L',t,t,'c7cc1c62-d902-4614-8675-fb21e74e95d4');
 end loop;
end $$;
