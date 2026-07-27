-- BLUVIXA 11.2 — PUBLISHING RELIABILITY
-- Optional server-ready table for verified publish history.

create table if not exists public.website_publish_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.website_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version_number integer not null,
  project_data jsonb not null default '{}'::jsonb,
  published_url text,
  verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(project_id, version_number)
);

create index if not exists website_publish_versions_project_idx
on public.website_publish_versions(project_id, created_at desc);

alter table public.website_publish_versions enable row level security;

drop policy if exists "Owners can read publish versions" on public.website_publish_versions;
create policy "Owners can read publish versions"
on public.website_publish_versions for select to authenticated
using (owner_id = auth.uid());

drop policy if exists "Owners can insert publish versions" on public.website_publish_versions;
create policy "Owners can insert publish versions"
on public.website_publish_versions for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists "Owners can delete publish versions" on public.website_publish_versions;
create policy "Owners can delete publish versions"
on public.website_publish_versions for delete to authenticated
using (owner_id = auth.uid());

grant select, insert, delete on public.website_publish_versions to authenticated;
