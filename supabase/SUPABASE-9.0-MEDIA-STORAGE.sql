-- BLUVIXA 9.0 — SUPABASE MEDIA STORAGE
-- Run once in Supabase SQL Editor. Safe to run again.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'website-assets',
  'website-assets',
  false,
  104857600,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant usage on schema storage to authenticated;
grant select, insert, update, delete on table storage.objects to authenticated;

drop policy if exists "Bluvixa users read own website assets" on storage.objects;
create policy "Bluvixa users read own website assets"
on storage.objects for select to authenticated
using (
  bucket_id = 'website-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Bluvixa users upload own website assets" on storage.objects;
create policy "Bluvixa users upload own website assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'website-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Bluvixa users update own website assets" on storage.objects;
create policy "Bluvixa users update own website assets"
on storage.objects for update to authenticated
using (
  bucket_id = 'website-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'website-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Bluvixa users delete own website assets" on storage.objects;
create policy "Bluvixa users delete own website assets"
on storage.objects for delete to authenticated
using (
  bucket_id = 'website-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);
