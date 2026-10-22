# Free Render deployment and video storage

Primary application: https://pipelife-video-review.onrender.com

Legacy address (redirect): https://video-review-app-rryg.onrender.com

Supabase database: https://hxkssgllgpqcbgvqhqba.supabase.co

The target setup is the existing free Render service, Supabase for review data, and Cloudflare R2 for video files. The owner must activate R2 and enter its billing details themselves. Do not upgrade Render, add paid infrastructure, or change billing automatically. R2 has included allowances and possible overage charges; the app's bucket guard does not guarantee an account-wide $0 bill. Backblaze remains available for existing video references until they are migrated. Google Drive is optional legacy compatibility.

## Cloudflare R2 setup

1. In [Cloudflare R2 Overview](https://dash.cloudflare.com/?to=/:account/r2/overview), activate the R2 subscription yourself. Create a **Standard** bucket named `pipelife-videos`, with **Automatic** location. Leave both public development access and custom-domain public access disabled.
2. Return to **R2 → Overview → Account Details**. Next to **API Tokens**, select **Manage**. Create an Account or User API token with **Object Read & Write** permission, scoped to this bucket only. Record the **Access Key ID** and **Secret Access Key**, which is shown once. The generic API token value is not the S3 secret pair used by this app.
3. Open [Render Environment](https://dashboard.render.com/web/srv-dbcee89kjs5s739m3n9g/env) and add all four server-only fields:

   | Name | Value |
   | --- | --- |
   | `R2_ACCOUNT_ID` | The 32-character Cloudflare account ID from R2 Account Details or the first part of its S3 API hostname |
   | `R2_BUCKET_NAME` | `pipelife-videos`, or the exact bucket name you created |
   | `R2_ACCESS_KEY_ID` | R2 token's Access Key ID |
   | `R2_SECRET_ACCESS_KEY` | R2 token's Secret Access Key |

   Keep keys out of chat, client code, Git, and `VITE_` variables. Save and redeploy. The app derives the HTTPS S3 endpoint from the account ID; no public bucket URL is needed. The automatic-location setup uses the normal account endpoint, not a jurisdiction-specific endpoint.
4. Open `/admin#storage` and choose **Check connection**. It should identify **Cloudflare R2**. New uploads now use R2 and retain the smaller-review-copy processing. Partially entered or invalid R2 settings block new uploads with a clear error instead of silently using another account. No SQL migration is needed for this provider switch.
5. Leave the existing `B2_*` variables in place. Under **Smaller review videos**, use **Move to R2** for each Backblaze video. Migration checks the destination first, downloads the original once, compresses it if needed, and updates the same asset's media reference. Comments, drawings, pins, timestamps, approval status, and share tokens stay attached. If the 1 GB daily Backblaze download cap is exhausted, wait for the daily reset; the existing review is unchanged on failure. Backblaze source files are retained.
6. Verify owner and guest playback on R2 before removing any legacy configuration or deleting source files manually.

R2 uses AWS Signature Version 4 through the official AWS S3 SDK. New uploads are size/hash confirmed, and failures saving the database record roll back only the new object. Playback first checks the team session or scoped guest token, then redirects to a **five-minute signed GET URL**. Video bytes flow directly from R2 to the viewer instead of through Render. Byte-range seeking works directly with R2, and expired playback URLs can renew through the authorized app route without losing the selected frame or draft feedback. No Worker, public bucket, custom domain, or browser credential is required.

Revoking a review link immediately blocks new app access and new signed playback URLs. An already issued R2 URL can continue working until its five-minute expiry; a download started before expiry may complete. Long-lived S3 credentials never leave the server. The interface discloses the playback-link window.

The app serializes writes and checks all objects in its dedicated bucket against 10,000,000,000 bytes. Other buckets, external writes, and request usage are outside this guard. R2's Standard free allowance is monthly: 10 GB-month storage, 1 million Class A operations, 10 million Class B operations, and no direct egress charge. Do not use the public development-only `r2.dev` endpoint for private production playback.

Official references: [R2 token setup](https://developers.cloudflare.com/r2/api/tokens/), [pricing](https://developers.cloudflare.com/r2/pricing/), [presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

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
6. Sign into the app, open **Settings → Video storage** at `/admin#storage`, and choose **Check connection**. It must say **Video storage connected**. Upload a short H.264 MP4 to verify real bucket access.

Sources checked October 22, 2026: [Backblaze pricing](https://www.backblaze.com/cloud-storage/pricing), [signup](https://www.backblaze.com/sign-up/cloud-storage), and [caps and alerts](https://www.backblaze.com/docs/cloud-storage-data-caps-and-alerts). Download and API allowances are separate from storage; 10 GB of storage is not unlimited video viewing. The pricing page describes free monthly egress up to three times average stored data, with additional restrictions/caps for non-paying accounts.

The app checks all versions in its private bucket and refuses an upload that would take that bucket above **10,000,000,000 bytes**. Upload checks/writes are serialized within this service. Backblaze's free allowance is **account-wide**: use a dedicated account/bucket and retain provider caps, because other buckets, external uploads, additional app instances, and download/API usage are outside the app's storage guard.

## What happens to videos

Files up to 250 MB are inspected before upload. The server checks the provider's returned size, SHA-1 checksum, bucket, and filename before creating the review record. Video/thumbnail temporary files are removed after success or failure. Supabase holds the review record and thumbnail; no persistent Render disk is required. If saving a record fails after a confirmed upload, the app attempts to remove only that new upload.

Legacy Backblaze buckets stay private. Team sessions and scoped guest review links stream Backblaze media through the app, including byte-range requests for seeking. Clients receive neither application keys nor Backblaze account tokens. The app uses current v4 account authorization and supports application keys restricted to one bucket.

Backblaze uses `*.backblazeb2.com` for API/download endpoints and can return an upload pod such as `pod-031-2032-06.backblaze.com`. The app accepts that numbered pod hostname only for provider-issued upload sessions, with HTTPS and no redirects. It continues to reject arbitrary domains, credentials in URLs, custom ports, and non-HTTPS addresses.

Deleting a project removes review entries, comments, drawings, and invitation links. Cloud originals are preserved, as the confirmation dialog explains. Delete unused files and old versions in Backblaze to reclaim storage; files deleted directly there will no longer play in their reviews.

## Render and Supabase

Use the existing **free Docker web service**, not a static site. `Dockerfile` supplies Node 24, FFmpeg, compiled frontend, and the Express API. `render.yaml` provisions neither a database nor a paid disk. The source deploys from `main`. Do not create another service or enable paid capacity automatically.

Keep the existing `SUPABASE_URL` and server-only `SUPABASE_SECRET_KEY`. Core `pvr_` tables were verified in the real project. For a new Supabase project, run `supabase/schema.sql` through its SQL Editor. RLS denies browser access; the server uses a secret/service-role credential. SQLite records are not automatically migrated. Production refuses to start without Supabase.

The container binds to `0.0.0.0` and Render's `PORT`. `/api/health` checks database access. Render's free filesystem is temporary, so hosted uploads never silently fall back to local storage.

Initial workspace setup requires a display name and a password of at least six characters, chosen in the app. The name is the shared workspace profile/default comment author. Environment variables do not set or reset this password. There is no owner setup code. Existing owner credentials and review data must be preserved.

## Administration

https://pipelife-video-review.onrender.com/admin uses the existing workspace password and session. Password settings use the existing tables. Nickname profiles require the separate additive `supabase/profiles.sql` migration; until applied, existing password-only sign-in remains available. The R2 storage switch itself does not require new tables. Password changes require the current password, revoke other team sessions, and keep client review links valid. Storage status, quota usage, and provider/server management links live here. Real provider secrets remain in Render Environment; the admin page never receives or displays them. Anyone using the shared team password has access to this page; individual admin/team roles are not implemented.

## Live verification

1. Confirm Render has deployed the new commit and `/api/health` returns `{"ok":true}`.
2. Configure R2, check the connection, and upload a short MP4. Confirm it appears in the R2 bucket. Use a dedicated test project and remove the retained test object manually afterward.
3. Play and seek the video; post a frame comment with a hotspot and pencil drawing, then refresh.
4. Open an invitation in another browser without a team session; verify playback, feedback, and approval.
5. Redeploy and confirm the same projects, comments, and cloud video access persist.
6. Revoke the test invitation; confirm guest metadata and new playback URLs are denied. Previously issued R2 URLs have the expiry window described above. Delete the test project and remove its retained cloud video manually if no longer needed.

On October 22, 2026, the real configured Backblaze account and private bucket were verified with the application's storage adapter: a generated sample uploaded successfully, private byte-range playback returned the expected bytes, and the temporary test object was removed. Existing owner credentials and customer review records were not changed. The checklist above still applies when verifying the deployed browser workflow or changing provider settings.

## Legacy Google Drive (optional)

Existing Drive video references remain supported. When R2 is configured, new uploads use R2. Otherwise, configured B2 takes precedence over Drive; an invalid B2 configuration returns an error instead of switching storage accounts. Without B2, a previously connected Drive account can still handle uploads. No files are automatically migrated.

If deliberately retaining Drive, run `supabase/drive.sql` to add `pvr_connections`, which was missing at the last real-project check. Keep the existing `GOOGLE_TOKEN_ENCRYPTION_KEY` stable. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_DRIVE_FOLDER_ID` as before. The exact OAuth callback is `https://pipelife-video-review.onrender.com/api/drive/callback`. Drive tokens stay encrypted server-side. No Google credentials or OAuth table are needed for Backblaze storage.
