CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_product_version_incomplete_active_unique
  ON public.tasks(product_version_id, assigned_to)
  WHERE task_type = 'product_version_incomplete'
    AND status IN ('pending', 'in_progress')
    AND product_version_id IS NOT NULL
    AND assigned_to IS NOT NULL;
