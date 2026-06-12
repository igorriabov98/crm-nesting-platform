ALTER TABLE product_files
  DROP CONSTRAINT IF EXISTS product_files_file_kind_check,
  ADD CONSTRAINT product_files_file_kind_check
  CHECK (file_kind IN ('drawing', 'step', 'pdf', 'photo', 'other'));

ALTER TABLE product_project_files
  DROP CONSTRAINT IF EXISTS product_project_files_file_kind_check,
  ADD CONSTRAINT product_project_files_file_kind_check
  CHECK (file_kind IN ('drawing', 'step', 'pdf', 'photo', 'other'));
