alter table public.production_stages
  add column if not exists manual_overdue boolean not null default false;

comment on column public.production_stages.manual_overdue is
  'Manual production-stage overdue flag. Stage dates alone do not mark a production stage overdue in the UI.';

create or replace view public.production_stages_with_delay as
select
  ps.*,
  case
    when ps.manual_overdue
      and coalesce(ps.planned_date_end, ps.date_end, ps.date_start) is not null
      and current_date > coalesce(ps.planned_date_end, ps.date_end, ps.date_start)
    then current_date - coalesce(ps.planned_date_end, ps.date_end, ps.date_start)
    else 0
  end as delay_days,
  ps.manual_overdue as is_overdue
from public.production_stages ps;
