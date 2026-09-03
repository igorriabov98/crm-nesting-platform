-- Immutable invoice issuance, client ownership, scoped payment access, and
-- an auditable payment ledger. Browser clients never mutate ledger rows.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS responsible_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimated_delivery_days integer NOT NULL DEFAULT 7;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_estimated_delivery_days_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_estimated_delivery_days_check
  CHECK (estimated_delivery_days BETWEEN 0 AND 365);

CREATE INDEX IF NOT EXISTS idx_clients_responsible_user
  ON public.clients(responsible_user_id);

-- Ownership is a security boundary. Authenticated browser writes can create a
-- company only for themselves (sales managers) and can never reassign it;
-- director/admin reassignment goes through the checked service-role action.
CREATE OR REPLACE FUNCTION public.protect_client_responsible_user()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      IF public.get_user_role() = 'sales_manager'::public.user_role THEN
        NEW.responsible_user_id := auth.uid();
      ELSE
        NEW.responsible_user_id := NULL;
      END IF;
    ELSIF NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id THEN
      RAISE EXCEPTION 'Client responsible manager can be changed only through the protected server action';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_client_responsible_user ON public.clients;
CREATE TRIGGER trg_protect_client_responsible_user
BEFORE INSERT OR UPDATE OF responsible_user_id ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.protect_client_responsible_user();

-- Assign historical clients to the active sales manager who created their
-- latest machine. Ambiguous/no-manager clients deliberately remain unassigned.
UPDATE public.clients client
SET responsible_user_id = (
  SELECT machine.created_by
  FROM public.machines machine
  JOIN public.users manager ON manager.id = machine.created_by
  WHERE machine.client_id = client.id
    AND manager.role = 'sales_manager'::public.user_role
    AND manager.is_active IS DISTINCT FROM false
  ORDER BY machine.created_at DESC NULLS LAST, machine.id DESC
  LIMIT 1
)
WHERE client.responsible_user_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.machines machine
    JOIN public.users manager ON manager.id = machine.created_by
    WHERE machine.client_id = client.id
      AND manager.role = 'sales_manager'::public.user_role
      AND manager.is_active IS DISTINCT FROM false
  );

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS invoice_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_terms_type_snapshot public.payment_terms_type,
  ADD COLUMN IF NOT EXISTS payment_due_days_snapshot integer,
  ADD COLUMN IF NOT EXISTS prepayment_percent_snapshot numeric(5,2),
  ADD COLUMN IF NOT EXISTS final_payment_due_days_snapshot integer,
  ADD COLUMN IF NOT EXISTS estimated_delivery_days_snapshot integer,
  ADD COLUMN IF NOT EXISTS document_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

UPDATE public.invoices invoice
SET
  invoice_number = COALESCE(
    NULLIF(BTRIM(machine.specification_number), ''),
    NULLIF(BTRIM(machine.name), ''),
    LEFT(invoice.id::text, 8)
  ),
  payment_terms_type_snapshot = COALESCE(invoice.payment_terms_type_snapshot, machine.payment_terms_type),
  payment_due_days_snapshot = COALESCE(invoice.payment_due_days_snapshot, machine.payment_due_days, 0),
  prepayment_percent_snapshot = COALESCE(invoice.prepayment_percent_snapshot, machine.prepayment_percent),
  final_payment_due_days_snapshot = COALESCE(
    invoice.final_payment_due_days_snapshot,
    machine.final_payment_due_days,
    machine.payment_due_days,
    0
  ),
  estimated_delivery_days_snapshot = COALESCE(
    invoice.estimated_delivery_days_snapshot,
    client.estimated_delivery_days,
    7
  )
FROM public.machines machine
LEFT JOIN public.clients client ON client.id = machine.client_id
WHERE machine.id = invoice.machine_id;

