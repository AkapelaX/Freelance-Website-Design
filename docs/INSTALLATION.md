# Installation

1. Back up the existing repository.
2. Replace `index.html` and `style.css`.
3. Add `domain-manager.js`.
4. Add `api/domain.js`.
5. Add `lib/domain-utils.js`.
6. Delete the obsolete separate domain API files listed in README.
7. Run `sql/001_domains_both.sql` once in Supabase SQL Editor.
8. Add the required environment variables in Vercel.
9. Redeploy.
10. Sign in and open Domains & Publishing.
11. Select a website.
12. Test reserving a Bluvixa address.
13. Test a spare custom domain.


The included migration also removes the original UNIQUE restriction from `projects.user_id` so one account can own more than one website.
