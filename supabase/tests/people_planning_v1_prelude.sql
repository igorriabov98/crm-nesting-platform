\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TYPE public.user_role AS ENUM (
  'financial_director', 'commercial_director', 'planning_director',
  'sales_manager', 'engineer', 'technologist', 'supply_manager',
  'production_manager', 'procurement_head', 'painting_head'
);

CREATE TABLE public.factories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  role public.user_role NOT NULL,
  factory_id uuid REFERENCES public.factories(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid REFERENCES public.factories(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  production_month text,
  production_queue_number integer,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.machine_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  drawing_number text NOT NULL,
  product_name text NOT NULL,
  weight numeric NOT NULL CHECK (weight > 0),
  price numeric NOT NULL CHECK (price >= 0),
  quantity integer NOT NULL CHECK (quantity > 0)
);

CREATE TABLE public.production_fact_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.production_fact_sections(id) ON DELETE RESTRICT,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE VIEW public.machines_with_totals AS
SELECT
  m.*,
  COALESCE((
    SELECT sum(mi.weight * mi.quantity) / 1000
    FROM public.machine_items mi
    WHERE mi.machine_id = m.id
  ), 0) AS total_weight
FROM public.machines m;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.user_role
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$ SELECT role FROM public.users WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.get_user_factory_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$ SELECT factory_id FROM public.users WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.is_director()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role IN ('planning_director', 'financial_director', 'commercial_director')
  FROM public.users WHERE id = auth.uid()
$$;
