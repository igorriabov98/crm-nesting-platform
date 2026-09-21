-- Read-only production preflight confirmed these five pending rows have placed schedules.
-- Do not change quantities, suppliers, cancelled returns, receipts, reservations or unrelated orders.
set local search_path=pg_catalog,public,pg_temp;
do $$ declare r record; v_after jsonb; begin
 for r in select * from (values
 ('request_circle','3f7e5b34-9d90-4514-a95e-56ccb7e6df98'::uuid),
 ('request_circle','c5f8e59b-57dd-4c97-b242-9a6ccd820fe8'::uuid),
 ('request_sheet_metal','4aa81ed9-3e2d-4df4-b43b-d158a84370e5'::uuid),
 ('request_sheet_metal','076cb110-0d2d-4706-abbf-22e4e5ae4d8b'::uuid),
 ('request_paint','743a3fcc-f26f-4853-832e-5c5ef908647b'::uuid)
 ) x(item_table,item_id) loop
 execute format($sql$
 update public.%I item set order_status='ordered',ordered_at=coalesce(item.ordered_at,(
 select min(created_at) from public.supply_order_delivery_schedules where request_item_table=$1 and request_item_id=$2 and status='planned' and supplier_id is not null))
 where item.id=$2 and item.request_id='c7cc1c62-d902-4614-8675-fb21e74e95d4' and item.order_status='pending'
 and exists(select 1 from public.supply_order_delivery_schedules where request_item_table=$1 and request_item_id=$2 and status='planned' and supplier_id is not null and quantity>0)
 and not exists(select 1 from public.supply_position_revisions where source_request_item_table=$1 and source_request_item_id=$2 and status in ('requested','editing','stock_check'))
 returning to_jsonb(item)
 $sql$,r.item_table) into v_after using r.item_table,r.item_id;
 if v_after is not null then
 insert into private.revision_procurement_release_snapshot values('ordered_status_reconciled',r.item_id::text,
 jsonb_build_object('after',v_after,'reason','Placed supplier schedule existed; source status was not synchronized','release','revision-procurement-receiving'),now());
 end if;
 end loop;
end $$;
