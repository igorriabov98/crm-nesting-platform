create index if not exists idx_clients_updated_at_desc
  on public.clients (updated_at desc);

create index if not exists idx_machines_client_archived_updated
  on public.machines (client_id, is_archived, updated_at desc);

create index if not exists idx_invoices_machine_status_due
  on public.invoices (machine_id, status, due_date);

drop view if exists public.client_list_summary;

create view public.client_list_summary
with (security_invoker = true)
as
select
  c.id,
  c.name,
  c.primary_contact_name,
  c.phone,
  c.email,
  c.country_city,
  c.payment_terms_type,
  c.payment_due_days,
  c.prepayment_percent,
  c.final_payment_due_days,
  coalesce(machine_summary.active_machines_count, 0)::integer as active_machines_count,
  coalesce(invoice_summary.current_invoice_amount, 0)::numeric as current_invoice_amount,
  coalesce(invoice_summary.overdue_invoice_amount, 0)::numeric as overdue_invoice_amount,
  greatest(c.updated_at, coalesce(machine_summary.last_machine_activity, c.updated_at)) as last_activity,
  c.updated_at
from public.clients c
left join lateral (
  select
    count(*) filter (where coalesce(m.is_archived, false) = false)::integer as active_machines_count,
    max(m.updated_at) as last_machine_activity
  from public.machines m
  where m.client_id = c.id
) machine_summary on true
left join lateral (
  select
    sum(coalesce(i.amount, 0) - coalesce(i.paid_amount, 0)) filter (
      where i.status is distinct from 'paid'::invoice_status
    ) as current_invoice_amount,
    sum(coalesce(i.amount, 0) - coalesce(i.paid_amount, 0)) filter (
      where i.status is distinct from 'paid'::invoice_status
        and coalesce(i.due_date, i.payment_date) is not null
        and coalesce(i.due_date, i.payment_date)::timestamptz < now()
    ) as overdue_invoice_amount
  from public.machines m
  join public.invoices i on i.machine_id = m.id
  where m.client_id = c.id
) invoice_summary on true;
