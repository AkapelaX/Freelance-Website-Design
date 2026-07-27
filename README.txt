BLUVIXA 9.0 — SUPABASE MEDIA CLOUD

Built from the confirmed-working Bluvixa 8.0 workspace.

WHAT V9.0 ADDS
- Photos and videos selected from a phone upload directly to Supabase Storage.
- Files are stored in the private website-assets bucket under:
  user-id / project-id / unique-file-name
- Project JSON stores a signed cloud URL instead of the full Base64 file.
- Existing Base64 images/videos are automatically migrated during the next cloud save.
- Images are limited to 25 MB and videos to 100 MB in the frontend.
- Autosave waits for cloud media and then stores the updated project.
- Owner-only Storage RLS prevents customers from reading or changing one another's files.

INSTALLATION
1. Run SUPABASE-9.0-MEDIA-STORAGE.sql in Supabase SQL Editor once.
2. Replace index.html, style.css, app.js, and platform.js in the Vercel project.
3. Keep the existing api folder and all existing environment variables.
4. Redeploy.

TEST
1. Sign in and open a website.
2. Choose a photo from the phone.
3. Wait for “Image uploaded to cloud.”
4. Wait for “All changes saved to cloud.”
5. Refresh and reopen the website.
6. Confirm the image remains.
7. In Supabase Storage, open website-assets and verify the user/project folders.

NOTE
The bucket remains private. V9.0 creates long-lived signed URLs so previews and saved projects can display media. A later publishing service can create fresh URLs or copy published assets to a public delivery bucket/CDN.
