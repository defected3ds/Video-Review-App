# Pipelife video review

A video review application for teams and clients. It uses React/Vite and Express, with SQLite for local development or Supabase for persistent hosted metadata, and FFmpeg for video inspection and thumbnails.

## Run locally

Requirements: Node.js 24+, npm, FFmpeg/ffprobe (with H.264 support), and DejaVu Sans fonts. The prepared cloud environment already provides these tools.

```bash
npm ci
npm run prepare:demo
npm run build
npm start
```

The server binds to `127.0.0.1:3001` by default. Open that address in a browser on the same machine. On first use, enter your name and choose a workspace password (at least 6 characters). This creates the owner account; there are no default credentials.

For frontend development, use `npm run dev` after installation and sample preparation. Vite serves the frontend on port 5173 and proxies API requests to port 3001. The development launcher stops both services together.

Cloud tasks already have an isolated checkout. Use the existing checkout; do not create a worktree unless explicitly requested.

## Review workflow

### Standalone interactive HTML demo

Run `npm run build:demo` to create `dist-offline/Pipelife-interactive.html`. This single file embeds the application, styling, and sample video, and can be downloaded and opened in a browser without a server. It reuses the same review player as the hosted app.

The demo supports local MP4/WebM playback, hotspots, pencil markup, comments, resolving, review statuses, source frame-rate selection, and JSON feedback export. Videos selected from your device remain local. Feedback is saved in browser storage when available; reopen the same video after refreshing to restore its comments. When storage is unavailable, feedback lasts only for the open page, so export it before closing. Sharing with clients requires the hosted application.

`npm run test:demo` verifies the bundle with network access disabled during playback and review, persistence, local video reopening, and no API calls. The cloud system browser blocks direct file URLs by administrative policy, so the tests load the same standalone document through a static test server and directly into an isolated page; they do not disable that policy.

### Hosted application

1. Drag the desktop project sidebar’s right edge to resize it; the browser remembers the width. Video names wrap so full names remain readable. Double-click the edge to reset its width, or focus it and use the arrow keys. Open the **+** menu beside **PROJECTS** to create a project or delete the selected project. On mobile, this menu sits beside the project selector. **Delete project** opens a confirmation dialog; confirming removes its app video entries, comments, drawings, and invitation links. Cloud video originals remain in their storage account; remove unused files in Backblaze to reclaim free storage. Deleted projects stay deleted after restarting the app.
2. Configure Cloudflare R2 (or retain legacy Backblaze B2), then upload an MP4 or WebM video, up to 250 MB. Hosted uploads store the original bytes without automatic compression or resolution changes. Cloudflare R2 serves authenticated, short-lived playback links directly to the browser with byte-range seeking. Playback speed depends on the source bitrate, browser codec support, and connection; H.264 MP4 with fast-start metadata gives broad compatibility. The 10 GB bucket limit is checked before each cloud upload. No Google account is required. Local development without cloud storage retains its local upload mode. Existing Backblaze and Drive video references remain supported. R2 takes precedence for new uploads when its settings are entered, followed by configured Backblaze and then legacy Drive. Invalid or partial R2 settings block new uploads instead of falling back. Browser-compatible H.264, VP8, VP9, and AV1 video streams are accepted. Files are inspected and a thumbnail is generated before they appear in the project. H.264 MP4 is the most broadly compatible choice.
3. Pause or step through the video. Select **Pin comment** and click a point. A small editor opens beside the pin and shares its draft text/name with the sidebar composer; submit either to create one timestamped comment. Clicking a saved pin opens its text and selects the corresponding sidebar entry.
4. Select **Pencil**, draw with colors/undo/clear, then choose **Save drawing**. Each saved drawing is its own timestamped comment entry with a drawing preview; no text is required. Multiple strokes before saving form one drawing. If you send text while a drawing is unfinished, the drawing saves as a separate entry first. Draft markup remains tied to its marked frame when seeking and has a timestamped draft row plus a timeline circle before posting. Text comments and drawings have separate timestamps; placing a new pin uses the current video frame.
5. Click a comment or a timeline marker to return to its timestamp. Saved pins and drawings have an **Edit** action on their video popup and in the comment history. Edit the text, reposition the pin, or add/undo/clear drawing strokes, then save or cancel. Edits preserve the original timestamp and history entry. Team members can edit feedback; shared-link guests can edit feedback created in their browser (the edit permission is remembered locally and is not granted by reusing a display name). Larger, counted markers group comments on the same frame and nearby marks that would overlap at the current timeline width; repeated clicks cycle through those entries at their original timestamps, with the circle showing the active position (1, 2, 3…). Numbers and vertical position lines share the circle’s center. On mobile, the timeline uses its own full-width row below the playback controls. A hotspot opens its associated comment. Markup is visible at that moment and scales with the displayed video, including letterboxing.
6. Team members can resolve and reopen comments. **Comment history** defaults to **All comments**, so resolving leaves entries visible with a Resolved label. Switch to Open or Resolved when needed. Emoji buttons insert feedback in the sidebar or inline pin editor. Review status can be In review, Changes requested, or Approved.
7. The **Reviews** tab opens a queue across all projects, with Needs review, Changes requested, Approved, and All filters, search, and refresh. Select a row to open the correct video/project. On desktop windows at least 1100 pixels wide and 650 pixels tall, the player, controls, composer, and compact square video-asset strip use the available viewport height. Comments and asset lists scroll within their panels.
8. **Share link** creates a link valid for seven days. The shared review includes all comments, including resolved history, drawings, pins, and the current approval status. Clients enter the shared password before any video metadata, media, or comments load. Their session lasts one hour and is scoped to that review; the link itself remains valid for seven days. They choose a name when first leaving feedback, without creating an account. They cannot access the team workspace, upload files, resolve comments, or create invitations. **Revoke all invitation links** blocks new app access and new playback URLs immediately. Previously issued R2 playback URLs remain usable for up to five minutes, and transfers begun before expiry can complete.

