CREATE TABLE IF NOT EXISTS company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en text NOT NULL DEFAULT '',
  name_ua text NOT NULL DEFAULT '',
  address_en text NOT NULL DEFAULT '',
  address_ua text NOT NULL DEFAULT '',
  director_name_en text NOT NULL DEFAULT '',
  director_name_ua text NOT NULL DEFAULT '',
  enterprise_code text NOT NULL DEFAULT '',
  iban text NOT NULL DEFAULT '',
  swift text NOT NULL DEFAULT '',
  bank_name text NOT NULL DEFAULT '',
  bank_address text NOT NULL DEFAULT '',
  intermediary_bank_name text NOT NULL DEFAULT '',
  intermediary_bank_swift text NOT NULL DEFAULT '',
  signature_image_path text,
  stamp_image_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO company_settings (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL,
  date date NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contracts_client_id_idx ON contracts(client_id);

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS director_name text,
  ADD COLUMN IF NOT EXISTS second_director_name text,
  ADD COLUMN IF NOT EXISTS vat_number text;

ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS specification_number text,
  ADD COLUMN IF NOT EXISTS specification_date date,
  ADD COLUMN IF NOT EXISTS freight_cost numeric(12,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS machines_contract_id_idx ON machines(contract_id);

ALTER TABLE machine_items
  ADD COLUMN IF NOT EXISTS net_weight numeric(10,3),
  ADD COLUMN IF NOT EXISTS packing_type text,
  ADD COLUMN IF NOT EXISTS packing_places integer;
