DROP INDEX IF EXISTS idx_tech_request_machine;

CREATE INDEX IF NOT EXISTS idx_tech_request_machine_created_at
  ON public.technologist_requests(machine_id, created_at DESC);
