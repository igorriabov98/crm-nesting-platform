DO $$
BEGIN
  CREATE TYPE task_delegation_status AS ENUM ('pending', 'accepted', 'declined', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS task_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  delegated_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegated_from UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegated_to UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  status task_delegation_status NOT NULL DEFAULT 'pending',
  note TEXT,
  decline_reason TEXT,
  delegated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,

  CONSTRAINT task_delegations_no_self_delegate CHECK (delegated_from <> delegated_to),
  CONSTRAINT task_delegations_decline_reason_required CHECK (
    status <> 'declined'
    OR NULLIF(btrim(COALESCE(decline_reason, '')), '') IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_delegations_one_pending
  ON task_delegations(task_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_task_delegations_task_status
  ON task_delegations(task_id, status);

CREATE INDEX IF NOT EXISTS idx_task_delegations_to_status
  ON task_delegations(delegated_to, status, delegated_at);

CREATE INDEX IF NOT EXISTS idx_task_delegations_by_status
  ON task_delegations(delegated_by, status, delegated_at);

ALTER TABLE task_delegations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_delegations_select_involved" ON task_delegations;
CREATE POLICY "task_delegations_select_involved" ON task_delegations
  FOR SELECT TO authenticated
  USING (
    delegated_by = auth.uid()
    OR delegated_from = auth.uid()
    OR delegated_to = auth.uid()
    OR public.is_director()
  );

COMMENT ON TABLE task_delegations IS 'Pending and historical task delegation requests between department heads and members.';
