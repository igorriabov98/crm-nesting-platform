CREATE TABLE IF NOT EXISTS public.machine_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.machine_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.machine_chat_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.machine_chat_messages(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_machine_updates_machine_created
  ON public.machine_updates(machine_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_machine_chat_messages_machine_created
  ON public.machine_chat_messages(machine_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_machine_chat_mentions_user
  ON public.machine_chat_mentions(user_id);

CREATE OR REPLACE FUNCTION public.touch_machine_update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS machine_updates_touch_updated_at ON public.machine_updates;
CREATE TRIGGER machine_updates_touch_updated_at
  BEFORE UPDATE ON public.machine_updates
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_machine_update_updated_at();

ALTER TABLE public.machine_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_chat_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS machine_updates_select ON public.machine_updates;
CREATE POLICY machine_updates_select
  ON public.machine_updates
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.machines m
      WHERE m.id = machine_updates.machine_id
        AND (
          CASE
            WHEN public.get_user_role() = 'production_manager' THEN
              m.factory_id = public.get_user_factory_id() OR m.factory_id IS NULL
            ELSE true
          END
        )
    )
  );

DROP POLICY IF EXISTS machine_chat_messages_select ON public.machine_chat_messages;
CREATE POLICY machine_chat_messages_select
  ON public.machine_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.machines m
      WHERE m.id = machine_chat_messages.machine_id
        AND (
          CASE
            WHEN public.get_user_role() = 'production_manager' THEN
              m.factory_id = public.get_user_factory_id() OR m.factory_id IS NULL
            ELSE true
          END
        )
    )
  );

DROP POLICY IF EXISTS machine_chat_mentions_select ON public.machine_chat_mentions;
CREATE POLICY machine_chat_mentions_select
  ON public.machine_chat_mentions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.machines m
      WHERE m.id = machine_chat_mentions.machine_id
        AND (
          CASE
            WHEN public.get_user_role() = 'production_manager' THEN
              m.factory_id = public.get_user_factory_id() OR m.factory_id IS NULL
            ELSE true
          END
        )
    )
  );

DROP POLICY IF EXISTS machine_updates_service_role_modify ON public.machine_updates;
CREATE POLICY machine_updates_service_role_modify
  ON public.machine_updates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS machine_chat_messages_service_role_modify ON public.machine_chat_messages;
CREATE POLICY machine_chat_messages_service_role_modify
  ON public.machine_chat_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS machine_chat_mentions_service_role_modify ON public.machine_chat_mentions;
CREATE POLICY machine_chat_mentions_service_role_modify
  ON public.machine_chat_mentions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.machine_updates TO authenticated;
GRANT SELECT ON public.machine_chat_messages TO authenticated;
GRANT SELECT ON public.machine_chat_mentions TO authenticated;
