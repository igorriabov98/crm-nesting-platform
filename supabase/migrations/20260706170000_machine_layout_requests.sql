ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'machine_layout';

CREATE TABLE IF NOT EXISTS public.machine_layout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  version_no integer NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'completed')),
  item_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  pdf_file_name text,
  pdf_file_path text,
  pdf_mime_type text,
  pdf_file_size bigint,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT machine_layout_requests_machine_version_unique UNIQUE (machine_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_machine_layout_requests_machine_version
  ON public.machine_layout_requests(machine_id, version_no DESC);

CREATE INDEX IF NOT EXISTS idx_machine_layout_requests_task
  ON public.machine_layout_requests(task_id)
  WHERE task_id IS NOT NULL;

ALTER TABLE public.machine_layout_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Machine layout read app roles" ON public.machine_layout_requests;
DROP POLICY IF EXISTS "Machine layout manage sales tech directors" ON public.machine_layout_requests;

CREATE POLICY "Machine layout read app roles" ON public.machine_layout_requests
  FOR SELECT TO authenticated USING (public.security_has_role(ARRAY[
    'planning_director',
    'financial_director',
    'commercial_director',
    'sales_manager',
    'engineer',
    'technologist',
    'supply_manager',
    'production_manager',
    'procurement_head',
    'painting_head'
  ]));

CREATE POLICY "Machine layout manage sales tech directors" ON public.machine_layout_requests
  FOR ALL TO authenticated USING (
    public.security_has_role(ARRAY[
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager',
      'technologist'
    ])
  )
  WITH CHECK (
    public.security_has_role(ARRAY[
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager',
      'technologist'
    ])
  );

SELECT pg_notify('pgrst', 'reload schema');
