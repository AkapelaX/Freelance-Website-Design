-- ============================================================
-- BLUVIXA MASTER SUPABASE SCHEMA
-- Existing-system compatible + domain management
--
-- Run this entire file in Supabase > SQL Editor.
--
-- This master keeps the established Bluvixa architecture:
--   public.profiles
--   public.projects
--   public.media_assets
--   public.website_exports
--
-- Project ownership: public.projects.user_id
-- Publishing: public.projects.published boolean
-- Project content: public.projects.project_data jsonb
-- Current storage bucket: website-assets
--
-- Safe to run again.
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- SHARED updated_at FUNCTION
-- ------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- PROFILES
-- ------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  stripe_customer_id text unique,
  plan text check (
    plan in ('starter', 'professional', 'advanced')
  ),
  subscription_status text not null default 'inactive',
  website_bought_out boolean not null default false,
  buyout_plan text,
  buyout_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists stripe_customer_id text,
  add column if not exists plan text,
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists website_bought_out boolean not null default false,
  add column if not exists buyout_plan text,
  add column if not exists buyout_completed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- ------------------------------------------------------------
-- PROJECTS
-- ------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Website',
  slug text,
  plan text not null default 'starter',
  project_data jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  published_url text,
  custom_domain text,
  domain_status text not null default 'not_connected',
  ssl_status text not null default 'waiting',
  verified_at timestamptz,
  dns_verified boolean not null default false,
  domain_last_checked_at timestamptz,
  domain_error text,
  dns_records jsonb not null default '[]'::jsonb,
  verification_record jsonb,
  website_bought_out boolean not null default false,
  buyout_plan text,
  buyout_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects
  add column if not exists user_id uuid,
  add column if not exists name text not null default 'My Website',
  add column if not exists slug text,
  add column if not exists plan text not null default 'starter',
  add column if not exists project_data jsonb not null default '{}'::jsonb,
  add column if not exists published boolean not null default false,
  add column if not exists published_url text,
  add column if not exists custom_domain text,
  add column if not exists domain_status text not null default 'not_connected',
  add column if not exists ssl_status text not null default 'waiting',
  add column if not exists verified_at timestamptz,
  add column if not exists dns_verified boolean not null default false,
  add column if not exists domain_last_checked_at timestamptz,
  add column if not exists domain_error text,
  add column if not exists dns_records jsonb not null default '[]'::jsonb,
  add column if not exists verification_record jsonb,
  add column if not exists website_bought_out boolean not null default false,
  add column if not exists buyout_plan text,
  add column if not exists buyout_completed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- The starter schema originally allowed only one project per user.
-- Removing this unique constraint enables multiple websites per account.
alter table public.projects
  drop constraint if exists projects_user_id_key;

-- Preserve the correct ownership relationship when upgrading an older table.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_user_id_fkey'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_user_id_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end
$$;

-- Keep the original supported plan values.
alter table public.projects
  drop constraint if exists projects_plan_check;

alter table public.projects
  add constraint projects_plan_check
  check (
    plan in ('starter', 'professional', 'advanced')
  );

-- Domain state values used by the domain manager.
alter table public.projects
  drop constraint if exists projects_domain_status_check;

alter table public.projects
  add constraint projects_domain_status_check
  check (
    domain_status in (
      'not_connected',
      'verifying',
      'connected',
      'failed',
      'removing'
    )
  );

alter table public.projects
  drop constraint if exists projects_ssl_status_check;

alter table public.projects
  add constraint projects_ssl_status_check
  check (
    ssl_status in (
      'waiting',
      'provisioning',
      'active',
      'failed'
    )
  );

-- Normalize blank values before creating unique indexes.
update public.projects
set slug = null
where slug is not null
  and btrim(slug) = '';

update public.projects
set custom_domain = null
where custom_domain is not null
  and btrim(custom_domain) = '';

update public.projects
set domain_status = 'not_connected'
where domain_status is null
   or domain_status not in (
     'not_connected',
     'verifying',
     'connected',
     'failed',
     'removing'
   );

update public.projects
set ssl_status = 'waiting'
where ssl_status is null
   or ssl_status not in (
     'waiting',
     'provisioning',
     'active',
     'failed'
   );

