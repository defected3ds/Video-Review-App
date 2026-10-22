# Free Render deployment and video storage

Primary application: https://pipelife-video-review.onrender.com

Legacy address (redirect): https://video-review-app-rryg.onrender.com

Supabase database: https://hxkssgllgpqcbgvqhqba.supabase.co

The chosen setup is Render free hosting, the existing Supabase database for review data, and Backblaze B2 for private video files. Google Drive is no longer required. No paid capacity or billing setup is authorized.

## Backblaze B2 setup

1. [Create a B2 Cloud Storage account](https://www.backblaze.com/sign-up/cloud-storage) without adding payment details. Use B2 Cloud Storage, not the Computer Backup trial. Backblaze advertises no credit card required and the first 10 GB of storage always free.
2. In **B2 Cloud Storage → Buckets**, create a bucket with a unique name such as `pipelife-review-videos-yourname`. Select **Private**, not Public. Use the bucket only for this app. Copy its **Bucket ID** (not its name).
3. In **Application Keys**, create a new application key. Restrict it to this one bucket, select **Read and Write**, and leave the filename prefix and expiration blank. Do not use the master application key. The app needs `listBuckets`, `listFiles`, `readFiles`, `writeFiles`, and `deleteFiles`; delete permission is used only to roll back an upload when saving its review record fails. It does not need permission to list all bucket names.
4. In **Caps & Alerts**, set available monetary usage caps to **$0** and enable notifications. Do not add a payment method or enable paid features. Free storage, download, and API limits still apply; operations can stop when their free allowances are exhausted. If signup asks for mandatory payment details, stop rather than enable billing.
5. Open [the existing Render service](https://dashboard.render.com/web/srv-dbcee89kjs5s739m3n9g) → **Environment** and add:

   | Name | Value |
   | --- | --- |
   | `B2_KEY_ID` | The new application's **keyID** |
   | `B2_APPLICATION_KEY` | The new **applicationKey**, displayed once |
   | `B2_BUCKET_ID` | The private bucket's **Bucket ID** |

   Keep these values out of chat, source control, browser code, and `VITE_` variables. Save and redeploy. The bucket/account must be created by its owner; the app cannot create the account or recover a lost application key.
6. Sign into the app, open **Video storage**, and choose **Check connection**. It must say **Video storage connected**. Upload a short H.264 MP4 to verify real bucket access.

Sources checked October 22, 2026: [Backblaze pricing](https://www.backblaze.com/cloud-storage/pricing), [signup](https://www.backblaze.com/sign-up/cloud-storage), and [caps and alerts](https://www.backblaze.com/docs/cloud-storage-data-caps-and-alerts). Download and API allowances are separate from storage; 10 GB of storage is not unlimited video viewing. The pricing page describes free monthly egress up to three times average stored data, with additional restrictions/caps for non-paying accounts.

The app checks all versions in its private bucket and refuses an upload that would take that bucket above **10,000,000,000 bytes**. Upload checks/writes are serialized within this service. Backblaze's free allowance is **account-wide**: use a dedicated account/bucket and retain provider caps, because other buckets, external uploads, additional app instances, and download/API usage are outside the app's storage guard.

## What happens to videos

Files up to 250 MB are inspected before upload. The server checks the provider's returned size, SHA-1 checksum, bucket, and filename before creating the review record. Video/thumbnail temporary files are removed after success or failure. Supabase holds the review record and thumbnail; no persistent Render disk is required. If saving a record fails after a confirmed upload, the app attempts to remove only that new upload.

The bucket stays private. Team sessions and scoped guest review links stream media through the app, including byte-range requests for seeking. Clients receive neither application keys nor Backblaze account tokens. The app uses current v4 account authorization and supports application keys restricted to one bucket.

Deleting a project removes review entries, comments, drawings, and invitation links. Cloud originals are preserved, as the confirmation dialog explains. Delete unused files and old versions in Backblaze to reclaim storage; files deleted directly there will no longer play in their reviews.

## Render and Supabase

Use the existing **free Docker web service**, not a static site. `Dockerfile` supplies Node 24, FFmpeg, compiled frontend, and the Express API. `render.yaml` provisions neither a database nor a paid disk. The source deploys from `main`. Do not create another service or enable paid capacity automatically.

Keep the existing `SUPABASE_URL` and server-only `SUPABASE_SECRET_KEY`. Core `pvr_` tables were verified in the real project. For a new Supabase project, run `supabase/schema.sql` through its SQL Editor. RLS denies browser access; the server uses a secret/service-role credential. SQLite records are not automatically migrated. Production refuses to start without Supabase.

The container binds to `0.0.0.0` and Render's `PORT`. `/api/health` checks database access. Render's free filesystem is temporary, so hosted uploads never silently fall back to local storage.

Initial workspace setup requires a display name and a password of at least six characters, chosen in the app. The name is the shared workspace profile/default comment author. Environment variables do not set or reset this password. There is no owner setup code. Existing owner credentials and review data must be preserved.

## Live verification

1. Confirm Render has deployed the new commit and `/api/health` returns `{"ok":true}`.
2. Add real B2 credentials, check the connection, and upload a short MP4. Confirm it appears in the private bucket.
3. Play and seek the video; post a frame comment with a hotspot and pencil drawing, then refresh.
4. Open an invitation in another browser without a team session; verify playback, feedback, and approval.
5. Redeploy and confirm the same projects, comments, and cloud video access persist.
6. Revoke the test invitation; confirm guest metadata and media are denied. Delete the test project and remove its retained cloud video manually if no longer needed.

Local fixtures verify integration behavior but do not establish access to a real Backblaze account. Real upload verification remains pending until the owner supplies the bucket and application key.

## Legacy Google Drive (optional)

Existing Drive video references remain supported. When B2 is configured, new uploads use B2; an invalid B2 configuration returns an error instead of switching storage accounts. Without B2, a previously connected Drive account can still handle uploads. No files are automatically migrated.

If deliberately retaining Drive, run `supabase/drive.sql` to add `pvr_connections`, which was missing at the last real-project check. Keep the existing `GOOGLE_TOKEN_ENCRYPTION_KEY` stable. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_DRIVE_FOLDER_ID` as before. The exact OAuth callback is `https://pipelife-video-review.onrender.com/api/drive/callback`. Drive tokens stay encrypted server-side. No Google credentials or OAuth table are needed for Backblaze storage.
