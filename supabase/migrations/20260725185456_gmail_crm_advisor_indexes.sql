-- Cover the remaining Gmail integration foreign keys reported by Supabase
-- advisors. These indexes keep parent-row updates/deletes from scanning the
-- mail cache and notification tables as they grow.

create index if not exists mail_settings_configured_by_idx
  on public.mail_settings (configured_by);

create index if not exists notifications_related_mail_message_idx
  on public.notifications (related_mail_message_id);

create index if not exists product_project_mail_threads_linked_by_idx
  on public.product_project_mail_threads (linked_by);

create index if not exists product_project_mail_threads_unlinked_by_idx
  on public.product_project_mail_threads (unlinked_by);
