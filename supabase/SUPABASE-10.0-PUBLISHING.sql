-- BLUVIXA 10.0 — PUBLISHING VERIFICATION
-- No schema migration is required when these columns already exist.
-- Run safely to ensure the publishing lookup is fast.

create index if not exists website_projects_published_slug_idx
on public.website_projects (slug)
where status = 'published';

create index if not exists website_projects_published_custom_domain_idx
on public.website_projects (custom_domain)
where status = 'published' and custom_domain is not null;

-- Keep website_projects private. Public websites are served through
-- /api/public-site using the server-only SUPABASE_SERVICE_ROLE_KEY.
