-- Gmail integration: fast owner-scoped cache with explicit project sharing.

create table public.mail_settings (
  id boolean primary key default true check (id),
  google_project_id text,
  oauth_client_id text,
  oauth_client_secret_encrypted text,
  pubsub_topic text,
  configured_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email_address text not null,
  display_name text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  gmail_history_id text,
  next_page_token text,
  watch_expires_at timestamptz,
  last_synced_at timestamptz,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'syncing', 'ready', 'error', 'disconnected')),
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz,
  unique (user_id),
  unique (email_address)
);

create table public.mail_threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  gmail_thread_id text not null,
  subject text not null default '(Без темы)',
  snippet text not null default '',
  participants jsonb not null default '[]'::jsonb,
  label_ids text[] not null default '{}',
  last_message_at timestamptz not null,
  message_count integer not null default 0 check (message_count >= 0),
  is_unread boolean not null default false,
  is_starred boolean not null default false,
  has_attachments boolean not null default false,
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(snippet, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, gmail_thread_id)
);

create table public.mail_labels (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  gmail_label_id text not null,
  name text not null,
  label_type text not null default 'user' check (label_type in ('system', 'user')),
  color jsonb,
  messages_total integer,
  messages_unread integer,
  updated_at timestamptz not null default now(),
  unique (account_id, gmail_label_id)
);

create table public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  thread_id uuid not null references public.mail_threads(id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text not null,
  internet_message_id text,
  from_address text not null default '',
  from_name text,
  to_addresses jsonb not null default '[]'::jsonb,
  cc_addresses jsonb not null default '[]'::jsonb,
  bcc_addresses jsonb not null default '[]'::jsonb,
  subject text not null default '(Без темы)',
  snippet text not null default '',
  body_text text,
  body_html_sanitized text,
  label_ids text[] not null default '{}',
  received_at timestamptz not null,
  is_incoming boolean not null default false,
  is_unread boolean not null default false,
  is_starred boolean not null default false,
  body_cached_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, gmail_message_id)
);

create table public.mail_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.mail_messages(id) on delete cascade,
  gmail_attachment_id text not null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  storage_path text,
  cached_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id, gmail_attachment_id)
);

create table public.product_project_mail_threads (
  id uuid primary key default gen_random_uuid(),
  product_project_id uuid not null references public.product_projects(id) on delete cascade,
  thread_id uuid not null references public.mail_threads(id) on delete restrict,
  linked_by uuid not null references public.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  unlinked_by uuid references public.users(id) on delete set null,
  unique (product_project_id, thread_id)
);

create table public.mail_sync_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  provider_event_id text not null,
  history_id text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (account_id, provider_event_id)
);

alter table public.notifications
  add column if not exists related_mail_thread_id uuid references public.mail_threads(id) on delete set null;
alter table public.notifications
  add column if not exists related_mail_message_id uuid references public.mail_messages(id) on delete set null;
create index if not exists notifications_mail_thread_idx
  on public.notifications (related_mail_thread_id)
  where related_mail_thread_id is not null;
create unique index if not exists notifications_mail_message_unique_idx
  on public.notifications (user_id, related_mail_message_id)
  where related_mail_message_id is not null;

create index mail_threads_account_date_idx
  on public.mail_threads (account_id, last_message_at desc);
create index mail_labels_account_type_name_idx
  on public.mail_labels (account_id, label_type, name);
create index mail_threads_account_unread_date_idx
  on public.mail_threads (account_id, is_unread, last_message_at desc);
create index mail_threads_account_labels_idx
  on public.mail_threads using gin (label_ids);
create index mail_threads_search_idx
  on public.mail_threads using gin (search_vector);
create index mail_messages_thread_date_idx
  on public.mail_messages (thread_id, received_at);
create index mail_messages_account_gmail_thread_idx
  on public.mail_messages (account_id, gmail_thread_id, received_at);
create index project_mail_project_active_idx
  on public.product_project_mail_threads (product_project_id, linked_at desc)
  where unlinked_at is null;
create index project_mail_thread_active_idx
  on public.product_project_mail_threads (thread_id)
  where unlinked_at is null;
create index mail_accounts_watch_idx
  on public.mail_accounts (watch_expires_at)
  where disconnected_at is null;

alter table public.mail_settings enable row level security;
alter table public.mail_accounts enable row level security;
alter table public.mail_threads enable row level security;
alter table public.mail_labels enable row level security;
alter table public.mail_messages enable row level security;
alter table public.mail_attachments enable row level security;
alter table public.product_project_mail_threads enable row level security;
alter table public.mail_sync_events enable row level security;

