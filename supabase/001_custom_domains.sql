-- Bluvixa custom-domain migration
-- Run once in Supabase SQL Editor.

begin;

alter table public.website_projects
  add column if not exists custom_domain text,
  add column if not exists domain_status text not null default 'not_connected',
  add column if not exists ssl_status text not null default 'waiting',
  add column if not exists verified_at timestamptz,
  add column if not exists dns_verified boolean not null default false,
  add column if not exists domain_last_checked_at timestamptz,
  add column if not exists domain_error text,
  add column if not exists dns_records jsonb not null default '[]'::jsonb,
  add column if not exists verification_record jsonb;

alter table public.website_projects
  drop constraint if exists website_projects_domain_status_check;

alter table public.website_projects
  add constraint website_projects_domain_status_check
  check (domain_status in ('not_connected', 'verifying', 'connected', 'failed', 'removing'));

alter table public.website_projects
  drop constraint if exists website_projects_ssl_status_check;

alter table public.website_projects
  add constraint website_projects_ssl_status_check
  check (ssl_status in ('waiting', 'provisioning', 'active', 'failed'));

create unique index if not exists website_projects_custom_domain_unique
  on public.website_projects (lower(custom_domain))
  where custom_domain is not null;

create index if not exists website_projects_domain_status_idx
  on public.website_projects (domain_status);

-- Keep direct browser access limited to the project owner.
alter table public.website_projects enable row level security;

drop policy if exists "Users can read their own website projects" on public.website_projects;
create policy "Users can read their own website projects"
on public.website_projects for select
using (auth.uid() = user_id);

drop policy if exists "Users can update their own website projects" on public.website_projects;
create policy "Users can update their own website projects"
on public.website_projects for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
