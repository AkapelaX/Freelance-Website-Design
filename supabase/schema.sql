-- BLUVIXA 2.5 BACKEND STARTER SCHEMA
-- Run this entire file once in Supabase > SQL Editor.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  stripe_customer_id text unique,
  plan text check (plan in ('starter','professional','advanced')),
  subscription_status text not null default 'inactive',
  website_bought_out boolean not null default false,
  buyout_plan text,
  buyout_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references auth.users(id) on delete cascade,
  name text not null default 'My Website',
  slug text unique,
  plan text not null default 'starter' check (plan in ('starter','professional','advanced')),
  project_data jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  published_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  bucket text not null default 'website-media',
  storage_path text not null,
  media_type text not null check (media_type in ('image','video','file')),
  created_at timestamptz not null default now()
);

create table if not exists public.website_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  storage_path text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.media_assets enable row level security;
alter table public.website_exports enable row level security;

drop policy if exists "profiles own select" on public.profiles;
drop policy if exists "profiles own update" on public.profiles;
drop policy if exists "projects own all" on public.projects;
drop policy if exists "media own all" on public.media_assets;
drop policy if exists "exports own select" on public.website_exports;

create policy "profiles own select" on public.profiles for select using (auth.uid() = id);
create policy "profiles own update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "projects own all" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "media own all" on public.media_assets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exports own select" on public.website_exports for select using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,email,full_name)
  values(new.id,new.email,new.raw_user_meta_data->>'full_name')
  on conflict(id) do update set email=excluded.email;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
for each row execute procedure public.set_updated_at();

-- Storage bucket for later media-upload integration.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('website-media','website-media',false,104857600,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do nothing;

drop policy if exists "users upload own website media" on storage.objects;
drop policy if exists "users read own website media" on storage.objects;
drop policy if exists "users update own website media" on storage.objects;
drop policy if exists "users delete own website media" on storage.objects;

create policy "users upload own website media" on storage.objects for insert to authenticated
with check (bucket_id='website-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "users read own website media" on storage.objects for select to authenticated
using (bucket_id='website-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "users update own website media" on storage.objects for update to authenticated
using (bucket_id='website-media' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='website-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "users delete own website media" on storage.objects for delete to authenticated
using (bucket_id='website-media' and (storage.foldername(name))[1]=auth.uid()::text);
