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

1. Create a project or use the sample campaign. **Delete project** opens a confirmation dialog; confirming removes its app video entries, comments, drawings, and invitation links. Cloud video originals remain in their storage account; remove unused files in Backblaze to reclaim free storage. Deleted projects stay deleted after restarting the app.
2. Configure Backblaze B2, then upload an MP4 or WebM video, up to 250 MB. Hosted uploads are converted to smaller review videos (up to 720p, H.264/AAC MP4), keeping the source frame rate and checking duration alignment. If an upload is already smaller than the generated copy, its original bytes are used instead. Only this review file is uploaded to the private bucket; retain the full-quality source on your computer. Encodes are serialized with a three-minute processing limit to bound free-server resources. The 10 GB bucket limit is checked before each cloud upload. No Google account is required. Local development without cloud storage retains its local upload mode. Existing Drive connections and videos remain supported for earlier workspaces; configured Backblaze storage takes precedence for new uploads. Browser-compatible H.264, VP8, VP9, and AV1 video streams are accepted. Files are inspected and a thumbnail is generated before they appear in the project. H.264 MP4 is the most broadly compatible choice.
3. Pause or step through the video. Select **Pin comment** and click a point. A small editor opens beside the pin and shares its draft text/name with the sidebar composer; submit either to create one timestamped comment. Clicking a saved pin opens its text and selects the corresponding sidebar entry.
4. Select **Pencil**, draw with colors/undo/clear, then choose **Save drawing**. Each saved drawing is its own timestamped comment entry with a drawing preview; no text is required. Multiple strokes before saving form one drawing. If you send text while a drawing is unfinished, the drawing saves as a separate entry first. Draft markup remains tied to its marked frame when seeking and has a timestamped draft row plus a timeline circle before posting. Text comments and drawings have separate timestamps; placing a new pin uses the current video frame.
5. Click a comment or a timeline marker to return to its timestamp. Larger, counted markers group comments on the same frame; repeated clicks cycle through those entries. A hotspot opens its associated comment. Markup is visible at that moment and scales with the displayed video, including letterboxing.
6. Team members can resolve and reopen comments. **Comment history** defaults to **All comments**, so resolving leaves entries visible with a Resolved label. Switch to Open or Resolved when needed. Emoji buttons insert feedback in the sidebar or inline pin editor. Review status can be In review, Changes requested, or Approved.
7. The **Reviews** tab opens a queue across all projects, with Needs review, Changes requested, Approved, and All filters, search, and refresh. Select a row to open the correct video/project. On desktop windows at least 1100 pixels wide and 650 pixels tall, the player, controls, composer, and compact square video-asset strip use the available viewport height. Comments and asset lists scroll within their panels.
8. **Share link** or **Invite people** creates a link valid for seven days. The shared review includes all comments, including resolved history, drawings, pins, and the current approval status. Clients can view that video, enter their name, comment, draw, pin feedback, and update its review status without an account. They cannot access the team workspace, upload files, resolve comments, or create invitations. **Revoke all invitation links** immediately removes access to the selected video's links, including media endpoints.

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
| `B2_KEY_ID` | unset | Server-only application key ID for one private Backblaze bucket. |
| `B2_APPLICATION_KEY` | unset | Server-only Backblaze application key, never a master key. |
| `B2_BUCKET_ID` | unset | Private bucket ID, not its name. |
| `GOOGLE_CLIENT_ID` | unset | Optional legacy Google OAuth web client ID. |
| `GOOGLE_CLIENT_SECRET` | unset | Server-only Google OAuth client secret. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | unset | Stable random value, at least 32 characters, for encrypted OAuth tokens/state. |
| `GOOGLE_DRIVE_FOLDER_ID` | User-supplied folder ID | Folder for listing, imports, and site uploads. |
| `APP_URL` | `RENDER_EXTERNAL_URL` | Public HTTPS origin for the OAuth callback. |
| `TRUST_PROXY` | unset | Set to `1` only behind one trusted reverse proxy, so HTTPS sessions receive secure cookies. |

First-run setup asks for your display name and a workspace password of at least 6 characters. Each person signs in with a nickname and the shared workspace password. A nickname profile is created on first sign-in; returning sign-ins reuse it, matching nicknames case-insensitively. The browser remembers only the nickname; passwords remain out of browser storage. The nickname appears on new comments. Sessions last seven days, and the interface stays behind a loading gate until authentication is checked. Choose the password in the setup form; Render environment variables do not set the workspace password. Setup closes after the first owner is created. There is one shared team password in this prototype. Client names are self-reported, not verified identities. Production requires Supabase and never silently uses local SQLite when the external database fails.

