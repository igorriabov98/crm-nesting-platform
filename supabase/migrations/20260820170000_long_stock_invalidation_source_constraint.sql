-- Keep every supported invalidation source mutually exclusive after the
-- receipt-recalculation and supply-return migrations are combined.

alter table public.long_stock_cutting_plan_versions
  drop constraint if exists long_stock_cutting_plan_versions_invalidation_check;

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
        invalidation_inventory_transfer_id,
        invalidation_department_request_id
      ) = 1
    )
  );