The moon/sun button in the header switches between light and dark mode, including sign-in, shared reviews, and `/admin`. Appearance follows the device setting until you choose a mode, then remembers that choice in this browser. It also updates across tabs. If browser storage is blocked, switching still works for the open page. Video pixels and annotation colors are unchanged.

Invitations work only where the app's host is reachable. A loopback address is for local testing, not a client-facing invitation. No invitations are automatically sent.

## Persistence and configuration

In local development, data is stored in ignored `.data/`: SQLite holds projects, comments, markup, status, the hashed workspace password, hashed sessions, and hashed invitation tokens. Local uploads and thumbnails live in `.data/uploads/`. With Backblaze or an existing Drive connection, local video files are temporary; cloud storage holds the videos and the database holds thumbnail data. This directory must be retained to keep the workspace. Back up the complete directory while the service is stopped, or use a SQLite-aware backup procedure.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listening interface. Use `0.0.0.0` only on a deliberately configured host. |
| `PORT` | `3001` | API and production frontend port. |
| `DATA_DIR` | `.data` inside the checkout | Absolute or relative path to the database and uploads. |
| `SUPABASE_URL` | unset | Supabase project origin; enables external metadata storage. |
| `SUPABASE_SECRET_KEY` | unset | Server-only Supabase secret or legacy service-role credential. |
| `R2_ACCOUNT_ID` | unset | Cloudflare account ID; enables preferred R2 storage when R2 variables are entered. |
| `R2_BUCKET_NAME` | unset | Private dedicated Standard R2 bucket name. |
| `R2_ACCESS_KEY_ID` | unset | Server-only R2 Object Read & Write access key ID scoped to the bucket. |
| `R2_SECRET_ACCESS_KEY` | unset | Server-only R2 secret access key. |
| `B2_KEY_ID` | unset | Server-only application key ID for one private Backblaze bucket. |
| `B2_APPLICATION_KEY` | unset | Server-only Backblaze application key, never a master key. |
| `B2_BUCKET_ID` | unset | Private bucket ID, not its name. |
| `GOOGLE_CLIENT_ID` | unset | Optional legacy Google OAuth web client ID. |
| `GOOGLE_CLIENT_SECRET` | unset | Server-only Google OAuth client secret. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | unset | Stable random value, at least 32 characters, for encrypted OAuth tokens/state. |
| `GOOGLE_DRIVE_FOLDER_ID` | User-supplied folder ID | Folder for listing, imports, and site uploads. |
| `APP_URL` | `RENDER_EXTERNAL_URL` | Public HTTPS origin for the OAuth callback. |
| `TRUST_PROXY` | unset | Set to `1` only behind one trusted reverse proxy, so HTTPS sessions receive secure cookies. |

