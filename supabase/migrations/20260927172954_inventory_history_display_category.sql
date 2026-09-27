-- Apply the same operational category used by the inventory UI before
-- filtering and counting transactions. A wire variant is shown as "Круги".
create view public.inventory_history_transactions_with_category
with (security_invoker = true)
as
select
  txn.*,
  case
    when material.category = 'pipe'::public.material_category
      and (
        coalesce(transaction_variant.pipe_type, stock_variant.pipe_type) = 'wire'
        or (
          coalesce(transaction_variant.pipe_type, stock_variant.pipe_type) is null
          and stock.unit = 'кг'
        )
      )
      then 'circle'::public.material_category
    else material.category
  end as display_category
from public.inventory_transactions as txn
left join public.materials as material on material.id = txn.material_id
left join public.inventory as stock on stock.id = txn.inventory_id
left join public.material_variants as transaction_variant on transaction_variant.id = txn.material_variant_id
left join public.material_variants as stock_variant on stock_variant.id = stock.material_variant_id;

revoke all on public.inventory_history_transactions_with_category from public, anon;
grant select on public.inventory_history_transactions_with_category to authenticated;
