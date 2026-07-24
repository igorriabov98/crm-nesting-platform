ALTER TABLE public.machine_outsourcing_operations
  ADD COLUMN IF NOT EXISTS supply_terms_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS supply_terms_confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.machine_outsourcing_operations.supply_terms_confirmed_at IS
  'When supply confirmed the planned return date and service cost.';

COMMENT ON COLUMN public.machine_outsourcing_operations.supply_terms_confirmed_by IS
  'Supply user who last confirmed the planned return date and service cost.';