First-run setup asks the owner for a display name and workspace password of at least 6 characters. Ordinary sign-in asks only for the shared password. Review links also require it, with scoped review cookies that do not grant workspace or admin access. Workspace and review sessions expire exactly one hour after sign-in; activity does not extend them. Both cookie lifetime and database authorization enforce this, and older seven-day session rows are shortened at startup without being extended on later restarts. The page locks and pauses video at expiry, retaining unfinished text/drawings in memory until password re-entry. A commenter name is requested when leaving feedback and remembered in browser local storage across sessions, separately from login. Change it via the commenter icon; past comments retain their original names. Names are self-reported, not verified identities. Passwords stay out of browser storage. Initial authentication uses a loading gate to prevent a workspace flash. Setup closes after the first owner is created. Render variables do not reset the password. Production requires Supabase and never silently falls back to local SQLite.

### Administration

Open `/admin` directly to manage your display name, see registered nickname profiles and last sign-in times, change the workspace password, and check private video storage/usage. The workspace has no Settings button. Under Video storage → Original-quality videos, **Move to R2** copies an existing Backblaze video without further compression, retaining the video ID, comments, timestamps, status, and share links. This needs one source download, so wait for the daily allowance reset if capped. Old cloud originals are retained; temporary files are removed. Existing compressed copies cannot recover the original quality without re-uploading the original file. The page uses the existing workspace sign-in; guest invitation links do not grant settings access. Changing the password requires the current password and rotates the active session while revoking other team sessions. Existing client review links remain active. Settings persist in SQLite locally or Supabase when hosted. Existing hosted projects need the additive [supabase/profiles.sql](supabase/profiles.sql) migration to enable nickname profiles. Before this migration, existing password-only sign-in continues to work. The server checks for the schema every 15 seconds; the current password-only flow and browser commenter names work without this migration. Legacy nickname API clients can still use these tables. No credentials or existing feedback are reset. Storage credentials remain server-only Render environment settings. The uploaded Pipelife/Wienerberger SVG is used on sign-in, workspace, and admin headers.

## Supabase database

Project URL: `https://hxkssgllgpqcbgvqhqba.supabase.co`.

Run [supabase/schema.sql](supabase/schema.sql) in your project's SQL editor. It creates app-specific `pvr_` tables with row-level security and no browser-role access. It does not modify unrelated tables. Deleting a project atomically cascades to its assets, comments, and review links.

Configure `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` in secure environment settings. Use a Supabase secret key or legacy service-role key, never a publishable/anon key. These variables must not have the `VITE_` prefix. Run `npm run check:supabase` to check the connection and schema without creating or changing records. Setting a URL without a credential fails startup; database failures return an error rather than falling back to a local database.

With Supabase configured, projects, feedback, owner credentials, sessions, and invitations use the external database. Existing local SQLite records are not automatically migrated. Remote mode starts with an empty project list. Hosted uploads require Cloudflare R2, legacy Backblaze B2, or a previously connected Drive account. R2 playback is authenticated by the app and delivered directly from storage with five-minute signed URLs, preserving HTTP range requests. Expired URLs can renew through the app; server credentials never reach viewers. In `/admin`, Move to R2 migrates a Backblaze video without changing its review ID, feedback, or share tokens; its original remains in Backblaze. Migration needs one source download and waits for the daily cap reset if blocked. Backblaze requires no OAuth connection table or Google credentials. Keys remain server-side; thumbnails are stored with metadata. Follow [DEPLOYMENT.md](DEPLOYMENT.md) to create the private bucket and add its settings to Render. R2 activation and billing are handled by the owner. Its storage/request overages can incur charges even though direct egress is free; the app guards only the dedicated bucket's size. Keep any legacy Backblaze monetary cap at $0. The 10 GB free storage allowance is account-wide; the app checks all stored versions in its dedicated bucket and serializes uploads in this service. Other buckets or external uploads are outside that guard. Playback uses the provider’s separate free download/API allowances; reaching a cap can stop playback or uploads until the relevant usage allowance resets. Removing files frees storage, not already-used download bandwidth. Watching, metadata loading, and seeking to unbuffered sections use downloads; comments, drawings, emojis, and approvals use Supabase instead. Timeline dragging coalesces preview seeks and makes a precise seek on release. When Backblaze reports a download cap, the player and admin page explain it; comments remain readable, and Retry playback allows recovery after the reset. No billing settings are changed automatically.

`npm run test:supabase` uses Docker to start isolated PostgreSQL 17 and PostgREST 13 containers. It verifies the real schema and REST integration, anonymous access denial, annotations/status persistence with an erased local data directory, and cascade deletion. It creates no real Supabase records and cleans up its containers/network. Docker must be available; images are pulled if missing. Local browser/API tests explicitly isolate themselves from any configured Supabase project.

