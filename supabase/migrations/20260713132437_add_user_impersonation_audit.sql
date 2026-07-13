-- Audit trail for CRM administrators opening a real user session to verify access.
-- Session tokens never reach this table; only actor, target and outcome are stored.

CREATE TABLE IF NOT EXISTS public.user_impersonation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  target_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed')),
  failure_reason TEXT,
  CONSTRAINT user_impersonation_different_users CHECK (admin_user_id <> target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_impersonation_audit_admin_started
  ON public.user_impersonation_audit (admin_user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_impersonation_audit_target_started
  ON public.user_impersonation_audit (target_user_id, started_at DESC);

ALTER TABLE public.user_impersonation_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_impersonation_audit FROM anon, authenticated;
REVOKE ALL ON TABLE public.user_impersonation_audit FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_impersonation_audit TO service_role;

COMMENT ON TABLE public.user_impersonation_audit IS
  'Server-only audit trail for CRM administrator user impersonation sessions.';
