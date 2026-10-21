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

1. Create a project or use the sample campaign. **Delete project** opens a confirmation dialog; confirming removes its app video entries, comments, drawings, and invitation links. Files already stored in Google Drive remain there. Deleted projects stay deleted after restarting the app.
2. Connect Google Drive, then upload an MP4 or WebM video, up to 250 MB. On the hosted site, uploads go into the configured Google Drive folder. You can also import an existing video from that folder. Local development without a Drive connection retains its local upload mode. Browser-compatible H.264, VP8, VP9, and AV1 video streams are accepted. Files are inspected and a thumbnail is generated before they appear in the project. H.264 MP4 is the most broadly compatible choice.
3. Pause or step through the video. Select **Pin comment** and click a point, or select **Pencil** and draw. Colors, undo, and clearing are available.
4. Write a comment and send it. The timestamp, frame estimate, normalized hotspot coordinates, and pencil paths are stored together. Draft markup stays tied to its original timestamp even if you seek elsewhere.
5. Click a comment or a timeline marker to return to its timestamp. A hotspot opens its associated comment. Markup is visible at that moment and scales with the displayed video, including letterboxing.
6. Team members can resolve and reopen comments. Switch between Open, Resolved, and All feedback. Review status can be In review, Changes requested, or Approved.
7. **Invite client** creates a link valid for seven days. Clients can view that video, enter their name, comment, draw, pin feedback, and update its review status without an account. They cannot access the team workspace, upload files, resolve comments, or create invitations. **Revoke all invitation links** immediately removes access to the selected video's links, including media endpoints.

Invitations work only where the app's host is reachable. A loopback address is for local testing, not a client-facing invitation. No invitations are automatically sent.

## Persistence and configuration

In local development, data is stored in ignored `.data/`: SQLite holds projects, comments, markup, status, the hashed workspace password, hashed sessions, and hashed invitation tokens. Local uploads and thumbnails live in `.data/uploads/`. When Drive is connected, local files are temporary; videos live in Drive and thumbnail data lives in the database. This directory must be retained to keep the workspace. Back up the complete directory while the service is stopped, or use a SQLite-aware backup procedure.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listening interface. Use `0.0.0.0` only on a deliberately configured host. |
| `PORT` | `3001` | API and production frontend port. |
| `DATA_DIR` | `.data` inside the checkout | Absolute or relative path to the database and uploads. |
| `SUPABASE_URL` | unset | Supabase project origin; enables external metadata storage. |
| `SUPABASE_SECRET_KEY` | unset | Server-only Supabase secret or legacy service-role credential. |
| `GOOGLE_CLIENT_ID` | unset | Google OAuth web client ID. |
| `GOOGLE_CLIENT_SECRET` | unset | Server-only Google OAuth client secret. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | unset | Stable random value, at least 32 characters, for encrypted OAuth tokens/state. |
| `GOOGLE_DRIVE_FOLDER_ID` | User-supplied folder ID | Folder for listing, imports, and site uploads. |
| `APP_URL` | `RENDER_EXTERNAL_URL` | Public HTTPS origin for the OAuth callback. |
| `TRUST_PROXY` | unset | Set to `1` only behind one trusted reverse proxy, so HTTPS sessions receive secure cookies. |

First-run setup asks for your display name and a workspace password of at least 6 characters. The name appears on the shared workspace profile and as the default comment author. Choose the password in the setup form; Render environment variables do not set the workspace password. Setup closes after the first owner is created. There is one shared team password in this prototype. Client names are self-reported, not verified identities. Production requires Supabase and never silently uses local SQLite when the external database fails.

## Supabase database

Project URL: `https://hxkssgllgpqcbgvqhqba.supabase.co`.

Run [supabase/schema.sql](supabase/schema.sql) in your project's SQL editor. It creates app-specific `pvr_` tables with row-level security and no browser-role access. It does not modify unrelated tables. Deleting a project atomically cascades to its assets, comments, and review links.

Configure `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` in secure environment settings. Use a Supabase secret key or legacy service-role key, never a publishable/anon key. These variables must not have the `VITE_` prefix. Run `npm run check:supabase` to check the connection and schema without creating or changing records. Setting a URL without a credential fails startup; database failures return an error rather than falling back to a local database.

With Supabase configured, projects, feedback, owner credentials, sessions, and invitations use the external database. Existing local SQLite records are not automatically migrated. Remote mode starts with an empty project list. Hosted uploads require a connected Google Drive account and store video files in the configured folder. Tokens are encrypted with `GOOGLE_TOKEN_ENCRYPTION_KEY`; thumbnails are stored with metadata. Configure Google credentials later using [DEPLOYMENT.md](DEPLOYMENT.md). Check the live service and Google account using the verification steps in DEPLOYMENT.md.

`npm run test:supabase` uses Docker to start isolated PostgreSQL 17 and PostgREST 13 containers. It verifies the real schema and REST integration, anonymous access denial, annotations/status persistence with an erased local data directory, and cascade deletion. It creates no real Supabase records and cleans up its containers/network. Docker must be available; images are pulled if missing. Local browser/API tests explicitly isolate themselves from any configured Supabase project.

## Checks

```bash
npm run prepare:demo
npm run build
npm test
npm run test:e2e
```

API tests include Google OAuth state/PKCE, encrypted tokens, refresh, actual uploaded bytes against a local provider fixture, selected-folder validation, Drive byte-range playback, temporary-file cleanup, disconnect, and source-file preservation. They also cover authentication, validated uploads, thumbnails, byte-range playback, annotations, guest access boundaries, status updates, resolving, restart persistence, and revocation. Browser checks exercise the actual UI, playback, drawing, hotspots, guest comments, uploads, search, and mobile layout. Tests use temporary databases and remove them afterwards. Browser screenshots are written to ignored `test-results/`.

The browser runner uses system Chromium at `/usr/bin/chromium` when available. Otherwise run `npx playwright install chromium`, or supply `PLAYWRIGHT_CHROMIUM_EXECUTABLE` with a local Chromium executable path.

## Prototype boundaries

- The app is packaged for a Render Docker web service. Verify the public service and its deployed commit before relying on a local change being online.
- Supabase metadata integration is implemented and tested locally against PostgreSQL/PostgREST; the real project connection is unverified. Google Drive import/upload and streaming are implemented and tested with a local Google fixture. The real Google account and real Supabase connection remain unverified. Render's free filesystem is ephemeral; hosted video data uses Drive and metadata uses Supabase.
- Invitations require a reachable HTTPS application URL for external clients. Configure the owner and HTTPS before sharing real client material.
- Video transcoding, version comparisons, email invitations, individual team accounts, real-time comment updates, and moving-object tracking are not included. Reload to see another reviewer's latest changes.
- Comments store the exact selected timestamp. Frame numbers and stepping use the reported average frame rate; variable-frame-rate footage can have approximate frame numbers. For predictable frame indexing, export constant-frame-rate review copies.
- Hotspots and drawings belong to a single moment; they do not follow moving objects or change the video itself.

The sample clip is generated locally and is clearly labeled. It is not customer footage.

## Render deployment

The application URL is https://pipelife-video-review.onrender.com. The former static-site address forwards to this web service.

Use the supplied `Dockerfile` and free-service `render.yaml` template. Read [DEPLOYMENT.md](DEPLOYMENT.md) for the existing service URL, workspace setup, exact Google callback, deferred API configuration, and live checks. No paid resources have been provisioned. Local/tested behavior does not establish that the public Render service has received these changes.