## Checks

```bash
npm run prepare:demo
npm run build
npm test
npm run test:e2e
npm run test:r2:e2e
npm run test:feedback:e2e
npm run test:navigation:e2e
npm run test:sessions:e2e
```

R2 tests independently verify SigV4-signed requests against a local S3 fixture, private direct range playback, upload checksums and quotas, migration/cap failures, feedback and token preservation, rollback and partial configuration. Its browser checks cover direct delivery, expired URL renewal with frame/draft retention, denied renewal after guest revocation, and migration controls. API tests also cover Backblaze private-bucket/key restrictions, real upload bytes and SHA-1 validation, a 10 GB guard, token refresh, scoped byte-range playback, rollback on database failure, temporary-file cleanup, and restart persistence against a local provider fixture. They also include Google OAuth state/PKCE, encrypted tokens, refresh, actual uploaded bytes against a local provider fixture, selected-folder validation, Drive byte-range playback, temporary-file cleanup, disconnect, and source-file preservation. They also cover authentication, validated uploads, thumbnails, byte-range playback, annotations, guest access boundaries, status updates, resolving, restart persistence, and revocation. Browser checks exercise the actual UI, playback, drawing, hotspots, guest comments, uploads, search, and mobile layout. Tests use temporary databases and remove them afterwards. Browser screenshots are written to ignored `test-results/`.

The browser runner uses system Chromium at `/usr/bin/chromium` when available. Otherwise run `npx playwright install chromium`, or supply `PLAYWRIGHT_CHROMIUM_EXECUTABLE` with a local Chromium executable path.

## Prototype boundaries

- The app is packaged for a Render Docker web service. Verify the public service and its deployed commit before relying on a local change being online.
- The real Supabase core schema and deployed metadata connection were verified. Backblaze storage is tested with a local provider fixture; real bucket access must be verified after the owner supplies credentials. Legacy Google Drive remains available for existing connections. Render’s free filesystem is ephemeral; cloud video storage and Supabase hold persistent data.
- Invitations require a reachable HTTPS application URL for external clients. Configure the owner and HTTPS before sharing real client material.
- Adaptive streaming, high-resolution original downloads, version comparisons, email invitations, individual passwords or permission roles, real-time comment updates, and moving-object tracking are not included. Reload to see another reviewer's latest changes.
- Comments store the exact selected timestamp. Frame numbers and stepping use the reported average frame rate; variable-frame-rate footage can have approximate frame numbers. For predictable frame indexing, export constant-frame-rate review copies.
- Hotspots and drawings belong to a single moment; they do not follow moving objects or change the video itself.

The sample clip is generated locally and is clearly labeled. It is not customer footage.

## Render deployment

The application URL is https://pipelife-video-review.onrender.com. The former static-site address forwards to this web service.

Use the supplied `Dockerfile` and free-service `render.yaml` template. Read [DEPLOYMENT.md](DEPLOYMENT.md) for the existing service URL, workspace setup, Backblaze setup, optional legacy Google configuration, and live checks. No paid resources have been provisioned. Local/tested behavior does not establish that the public Render service has received these changes.

Each completed pencil stroke is a separate draft with an optional explanation. Accept it to save its drawing, explanation, frame, and timeline marker together; Delete discards only that draft. Pending drawings remain separate from text/pin feedback. Drop one MP4/WebM onto the project workspace to upload it, or use the file picker. Each video card has a Delete video action that removes only its review, feedback, and links; the project and other videos stay. Local upload files are cleaned up. Cloud files remain in their provider account and can be removed there when unused.

Drawings, pins, and their popups hide immediately throughout timeline scrubbing and video seeks. They return only on their own frame once seeking completes; feedback and pending drafts stay in history. Upload video and Delete video are grouped above the player. Drag a video card or sidebar video onto a different sidebar project to move it. Moving only updates the existing video’s project relation: IDs, storage bytes, annotations, comments, resolved state, approval status, and share links are retained without re-uploading. The source project stays even when empty. Moving a selected video with unfinished feedback asks before discarding that draft; canceling or a failed move leaves it in place. This uses existing database fields and needs no SQL migration.

R2 playback links are limited to five minutes or the remaining signed-in session duration, whichever is shorter. Review-session cookies are HttpOnly, SameSite=Strict, and scoped to that review’s API path. Invalid/revoked links remain unavailable even if the reviewer has signed in. Password changes revoke workspace and review sessions while keeping valid invitation links usable after reauthentication. No new database migration is required for one-hour sessions or browser commenter names.
