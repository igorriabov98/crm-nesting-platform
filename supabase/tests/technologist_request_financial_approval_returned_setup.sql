-- Applied only by the localhost test runner immediately before the personal
-- approval-workflow migration. It represents a request returned by the older
-- approval flow, which created no personal request or rework task.
insert into public.factories(id, name, city)
values ('95000000-0000-4000-8000-000000000001', 'APPROVAL-RETURNED-BACKFILL', 'Ужгород');

insert into public.users(id, email, full_name, role, factory_id, is_active)
values (
  '95000000-0000-4000-8000-000000000002',
  'returned-backfill@approval.test',
  'Технолог старого возврата',
  'technologist',
  '95000000-0000-4000-8000-000000000001',
  true
);

insert into public.machines(id, name, factory_id, created_by, status, material_type)
values (
  '95000000-0000-4000-8000-000000000003',
  'APPROVAL RETURNED BACKFILL',
  '95000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000002',
  'planned',
  'standard'
);

insert into public.technologist_requests(id, machine_id, created_by, status)
values (
  '95000000-0000-4000-8000-000000000005',
  '95000000-0000-4000-8000-000000000003',
  '95000000-0000-4000-8000-000000000002',
  'pending_stock_check'
);

insert into public.technologist_request_approval_versions(
  id, request_id, revision_number, state, completion_payload, summary_snapshot,
  submitted_by, decided_by, decided_at, return_reason
) values (
  '95000000-0000-4000-8000-000000000004',
  '95000000-0000-4000-8000-000000000005',
  0,
  'returned',
  '{}'::jsonb,
  '{}'::jsonb,
  '95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000002',
  now(),
  'Проверка восстановления старого возврата'
);
