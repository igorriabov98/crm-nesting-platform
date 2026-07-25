-- Store Gmail OAuth credentials in Supabase Vault. Application tables retain
-- only opaque Vault UUIDs; decrypted values are available exclusively through
-- service-role RPC functions whose EXECUTE privilege is explicitly restricted.

alter table public.mail_settings
  add column if not exists oauth_client_secret_vault_id uuid;

alter table public.mail_accounts
  add column if not exists access_token_vault_id uuid,
  add column if not exists refresh_token_vault_id uuid;

create or replace function public.mail_vault_store_secret(
  p_secret_id uuid,
  p_secret text,
  p_name text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  result_id uuid;
begin
  if p_secret is null or p_secret = '' then
    raise exception 'Mail Vault secret must not be empty';
  end if;

  if p_secret_id is null then
    select vault.create_secret(p_secret, p_name, p_description, null)
      into result_id;
  else
    if not exists (select 1 from vault.secrets where id = p_secret_id) then
      raise exception 'Mail Vault secret % does not exist', p_secret_id;
    end if;
    perform vault.update_secret(p_secret_id, p_secret, p_name, p_description, null);
    result_id := p_secret_id;
  end if;

  return result_id;
end;
$$;

create or replace function public.mail_vault_read_secret(p_secret_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  result_secret text;
begin
  select decrypted_secret
    into result_secret
  from vault.decrypted_secrets
  where id = p_secret_id;

  if result_secret is null then
    raise exception 'Mail Vault secret % does not exist', p_secret_id;
  end if;

  return result_secret;
end;
$$;

create or replace function public.mail_vault_delete_secret(p_secret_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public, vault
as $$
  delete from vault.secrets where id = p_secret_id;
$$;

revoke all on function public.mail_vault_store_secret(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.mail_vault_read_secret(uuid)
  from public, anon, authenticated;
revoke all on function public.mail_vault_delete_secret(uuid)
  from public, anon, authenticated;

grant execute on function public.mail_vault_store_secret(uuid, text, text, text)
  to service_role;
grant execute on function public.mail_vault_read_secret(uuid)
  to service_role;
grant execute on function public.mail_vault_delete_secret(uuid)
  to service_role;

comment on column public.mail_settings.oauth_client_secret_vault_id
  is 'Opaque Supabase Vault UUID for the Google OAuth client secret';
comment on column public.mail_accounts.access_token_vault_id
  is 'Opaque Supabase Vault UUID for the short-lived Gmail access token';
comment on column public.mail_accounts.refresh_token_vault_id
  is 'Opaque Supabase Vault UUID for the Gmail refresh token';
