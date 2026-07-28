# Bluvixa Domain Management — Full Combined Package

This package enables both publishing methods supported by Bluvixa:

* **Bluvixa Hosted URL**

  * `https://bluvixa.com/site/your-business`
* **Customer-Owned Custom Domain**

  * `https://yourbusiness.com`

Both publishing methods use the same project and publishing system.

---

# Package Contents

* Full replacement `index.html`
* Full replacement `style.css`
* `domain-manager.js`
* `api/domain.js` (single domain API)
* `lib/domain-utils.js` (shared helper)
* SQL migration for the existing `projects` table
* Installation guide

---

# Before Installing

Back up the current production repository.

Remove any legacy domain-management endpoints that are still present:

```
api/connect-domain.js
api/check-domain.js
api/remove-domain.js
api/domain-status.js
api/domain-search.js
api/domain-utils.js
api/_lib/domain-utils.js
```

The new system replaces these with a single endpoint:

```
api/domain.js
```

---

# Existing Files That Must Remain

This package is designed to work with the existing Bluvixa platform.

Do **not** remove:

* `app.js`
* `platform.js`
* Supabase browser library
* Existing assets
* Favicon files
* Existing authentication system
* Existing publishing system
* Existing `/api/publish-site`
* Existing `/api/public-site`

The domain manager extends the current platform rather than replacing it.

---

# Required Environment Variables

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

VERCEL_TOKEN
VERCEL_PROJECT_ID
VERCEL_TEAM_ID    (only if using a Team-owned Vercel project)
```

---

# Database

This package uses the existing Bluvixa schema.

Table:

```
public.projects
```

Primary ownership column:

```
user_id
```

It does **not** create or require:

* `website_projects`
* `owner_id`

---

# Supported Publishing

After installation, every project can be published in one of two ways:

### Bluvixa URL

```
https://bluvixa.com/site/your-business
```

### Custom Domain

```
https://yourbusiness.com
```

The publishing system automatically serves the same website regardless of which address the visitor uses.

---

# Compatibility

This package is intended to work alongside:

* Existing authentication
* Existing Stripe subscriptions
* Existing project storage
* Existing autosave
* Existing publish/unpublish workflow
* Existing `/api/public-site` renderer

No customer websites should require rebuilding after installation.

---

# Installation Notes

1. Back up the repository.
2. Remove the obsolete domain API files listed above.
3. Add the new package files.
4. Run the SQL migration.
5. Configure the required environment variables.
6. Redeploy the project.
7. Test using a spare domain before connecting customer domains.

---

# Important

* Never remove customer MX records used for email.
* Verify DNS propagation before marking a custom domain as connected.
* Test both Bluvixa-hosted URLs and custom domains after deployment.
* Confirm that publishing, unpublishing, and SSL provisioning function correctly before customer use.

---

# Architecture

This package is designed to integrate with the current Bluvixa platform and does **not** replace the existing publishing or website-rendering system. It provides a unified domain-management layer while preserving compatibility with the current frontend, backend, and database architecture.
