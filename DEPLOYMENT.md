# Render deployment and Google Drive setup

The user requires free hosting. No paid service, persistent Render disk, or paid database is provisioned by this repository.

Primary application: https://pipelife-video-review.onrender.com
Legacy static address (redirect): https://video-review-app-rryg.onrender.com
Supabase project: https://hxkssgllgpqcbgvqhqba.supabase.co
Drive folder: https://drive.google.com/drive/folders/1banF1xuWc3kKjLCSIu4c7x26RSYr2Uhv

## Deployment notes

This app requires a Render **web service** with the Docker runtime. A Render static site can serve the JavaScript/CSS but cannot run the Express API, authentication, persistent comments, or upload handlers. If an older static-site URL exists, redirect it to the web service after verifying the web service is healthy.

The Google API credentials are deferred by the user. Without those credentials, the workspace can start and use its persistent metadata, but Google Drive upload/import stays unavailable. Add the connection table and credentials before connecting Drive.

The source is deployed from the repository's `main` branch. Environment settings alone do not publish code changes. Follow the live verification steps below after a deployment. The core Supabase schema was verified; the `pvr_connections` table still requires `supabase/drive.sql` when enabling Google Drive later.

## Database

Run `supabase/schema.sql` in the Supabase SQL Editor. For a project that ran an earlier version of the schema, `supabase/drive.sql` adds just the encrypted OAuth connection/state table. Both scripts can be rerun safely and do not alter unrelated application tables.

The server's Supabase key must be a secret key or legacy service-role key, never a publishable/anon key. Keep it in Render Environment settings without a `VITE_` prefix. App tables have RLS and no browser-role access. Existing local SQLite data is not automatically migrated.

## Render settings

`Dockerfile` supplies Node 24, FFmpeg, the compiled frontend, and the API. `render.yaml` is a free Docker service template; it creates no database or disk. For the existing service, configure the equivalent Docker deployment and environment settings. Do not create another service or enable paid capacity automatically.

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | `https://hxkssgllgpqcbgvqhqba.supabase.co` |
| `SUPABASE_SECRET_KEY` | The server key saved securely by the user |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | A stable random value of at least 32 characters; generated automatically by the blueprint |
| `GOOGLE_DRIVE_FOLDER_ID` | `1banF1xuWc3kKjLCSIu4c7x26RSYr2Uhv` |
| `GOOGLE_CLIENT_ID` | Add later from the Google OAuth web application |
| `GOOGLE_CLIENT_SECRET` | Add later from the Google OAuth web application |

Render provides `RENDER_EXTERNAL_URL`, which the app uses for the OAuth callback. If it is unavailable, set `APP_URL` to the service's exact HTTPS origin. Keep the encryption key stable across redeploys; changing it requires restoring the old key or reconnecting Drive.

The container binds to `0.0.0.0` and Render's `PORT`. Set the health path to `/api/health`; in hosted mode it checks the database. Production refuses to start without Supabase, preventing accidental reliance on Render's ephemeral local filesystem.

On first use, enter your name and choose the workspace password. There is no owner setup code. Once the first owner is created, setup closes and subsequent visits use the workspace password.

## Google configuration — deferred until credentials are available

1. In Google Cloud Console, select/create the project and enable the **Google Drive API**.
2. Configure the OAuth consent screen. For an application in Testing mode, add the connecting Google account as a test user. Google's Testing mode can expire refresh grants after seven days; reconnecting then requires another consent flow.
3. Create OAuth credentials of type **Web application**. Add this exact authorized redirect URI:

   `https://pipelife-video-review.onrender.com/api/drive/callback`

4. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Render Environment settings. Ensure `GOOGLE_TOKEN_ENCRYPTION_KEY` is also configured. Save/redeploy.
5. Sign into the app and choose **Connect Drive**. Approve the Google consent request using an account that can add files to the selected folder.

The folder workflow requests the Google Drive scope to read existing videos and create uploads in that folder. The app limits listing/import/upload targets to `GOOGLE_DRIVE_FOLDER_ID`. OAuth state is single use, expires after ten minutes, and uses PKCE. Access/refresh tokens are encrypted in the server-only database and refreshed on the server. Review guests never receive Google credentials.

Uploads are inspected before being sent to Drive. Temporary local video/thumbnail files are removed after success. Thumbnails are retained with review metadata. New Drive files keep the folder's existing sharing policy; the app does not make them public. The server streams media to authorized team sessions or scoped review links, including byte-range requests for seeking.

Deleting a review project removes its app records and revokes its links; original videos remain in Google Drive. The app only removes a newly created Drive upload as rollback if saving that upload's review record fails.

## Live verification still required

After the source is pushed and the service is deployed with real settings:

1. Confirm `/api/health` returns `{"ok":true}`.
2. Configure the owner and create a project.
3. Connect Drive; upload a real MP4/WebM and confirm it appears in the selected folder.
4. Play and seek it, post a frame comment/hotspot/drawing, and refresh.
5. Open a review invitation in another browser without a team session; verify media, feedback, and approval.
6. Redeploy and confirm projects/comments/video access persist.
7. Revoke the link and confirm guest media access is denied. Delete a test project and confirm its Drive file is preserved.

Free service limits, Drive quotas, Google consent configuration, and available Drive storage still apply. No exact current provider capacity or price is asserted here.