-- Settings and encrypted token columns are server-only. The application exposes
-- masked values through permission-checked server actions.
revoke all on public.mail_settings from anon, authenticated;
revoke all on public.mail_accounts from anon, authenticated;
revoke all on public.mail_sync_events from anon, authenticated;
grant all on public.mail_settings to service_role;
grant all on public.mail_accounts to service_role;
grant all on public.mail_sync_events to service_role;

grant select on public.mail_threads, public.mail_messages, public.mail_attachments, public.mail_labels
  to authenticated;
grant select, insert, update on public.product_project_mail_threads
  to authenticated;

create policy mail_threads_owner_or_project_reader
  on public.mail_threads for select to authenticated
  using (
    exists (
      select 1 from public.mail_accounts account
      where account.id = mail_threads.account_id
        and account.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.product_project_mail_threads link
      where link.thread_id = mail_threads.id
        and link.unlinked_at is null
        and exists (
          select 1 from public.role_permissions permission
          join public.users actor on actor.id = (select auth.uid())
          where permission.role = actor.role
            and permission.resource_key = 'product_projects'
            and permission.can_view = true
        )
    )
  );

create policy mail_labels_owner
  on public.mail_labels for select to authenticated
  using (
    exists (
      select 1 from public.mail_accounts account
      where account.id = mail_labels.account_id
        and account.user_id = (select auth.uid())
    )
  );

create policy mail_messages_owner_or_project_reader
  on public.mail_messages for select to authenticated
  using (
    exists (
      select 1 from public.mail_accounts account
      where account.id = mail_messages.account_id
        and account.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.product_project_mail_threads link
      where link.thread_id = mail_messages.thread_id
        and link.unlinked_at is null
        and exists (
          select 1 from public.role_permissions permission
          join public.users actor on actor.id = (select auth.uid())
          where permission.role = actor.role
            and permission.resource_key = 'product_projects'
            and permission.can_view = true
        )
    )
  );

create policy mail_attachments_owner_or_project_reader
  on public.mail_attachments for select to authenticated
  using (
    exists (
      select 1 from public.mail_messages message
      where message.id = mail_attachments.message_id
    )
  );

create policy product_project_mail_links_reader
  on public.product_project_mail_threads for select to authenticated
  using (
    exists (
      select 1 from public.role_permissions permission
      join public.users actor on actor.id = (select auth.uid())
      where permission.role = actor.role
        and permission.resource_key = 'product_projects'
        and permission.can_view = true
    )
  );

create policy product_project_mail_links_manager_insert
  on public.product_project_mail_threads for insert to authenticated
  with check (
    linked_by = (select auth.uid())
    and exists (
      select 1 from public.mail_threads thread
      join public.mail_accounts account on account.id = thread.account_id
      where thread.id = product_project_mail_threads.thread_id
        and account.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.role_permissions permission
      join public.users actor on actor.id = (select auth.uid())
      where permission.role = actor.role
        and permission.resource_key = 'product_projects'
        and permission.can_manage = true
    )
  );

create policy product_project_mail_links_manager_update
  on public.product_project_mail_threads for update to authenticated
  using (
    exists (
      select 1 from public.role_permissions permission
      join public.users actor on actor.id = (select auth.uid())
      where permission.role = actor.role
        and permission.resource_key = 'product_projects'
        and permission.can_manage = true
    )
  )
  with check (
    exists (
      select 1 from public.role_permissions permission
      join public.users actor on actor.id = (select auth.uid())
      where permission.role = actor.role
        and permission.resource_key = 'product_projects'
        and permission.can_manage = true
    )
  );

comment on table public.mail_threads is 'Fast Gmail thread cache, owner-private until linked to a product project';
comment on table public.product_project_mail_threads is 'Soft-deletable sharing link between a Gmail thread and product project';

alter publication supabase_realtime add table public.mail_threads;

insert into public.role_permissions (role, resource_key, can_view, can_manage)
select role, 'mail', true, true
from unnest(enum_range(null::public.user_role)) as roles(role)
on conflict (role, resource_key) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('mail-project-attachments', 'mail-project-attachments', false, 26214400)
on conflict (id) do nothing;

insert into public.role_permissions (role, resource_key, can_view, can_manage)
select role, 'mail_settings', true, true
from unnest(array[
  'financial_director'::public.user_role,
  'commercial_director'::public.user_role,
  'planning_director'::public.user_role
]) as roles(role)
on conflict (role, resource_key) do nothing;