-- Remove older case-sensitive slug uniqueness so the lower-case index
-- becomes the single authoritative slug rule.
alter table public.projects
  drop constraint if exists projects_slug_key;

create unique index if not exists projects_slug_lower_unique
on public.projects (lower(slug))
where slug is not null;

create unique index if not exists projects_custom_domain_lower_unique
on public.projects (lower(custom_domain))
where custom_domain is not null;

-- Fast public publishing lookups used by /api/public-site.
create index if not exists projects_published_slug_idx
on public.projects (slug)
where published = true;

create index if not exists projects_published_custom_domain_idx
on public.projects (custom_domain)
where published = true
  and custom_domain is not null;

create index if not exists projects_user_updated_idx
on public.projects (user_id, updated_at desc);

-- ------------------------------------------------------------
-- MEDIA ASSET RECORDS
-- ------------------------------------------------------------

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  bucket text not null default 'website-assets',
  storage_path text not null,
  media_type text not null check (
    media_type in ('image', 'video', 'file')
  ),
  created_at timestamptz not null default now()
);

alter table public.media_assets
  add column if not exists user_id uuid,
  add column if not exists project_id uuid,
  add column if not exists bucket text not null default 'website-assets',
  add column if not exists storage_path text,
  add column if not exists media_type text,
  add column if not exists created_at timestamptz not null default now();

alter table public.media_assets
  alter column bucket set default 'website-assets';

-- ------------------------------------------------------------
-- WEBSITE EXPORT RECORDS
-- ------------------------------------------------------------

create table if not exists public.website_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  storage_path text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table public.website_exports
  add column if not exists user_id uuid,
  add column if not exists project_id uuid,
  add column if not exists storage_path text,
  add column if not exists status text not null default 'pending',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz;

-- ------------------------------------------------------------
-- AUTH PROFILE CREATION
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name
  )
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  )
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created
on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_new_user();

-- Backfill a profile for any existing auth user that does not have one.
insert into public.profiles (
  id,
  email,
  full_name
)
select
  users.id,
  users.email,
  users.raw_user_meta_data ->> 'full_name'
from auth.users as users
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- updated_at TRIGGERS
-- ------------------------------------------------------------

drop trigger if exists profiles_set_updated_at
on public.profiles;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute procedure public.set_updated_at();

drop trigger if exists projects_set_updated_at
on public.projects;

create trigger projects_set_updated_at
before update on public.projects
for each row
execute procedure public.set_updated_at();

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.media_assets enable row level security;
alter table public.website_exports enable row level security;

drop policy if exists "profiles own select"
on public.profiles;

drop policy if exists "profiles own update"
on public.profiles;

drop policy if exists "projects own all"
on public.projects;

drop policy if exists "media own all"
on public.media_assets;

drop policy if exists "exports own select"
on public.website_exports;

drop policy if exists "exports own insert"
on public.website_exports;

create policy "profiles own select"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "profiles own update"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "projects own all"
on public.projects
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "media own all"
on public.media_assets
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "exports own select"
on public.website_exports
for select
to authenticated
using (auth.uid() = user_id);

create policy "exports own insert"
on public.website_exports
for insert
to authenticated
with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- CURRENT PRIVATE STORAGE BUCKET
-- ------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'website-assets',
  'website-assets',
  false,
  104857600,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant usage on schema storage to authenticated;
grant select, insert, update, delete
on table storage.objects
to authenticated;

drop policy if exists "Bluvixa users read own website assets"
on storage.objects;

drop policy if exists "Bluvixa users upload own website assets"
on storage.objects;

drop policy if exists "Bluvixa users update own website assets"
on storage.objects;

drop policy if exists "Bluvixa users delete own website assets"
on storage.objects;

create policy "Bluvixa users read own website assets"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'website-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Bluvixa users upload own website assets"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'website-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Bluvixa users update own website assets"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'website-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'website-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Bluvixa users delete own website assets"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'website-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;

-- ============================================================
-- FINAL LOCKED APPLICATION CONTRACT
--
-- Project table:       public.projects
-- Project owner:       user_id
-- Project state:       project_data
-- Publishing flag:     published
-- Published address:   published_url
-- Custom domain:       custom_domain
-- Asset bucket:        website-assets
--
-- The service-role API may read published projects for visitors.
-- The projects table itself remains protected by RLS.
-- ============================================================
