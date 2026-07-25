DO $$
BEGIN
  CREATE TYPE public.outsourcing_responsible AS ENUM ('production', 'supply');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.machine_outsourcing_operations
  ADD COLUMN IF NOT EXISTS responsible public.outsourcing_responsible NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS supply_taken_at timestamptz,
  ADD COLUMN IF NOT EXISTS supply_taken_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.machine_outsourcing_operations
  DROP CONSTRAINT IF EXISTS machine_outsourcing_executor_target_check;

ALTER TABLE public.machine_outsourcing_operations
  ADD CONSTRAINT machine_outsourcing_executor_target_check CHECK (
    (
      executor_type = 'supplier'
      AND executor_factory_id IS NULL
      AND (
        (responsible = 'production' AND supplier_id IS NOT NULL)
        OR responsible = 'supply'
      )
    )
    OR
    (
      executor_type = 'factory'
      AND executor_factory_id IS NOT NULL
      AND supplier_id IS NULL
      AND responsible = 'production'
    )
  );

CREATE INDEX IF NOT EXISTS idx_machine_outsourcing_supply_requests
  ON public.machine_outsourcing_operations(supply_terms_confirmed_at, supply_taken_at, created_at DESC)
  WHERE executor_type = 'supplier'
    AND responsible = 'supply'
    AND archived_at IS NULL
    AND actual_returned_at IS NULL;

COMMENT ON COLUMN public.machine_outsourcing_operations.responsible IS
  'Who selects the outsourcing company and confirms terms: production or supply.';

COMMENT ON COLUMN public.machine_outsourcing_operations.supply_taken_at IS
  'When supply accepted the outsourcing request for processing.';

COMMENT ON COLUMN public.machine_outsourcing_operations.supply_taken_by IS
  'Supply user who accepted the outsourcing request for processing.';
