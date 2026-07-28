begin;

-- Your actual project table is public.projects and ownership column is user_id.
-- The original starter schema made user_id UNIQUE, which limits each account
-- to one website. Remove that limit so the dashboard can support multiple sites.
alter table public.projects
  drop constraint if exists projects_user_id_key;

alter table public.projects
  add column if not exists custom_domain text,
  add column if not exists domain_status text not null default 'not_connected',
  add column if not exists ssl_status text not null default 'waiting',
  add column if not exists verified_at timestamptz,
  add column if not exists dns_verified boolean not null default false,
  add column if not exists domain_last_checked_at timestamptz,
  add column if not exists domain_error text,
  add column if not exists dns_records jsonb not null default '[]'::jsonb,
  add column if not exists verification_record jsonb;

alter table public.projects
  drop constraint if exists projects_domain_status_check;

alter table public.projects
  add constraint projects_domain_status_check
  check (domain_status in ('not_connected','verifying','connected','failed','removing'));

alter table public.projects
  drop constraint if exists projects_ssl_status_check;

alter table public.projects
  add constraint projects_ssl_status_check
  check (ssl_status in ('waiting','provisioning','active','failed'));

create unique index if not exists projects_custom_domain_unique
on public.projects (lower(custom_domain))
where custom_domain is not null;

-- The existing schema already defines slug as UNIQUE, but this index safely
-- covers installations where that constraint was removed or never created.
create unique index if not exists projects_slug_lower_unique
on public.projects (lower(slug))
where slug is not null;

alter table public.projects enable row level security;

drop policy if exists "projects own all" on public.projects;
create policy "projects own all"
on public.projects
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
