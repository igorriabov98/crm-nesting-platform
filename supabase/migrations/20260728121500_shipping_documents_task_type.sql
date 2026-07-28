ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'shipping_documents';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_service_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.is_service_account IS
  'Служебные аккаунты не могут быть исполнителями автоматически создаваемых бизнес-задач.';

UPDATE public.users
SET is_service_account = true,
    updated_at = now()
WHERE lower(btrim(COALESCE(full_name, ''))) = 'ci smoke user'
   OR lower(COALESCE(email, '')) LIKE '%smoke%';