ALTER TABLE public.invoices
  ALTER COLUMN invoice_number SET NOT NULL,
  ALTER COLUMN payment_terms_type_snapshot SET DEFAULT 'invoice_days'::public.payment_terms_type,
  ALTER COLUMN payment_due_days_snapshot SET DEFAULT 14,
  ALTER COLUMN estimated_delivery_days_snapshot SET DEFAULT 7;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_invoice_revision_check,
  DROP CONSTRAINT IF EXISTS invoices_payment_due_days_snapshot_check,
  DROP CONSTRAINT IF EXISTS invoices_final_payment_due_days_snapshot_check,
  DROP CONSTRAINT IF EXISTS invoices_estimated_delivery_days_snapshot_check,
  DROP CONSTRAINT IF EXISTS invoices_prepayment_percent_snapshot_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_revision_check CHECK (invoice_revision >= 0),
  ADD CONSTRAINT invoices_payment_due_days_snapshot_check
    CHECK (payment_due_days_snapshot IS NULL OR payment_due_days_snapshot >= 0),
  ADD CONSTRAINT invoices_final_payment_due_days_snapshot_check
    CHECK (final_payment_due_days_snapshot IS NULL OR final_payment_due_days_snapshot >= 0),
  ADD CONSTRAINT invoices_estimated_delivery_days_snapshot_check
    CHECK (estimated_delivery_days_snapshot IS NULL OR estimated_delivery_days_snapshot BETWEEN 0 AND 365),
  ADD CONSTRAINT invoices_prepayment_percent_snapshot_check
    CHECK (prepayment_percent_snapshot IS NULL OR prepayment_percent_snapshot BETWEEN 0 AND 100);

-- Overdue is a date-derived presentation state. Payment status is maintained
-- only from the active payment ledger.
DROP TRIGGER IF EXISTS trg_check_invoice_overdue ON public.invoices;
DROP FUNCTION IF EXISTS public.check_invoice_overdue();
DROP POLICY IF EXISTS "Invoices - Update status" ON public.invoices;

CREATE OR REPLACE FUNCTION public.check_daily_finance_overdue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.finance_expenses
  SET status = 'overdue'
  WHERE status IN ('planned', 'partially_paid')
    AND CURRENT_DATE > planned_date;
END;
$$;

UPDATE public.invoices
SET status = CASE
  WHEN COALESCE(paid_amount, 0) >= amount AND amount > 0 THEN 'paid'::public.invoice_status
  WHEN COALESCE(paid_amount, 0) > 0 THEN 'partially_paid'::public.invoice_status
  ELSE 'not_paid'::public.invoice_status
END
WHERE status <> 'cancelled'::public.invoice_status;

UPDATE public.invoices
SET status = 'not_paid'::public.invoice_status
WHERE status IS NULL;

ALTER TABLE public.invoices
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_machine_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_active_per_machine
  ON public.invoices(machine_id)
  WHERE status <> 'cancelled'::public.invoice_status;

