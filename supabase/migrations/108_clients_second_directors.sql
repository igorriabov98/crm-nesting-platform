ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS second_director_name_en text,
  ADD COLUMN IF NOT EXISTS second_director_name_ua text;
