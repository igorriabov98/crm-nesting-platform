\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type AS type
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public' AND type.typname = 'user_role'
  ) THEN
    CREATE TYPE public.user_role AS ENUM (
      'financial_director', 'commercial_director', 'planning_director', 'sales_manager',
      'engineer', 'technologist', 'supply_manager', 'production_manager',
      'procurement_head', 'painting_head'
    );
  END IF;
END;
$$;

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'sales_manager';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'engineer';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'production_manager';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'painting_head';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type AS type
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public' AND type.typname = 'task_type'
  ) THEN
    CREATE TYPE public.task_type AS ENUM ('supply_start');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type AS type
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public' AND type.typname = 'task_status'
  ) THEN
    CREATE TYPE public.task_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');
  END IF;
END;
$$;

ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'supply_start';
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'in_progress';
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role public.user_role NOT NULL DEFAULT 'technologist';
ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE public.technologist_requests
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'submitted_to_supply';
ALTER TABLE public.request_knives
  ADD COLUMN IF NOT EXISTS remainder_meters numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS to_order_mm numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_status text,
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE public.supply_order_delivery_schedules
  ADD COLUMN IF NOT EXISTS change_reason text,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY,
  machine_id uuid NOT NULL REFERENCES public.machines(id),
  assigned_to uuid NOT NULL REFERENCES public.users(id),
  task_type public.task_type NOT NULL,
  title text NOT NULL,
  description text,
  status public.task_status NOT NULL DEFAULT 'pending',
  start_date date,
  deadline date NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role public.user_role NOT NULL,
  resource_key text NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_manage boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role, resource_key)
);

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION public.is_director() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

SET check_function_bodies = false;