### Administration

Open `/admin` directly to manage your display name, see registered nickname profiles and last sign-in times, change the workspace password, and check private video storage/usage. The workspace has no Settings button. Under Video storage → Smaller review videos, **Make smaller** converts an existing Backblaze video and updates its media reference without changing the video ID, comments, drawing timestamps, status, or share links. This needs one source download, so wait for the daily download allowance to reset if capped. Old cloud originals are retained; temporary processing files are removed. Already processed review copies skip repeat conversion. The page uses the existing workspace sign-in; guest invitation links do not grant settings access. Changing the password requires the current password and rotates the active session while revoking other team sessions. Existing client review links remain active. Settings persist in SQLite locally or Supabase when hosted. Existing hosted projects need the additive [supabase/profiles.sql](supabase/profiles.sql) migration to enable nickname profiles. Before this migration, existing password-only sign-in continues to work. The server checks for the schema every 15 seconds; after applying it, reload and sign in with a nickname. No credentials or existing feedback are reset. Storage credentials remain server-only Render environment settings. The uploaded Pipelife/Wienerberger SVG is used on sign-in, workspace, and admin headers.

## Supabase database

Project URL: `https://hxkssgllgpqcbgvqhqba.supabase.co`.

Run [supabase/schema.sql](supabase/schema.sql) in your project's SQL editor. It creates app-specific `pvr_` tables with row-level security and no browser-role access. It does not modify unrelated tables. Deleting a project atomically cascades to its assets, comments, and review links.

Configure `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` in secure environment settings. Use a Supabase secret key or legacy service-role key, never a publishable/anon key. These variables must not have the `VITE_` prefix. Run `npm run check:supabase` to check the connection and schema without creating or changing records. Setting a URL without a credential fails startup; database failures return an error rather than falling back to a local database.

With Supabase configured, projects, feedback, owner credentials, sessions, and invitations use the external database. Existing local SQLite records are not automatically migrated. Remote mode starts with an empty project list. Hosted uploads require configured Backblaze B2 storage or an existing Google Drive connection. Backblaze requires no OAuth connection table or Google credentials. Keys remain server-side; thumbnails are stored with metadata. Follow [DEPLOYMENT.md](DEPLOYMENT.md) to create the private bucket and add its settings to Render. Keep Backblaze account usage caps at $0 and do not add a payment method. The 10 GB free storage allowance is account-wide; the app checks all stored versions in its dedicated bucket and serializes uploads in this service. Other buckets or external uploads are outside that guard. Playback uses the provider’s separate free download/API allowances; reaching a cap can stop playback or uploads until the relevant usage allowance resets. Removing files frees storage, not already-used download bandwidth. Watching, metadata loading, and seeking to unbuffered sections use downloads; comments, drawings, emojis, and approvals use Supabase instead. Timeline dragging coalesces preview seeks and makes a precise seek on release. When Backblaze reports a download cap, the player and admin page explain it; comments remain readable, and Retry playback allows recovery after the reset. No billing settings are changed automatically.

`npm run test:supabase` uses Docker to start isolated PostgreSQL 17 and PostgREST 13 containers. It verifies the real schema and REST integration, anonymous access denial, annotations/status persistence with an erased local data directory, and cascade deletion. It creates no real Supabase records and cleans up its containers/network. Docker must be available; images are pulled if missing. Local browser/API tests explicitly isolate themselves from any configured Supabase project.

## Checks

```bash
npm run prepare:demo
npm run build
npm test
npm run test:e2e
```

API tests cover Backblaze private-bucket/key restrictions, real upload bytes and SHA-1 validation, a 10 GB guard, token refresh, scoped byte-range playback, rollback on database failure, temporary-file cleanup, and restart persistence against a local provider fixture. They also include Google OAuth state/PKCE, encrypted tokens, refresh, actual uploaded bytes against a local provider fixture, selected-folder validation, Drive byte-range playback, temporary-file cleanup, disconnect, and source-file preservation. They also cover authentication, validated uploads, thumbnails, byte-range playback, annotations, guest access boundaries, status updates, resolving, restart persistence, and revocation. Browser checks exercise the actual UI, playback, drawing, hotspots, guest comments, uploads, search, and mobile layout. Tests use temporary databases and remove them afterwards. Browser screenshots are written to ignored `test-results/`.

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
