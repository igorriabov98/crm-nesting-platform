-- Reconcile legacy machines whose remaining material positions were all closed
-- by cancellation. Future cancellations are synchronized by the application.

with material_rows as (
  select request_id, order_status::text,
         nullif(to_jsonb(item)->>'delivered_at', '')::timestamptz as delivered_at,
         nullif(to_jsonb(item)->>'cancelled_at', '')::timestamptz as cancelled_at
  from public.request_sheet_metal item
  where not coalesce((to_jsonb(item)->>'is_cutting_plan_draft')::boolean, false)
  union all
  select request_id, order_status::text,
         nullif(to_jsonb(item)->>'delivered_at', '')::timestamptz,
         nullif(to_jsonb(item)->>'cancelled_at', '')::timestamptz
  from public.request_round_tube item
  where not coalesce((to_jsonb(item)->>'is_cutting_plan_draft')::boolean, false)
  union all
  select request_id, order_status::text,
         nullif(to_jsonb(item)->>'delivered_at', '')::timestamptz,
         nullif(to_jsonb(item)->>'cancelled_at', '')::timestamptz
  from public.request_circle item
  where not coalesce((to_jsonb(item)->>'is_cutting_plan_draft')::boolean, false)
  union all
  select request_id, order_status::text,
         nullif(to_jsonb(item)->>'delivered_at', '')::timestamptz,
         nullif(to_jsonb(item)->>'cancelled_at', '')::timestamptz
  from public.request_pipe item
  where not coalesce((to_jsonb(item)->>'is_cutting_plan_draft')::boolean, false)
  union all
  select request_id, order_status::text,
         nullif(to_jsonb(item)->>'delivered_at', '')::timestamptz,
         nullif(to_jsonb(item)->>'cancelled_at', '')::timestamptz
  from public.request_knives item
  where not coalesce((to_jsonb(item)->>'is_cutting_plan_draft')::boolean, false)
  union all
  select request_id, order_status::text,
         nullif(to_jsonb(item)->>'delivered_at', '')::timestamptz,
         nullif(to_jsonb(item)->>'cancelled_at', '')::timestamptz
  from public.request_components item
  where not coalesce((to_jsonb(item)->>'is_cutting_plan_draft')::boolean, false)
  union all
  select request_id, order_status::text,
         nullif(to_jsonb(item)->>'delivered_at', '')::timestamptz,
         nullif(to_jsonb(item)->>'cancelled_at', '')::timestamptz
  from public.request_paint item
  where not coalesce((to_jsonb(item)->>'is_cutting_plan_draft')::boolean, false)
  union all
  select request_id, order_status::text,
         nullif(to_jsonb(item)->>'delivered_at', '')::timestamptz,
         nullif(to_jsonb(item)->>'cancelled_at', '')::timestamptz
  from public.request_mesh item
  where not coalesce((to_jsonb(item)->>'is_cutting_plan_draft')::boolean, false)
  union all
  select request_id, order_status::text,
         nullif(to_jsonb(item)->>'delivered_at', '')::timestamptz,
         nullif(to_jsonb(item)->>'cancelled_at', '')::timestamptz
  from public.request_chain_cord item
  where not coalesce((to_jsonb(item)->>'is_cutting_plan_draft')::boolean, false)
), completed_machines as (
  select
    request.machine_id,
    coalesce(
      max(greatest(material.delivered_at, material.cancelled_at))::date,
      (now() at time zone 'Europe/Kyiv')::date
    ) as completed_on
  from material_rows material
  join public.technologist_requests request on request.id = material.request_id
  where request.status::text in ('submitted_to_supply', 'completed')
  group by request.machine_id
  having count(*) > 0
     and bool_and(material.order_status in ('delivered', 'cancelled'))
     and bool_or(material.order_status = 'cancelled')
)
update public.machines machine
set actual_material_date = completed.completed_on
from completed_machines completed
where machine.id = completed.machine_id
  and machine.actual_material_date is null;