CREATE INDEX IF NOT EXISTS idx_invoices_machine_revision
  ON public.invoices(machine_id, invoice_revision DESC);

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_on date,
  note text,
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'legacy')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  void_reason text,
  replacement_payment_id uuid REFERENCES public.invoice_payments(id) ON DELETE SET NULL,
  CONSTRAINT invoice_payments_date_required
    CHECK (source = 'legacy' OR paid_on IS NOT NULL),
  CONSTRAINT invoice_payments_void_complete
    CHECK (
      (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
      OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND NULLIF(BTRIM(void_reason), '') IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_active
  ON public.invoice_payments(invoice_id, paid_on, created_at)
  WHERE voided_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payments_one_legacy
  ON public.invoice_payments(invoice_id)
  WHERE source = 'legacy';

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_payments_service_role_all ON public.invoice_payments;
CREATE POLICY invoice_payments_service_role_all ON public.invoice_payments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.invoice_payments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.invoice_payments TO service_role;

INSERT INTO public.invoice_payments(invoice_id, amount, paid_on, note, source, created_by, created_at)
SELECT
  invoice.id,
  LEAST(COALESCE(invoice.amount, invoice.paid_amount), invoice.paid_amount),
  invoice.actual_paid_date,
  COALESCE(invoice.payment_note, 'Перенесено из общей суммы оплаты'),
  'legacy',
  invoice.updated_by,
  invoice.created_at
FROM public.invoices invoice
WHERE COALESCE(invoice.paid_amount, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.invoice_payments payment
    WHERE payment.invoice_id = invoice.id AND payment.source = 'legacy'
  );

CREATE TABLE IF NOT EXISTS public.invoice_terms_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  old_terms jsonb NOT NULL,
  new_terms jsonb NOT NULL,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_terms_audit_invoice
  ON public.invoice_terms_audit(invoice_id, changed_at DESC);

ALTER TABLE public.invoice_terms_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_terms_audit_service_role_all ON public.invoice_terms_audit;
CREATE POLICY invoice_terms_audit_service_role_all ON public.invoice_terms_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.invoice_terms_audit FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.invoice_terms_audit TO service_role;

CREATE OR REPLACE FUNCTION public.fn_sync_invoice_payment_totals(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  invoice_row public.invoices%ROWTYPE;
  machine_row public.machines%ROWTYPE;
  paid_total numeric(14,2);
  completed_on date;
  exact_due_date date;
BEGIN
  SELECT * INTO invoice_row
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO machine_row
  FROM public.machines
  WHERE id = invoice_row.machine_id;

  SELECT COALESCE(SUM(amount), 0), MAX(paid_on)
  INTO paid_total, completed_on
  FROM public.invoice_payments
  WHERE invoice_id = p_invoice_id
    AND voided_at IS NULL;

  IF paid_total > invoice_row.amount THEN
    RAISE EXCEPTION 'Payment total exceeds invoice amount';
  END IF;

  exact_due_date := NULL;
  IF invoice_row.payment_terms_type_snapshot = 'invoice_days'::public.payment_terms_type THEN
    exact_due_date := invoice_row.invoice_date + COALESCE(invoice_row.payment_due_days_snapshot, 0);
  ELSIF invoice_row.payment_terms_type_snapshot = 'delivery_days'::public.payment_terms_type
    AND machine_row.delivery_to_client_date IS NOT NULL THEN
    exact_due_date := machine_row.delivery_to_client_date + COALESCE(invoice_row.payment_due_days_snapshot, 0);
  ELSIF invoice_row.payment_terms_type_snapshot = 'prepayment_full'::public.payment_terms_type THEN
    IF paid_total < ROUND(invoice_row.amount * COALESCE(invoice_row.prepayment_percent_snapshot, 50) / 100, 2) THEN
      exact_due_date := invoice_row.invoice_date + COALESCE(invoice_row.payment_due_days_snapshot, 0);
    ELSIF machine_row.delivery_to_client_date IS NOT NULL THEN
      exact_due_date := machine_row.delivery_to_client_date + COALESCE(
        invoice_row.final_payment_due_days_snapshot,
        invoice_row.payment_due_days_snapshot,
        0
      );
    END IF;
  END IF;

  UPDATE public.invoices
  SET
    paid_amount = paid_total,
    actual_paid_date = CASE WHEN paid_total > 0 THEN completed_on ELSE NULL END,
    payment_date = exact_due_date,
    due_date = exact_due_date,
    original_planned_date = exact_due_date,
    status = CASE
      WHEN status = 'cancelled'::public.invoice_status THEN status
      WHEN paid_total >= amount AND amount > 0 THEN 'paid'::public.invoice_status
      WHEN paid_total > 0 THEN 'partially_paid'::public.invoice_status
      ELSE 'not_paid'::public.invoice_status
    END,
    updated_at = now()
  WHERE id = p_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_invoice_payment_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.fn_sync_invoice_payment_totals(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_payments_sync ON public.invoice_payments;
CREATE TRIGGER trg_invoice_payments_sync
AFTER INSERT OR UPDATE OF amount, paid_on, voided_at, voided_by, void_reason
ON public.invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_invoice_payment_totals();

CREATE OR REPLACE FUNCTION public.trg_refresh_invoice_due_date_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  invoice_id uuid;
BEGIN
  IF NEW.delivery_to_client_date IS DISTINCT FROM OLD.delivery_to_client_date THEN
    FOR invoice_id IN
      SELECT id
      FROM public.invoices
      WHERE machine_id = NEW.id
        AND status <> 'cancelled'::public.invoice_status
    LOOP
      PERFORM public.fn_sync_invoice_payment_totals(invoice_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_invoice_due_date_on_delivery ON public.machines;
CREATE TRIGGER trg_refresh_invoice_due_date_on_delivery
AFTER UPDATE OF delivery_to_client_date ON public.machines
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_invoice_due_date_on_delivery();

DO $$
DECLARE
  invoice_id uuid;
BEGIN
  FOR invoice_id IN SELECT id FROM public.invoices LOOP
    PERFORM public.fn_sync_invoice_payment_totals(invoice_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_note text,
  p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  invoice_row public.invoices%ROWTYPE;
  current_total numeric(14,2);
  payment_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;
  IF p_paid_on IS NULL OR p_paid_on > CURRENT_DATE THEN
    RAISE EXCEPTION 'Payment date must not be in the future';
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor) THEN
    RAISE EXCEPTION 'Payment actor is invalid';
  END IF;

  SELECT * INTO invoice_row
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF invoice_row.status = 'cancelled'::public.invoice_status THEN
    RAISE EXCEPTION 'Cancelled invoice cannot receive payments';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO current_total
  FROM public.invoice_payments
  WHERE invoice_id = p_invoice_id AND voided_at IS NULL;

  IF current_total + p_amount > invoice_row.amount THEN
    RAISE EXCEPTION 'Payment exceeds invoice balance';
  END IF;

  INSERT INTO public.invoice_payments(invoice_id, amount, paid_on, note, created_by)
  VALUES (p_invoice_id, ROUND(p_amount, 2), p_paid_on, NULLIF(BTRIM(p_note), ''), p_actor)
  RETURNING id INTO payment_id;

  RETURN payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_correct_invoice_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_note text,
  p_reason text,
  p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  payment_row public.invoice_payments%ROWTYPE;
  invoice_row public.invoices%ROWTYPE;
  other_total numeric(14,2);
  replacement_id uuid;
BEGIN
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Correction reason is required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;
  IF p_paid_on IS NULL OR p_paid_on > CURRENT_DATE THEN
    RAISE EXCEPTION 'Payment date must not be in the future';
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor) THEN
    RAISE EXCEPTION 'Payment actor is invalid';
  END IF;

  SELECT * INTO payment_row
  FROM public.invoice_payments
  WHERE id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND OR payment_row.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Active payment not found';
  END IF;

  SELECT * INTO invoice_row
  FROM public.invoices
  WHERE id = payment_row.invoice_id
  FOR UPDATE;
  IF invoice_row.status = 'cancelled'::public.invoice_status THEN
    RAISE EXCEPTION 'Cancelled invoice payment cannot be corrected';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO other_total
  FROM public.invoice_payments
  WHERE invoice_id = payment_row.invoice_id
    AND voided_at IS NULL
    AND id <> payment_row.id;

  IF other_total + p_amount > invoice_row.amount THEN
    RAISE EXCEPTION 'Corrected payment exceeds invoice balance';
  END IF;

  UPDATE public.invoice_payments
  SET
    voided_at = now(),
    voided_by = p_actor,
    void_reason = BTRIM(p_reason)
  WHERE id = payment_row.id;

  INSERT INTO public.invoice_payments(invoice_id, amount, paid_on, note, created_by)
  VALUES (payment_row.invoice_id, ROUND(p_amount, 2), p_paid_on, NULLIF(BTRIM(p_note), ''), p_actor)
  RETURNING id INTO replacement_id;

  UPDATE public.invoice_payments
  SET replacement_payment_id = replacement_id
  WHERE id = payment_row.id;

  RETURN replacement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cancel_invoice(
  p_invoice_id uuid,
  p_reason text,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  invoice_row public.invoices%ROWTYPE;
BEGIN
  IF NULLIF(BTRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Cancellation reason is required';
  END IF;
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor) THEN
    RAISE EXCEPTION 'Cancellation actor is invalid';
  END IF;

  SELECT * INTO invoice_row
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF invoice_row.status = 'cancelled'::public.invoice_status THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoice_payments
    WHERE invoice_id = p_invoice_id AND voided_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Invoice with payments cannot be cancelled';
  END IF;

  UPDATE public.invoices
  SET
    status = 'cancelled'::public.invoice_status,
    cancelled_at = now(),
    cancelled_by = p_actor,
    cancellation_reason = BTRIM(p_reason),
    updated_at = now()
  WHERE id = p_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_invoice_payment_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_refresh_invoice_due_date_on_delivery() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_record_invoice_payment(uuid, numeric, date, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_correct_invoice_payment(uuid, numeric, date, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_cancel_invoice(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_invoice_payment_totals(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_refresh_invoice_due_date_on_delivery() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_invoice_payment(uuid, numeric, date, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_correct_invoice_payment(uuid, numeric, date, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_cancel_invoice(uuid, text, uuid) TO service_role;

-- Company coverage is independent for viewing and managing the two financial
-- resources. Other resources are constrained to the safe "own" default.
ALTER TABLE public.department_access_permissions
  ADD COLUMN IF NOT EXISTS company_view_scope text NOT NULL DEFAULT 'own',
  ADD COLUMN IF NOT EXISTS company_manage_scope text NOT NULL DEFAULT 'own';

ALTER TABLE public.department_access_permissions
  DROP CONSTRAINT IF EXISTS department_access_permissions_company_view_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_permissions_company_manage_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_permissions_company_manage_within_view_check;

ALTER TABLE public.department_access_permissions
  ADD CONSTRAINT department_access_permissions_company_view_scope_check
    CHECK (company_view_scope IN ('own', 'all') AND (company_view_scope = 'own' OR resource_key IN ('invoices', 'client_payments'))),
  ADD CONSTRAINT department_access_permissions_company_manage_scope_check
    CHECK (company_manage_scope IN ('own', 'all') AND (company_manage_scope = 'own' OR resource_key IN ('invoices', 'client_payments'))),
  ADD CONSTRAINT department_access_permissions_company_manage_within_view_check
    CHECK (company_manage_scope = 'own' OR company_view_scope = 'all');

ALTER TABLE public.department_access_audit_log
  ADD COLUMN IF NOT EXISTS old_company_view_scope text,
  ADD COLUMN IF NOT EXISTS new_company_view_scope text NOT NULL DEFAULT 'own',
  ADD COLUMN IF NOT EXISTS old_company_manage_scope text,
  ADD COLUMN IF NOT EXISTS new_company_manage_scope text NOT NULL DEFAULT 'own';

ALTER TABLE public.department_access_audit_log
  DROP CONSTRAINT IF EXISTS department_access_audit_log_old_company_view_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_audit_log_new_company_view_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_audit_log_old_company_manage_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_audit_log_new_company_manage_scope_check;

ALTER TABLE public.department_access_audit_log
  ADD CONSTRAINT department_access_audit_log_old_company_view_scope_check
    CHECK (old_company_view_scope IS NULL OR old_company_view_scope IN ('own', 'all')),
  ADD CONSTRAINT department_access_audit_log_new_company_view_scope_check
    CHECK (new_company_view_scope IN ('own', 'all')),
  ADD CONSTRAINT department_access_audit_log_old_company_manage_scope_check
    CHECK (old_company_manage_scope IS NULL OR old_company_manage_scope IN ('own', 'all')),
  ADD CONSTRAINT department_access_audit_log_new_company_manage_scope_check
    CHECK (new_company_manage_scope IN ('own', 'all'));

INSERT INTO public.role_permissions(role, resource_key, can_view, can_manage)
SELECT role, 'client_payments', true, true
FROM unnest(ARRAY[
  'sales_manager'::public.user_role,
  'financial_director'::public.user_role,
  'commercial_director'::public.user_role,
  'planning_director'::public.user_role
]) role
ON CONFLICT (role, resource_key) DO UPDATE
SET can_view = EXCLUDED.can_view, can_manage = EXCLUDED.can_manage;

INSERT INTO public.role_permissions(role, resource_key, can_view, can_manage)
SELECT role, 'invoices', true, true
FROM unnest(ARRAY[
  'sales_manager'::public.user_role,
  'financial_director'::public.user_role,
  'commercial_director'::public.user_role,
  'planning_director'::public.user_role
]) role
ON CONFLICT (role, resource_key) DO UPDATE
SET can_view = EXCLUDED.can_view, can_manage = EXCLUDED.can_manage;

WITH department_roles AS (
  SELECT
    member.department_id,
    CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END AS subject_scope,
    BOOL_OR(user_profile.role IN (
      'financial_director'::public.user_role,
      'commercial_director'::public.user_role,
      'planning_director'::public.user_role
    )) AS has_director,
    BOOL_OR(user_profile.role IN (
      'sales_manager'::public.user_role,
      'financial_director'::public.user_role,
      'commercial_director'::public.user_role,
      'planning_director'::public.user_role
    )) AS has_payment_access
  FROM public.department_members member
  JOIN public.users user_profile ON user_profile.id = member.user_id
  GROUP BY member.department_id, CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
)
INSERT INTO public.department_access_permissions(
  department_id, subject_scope, resource_key, can_view, can_manage,
  company_view_scope, company_manage_scope
)
SELECT
  department_id,
  subject_scope,
  'client_payments',
  has_payment_access,
  has_payment_access,
  CASE WHEN has_director THEN 'all' ELSE 'own' END,
  CASE WHEN has_director THEN 'all' ELSE 'own' END
FROM department_roles
WHERE has_payment_access
ON CONFLICT (department_id, subject_scope, resource_key) DO UPDATE
SET
  can_view = EXCLUDED.can_view,
  can_manage = EXCLUDED.can_manage,
  company_view_scope = EXCLUDED.company_view_scope,
  company_manage_scope = EXCLUDED.company_manage_scope,
  updated_at = now();

WITH director_scopes AS (
  SELECT DISTINCT
    member.department_id,
    CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END AS subject_scope
  FROM public.department_members member
  JOIN public.users user_profile ON user_profile.id = member.user_id
  WHERE user_profile.role IN (
    'financial_director'::public.user_role,
    'commercial_director'::public.user_role,
    'planning_director'::public.user_role
  )
)
UPDATE public.department_access_permissions permission
SET company_view_scope = 'all', company_manage_scope = 'all'
FROM director_scopes director
WHERE permission.department_id = director.department_id
  AND permission.subject_scope = director.subject_scope
  AND permission.resource_key = 'invoices';

-- Existing summary consumers keep working while cancelled invoices disappear
-- from receivables and cached paid_amount stays synchronized with the ledger.
DROP VIEW IF EXISTS public.client_list_summary;
CREATE VIEW public.client_list_summary
WITH (security_invoker = true)
AS
SELECT
  client.id,
  client.name,
  client.primary_contact_name,
  client.phone,
  client.email,
  client.country_city,
  client.payment_terms_type,
  client.payment_due_days,
  client.prepayment_percent,
  client.final_payment_due_days,
  client.responsible_user_id,
  client.estimated_delivery_days,
  COALESCE(machine_summary.active_machines_count, 0)::integer AS active_machines_count,
  COALESCE(invoice_summary.current_invoice_amount, 0)::numeric AS current_invoice_amount,
  COALESCE(invoice_summary.overdue_invoice_amount, 0)::numeric AS overdue_invoice_amount,
  GREATEST(client.updated_at, COALESCE(machine_summary.last_machine_activity, client.updated_at)) AS last_activity,
  client.updated_at
FROM public.clients client
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(machine.is_archived, false) = false)::integer AS active_machines_count,
    MAX(machine.updated_at) AS last_machine_activity
  FROM public.machines machine
  WHERE machine.client_id = client.id
) machine_summary ON true
LEFT JOIN LATERAL (
  SELECT
    SUM(GREATEST(COALESCE(invoice.amount, 0) - COALESCE(invoice.paid_amount, 0), 0)) AS current_invoice_amount,
    SUM(GREATEST(COALESCE(invoice.amount, 0) - COALESCE(invoice.paid_amount, 0), 0)) FILTER (
      WHERE COALESCE(invoice.due_date, invoice.payment_date) IS NOT NULL
        AND COALESCE(invoice.due_date, invoice.payment_date) < CURRENT_DATE
    ) AS overdue_invoice_amount
  FROM public.machines machine
  JOIN public.invoices invoice ON invoice.machine_id = machine.id
  WHERE machine.client_id = client.id
    AND invoice.status <> 'cancelled'::public.invoice_status
    AND invoice.status <> 'paid'::public.invoice_status
) invoice_summary ON true;

COMMENT ON COLUMN public.clients.responsible_user_id IS
  'Single sales manager responsible for the client and own-company financial access.';
COMMENT ON COLUMN public.clients.estimated_delivery_days IS
  'Calendar-day delivery estimate used only for forecast payment dates.';
COMMENT ON COLUMN public.invoices.document_snapshot IS
  'Immutable invoice PDF input captured at issuance; legacy rows are populated lazily.';
COMMENT ON TABLE public.invoice_payments IS
  'Auditable EUR payment ledger. Active rows are never physically deleted.';
