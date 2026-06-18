ALTER TABLE public.clients
  DROP COLUMN IF EXISTS delivery_address,
  DROP COLUMN IF EXISTS second_director_name,
  DROP COLUMN IF EXISTS second_director_name_en,
  DROP COLUMN IF EXISTS second_director_name_ua,
  DROP COLUMN IF EXISTS vat_number;

ALTER TABLE public.company_settings
  DROP COLUMN IF EXISTS address_ua;
