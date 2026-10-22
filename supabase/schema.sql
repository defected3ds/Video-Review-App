-- Additive, app-specific schema. Run in the Supabase SQL editor.
-- These tables are accessible only through the server credential.
BEGIN;
CREATE TABLE IF NOT EXISTS public.pvr_projects (
  id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.pvr_assets (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.pvr_projects(id) ON DELETE CASCADE,
  name text NOT NULL, filename text, size bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'In review' CHECK(status IN ('In review','Approved','Changes requested')),
  duration double precision NOT NULL DEFAULT 0, fps double precision NOT NULL DEFAULT 25,
  poster text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.pvr_comments (
  id text PRIMARY KEY,
  asset_id text NOT NULL REFERENCES public.pvr_assets(id) ON DELETE CASCADE,
  author text NOT NULL, body text NOT NULL, time double precision NOT NULL,
  frame integer, annotations text NOT NULL DEFAULT '[]', hotspot text,
  resolved integer NOT NULL DEFAULT 0 CHECK(resolved IN (0,1)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.pvr_reviews (
  token text PRIMARY KEY,
  asset_id text NOT NULL REFERENCES public.pvr_assets(id) ON DELETE CASCADE,
  expires_at bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.pvr_owner (
  id integer PRIMARY KEY CHECK(id=1), name text NOT NULL, salt text NOT NULL, password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.pvr_sessions (token text PRIMARY KEY, expires_at bigint NOT NULL);
CREATE TABLE IF NOT EXISTS public.pvr_profiles (
  id text PRIMARY KEY, nickname text NOT NULL CHECK(length(nickname) BETWEEN 1 AND 80),
  nickname_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pvr_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pvr_profiles FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.pvr_profiles TO service_role;
ALTER TABLE public.pvr_sessions ADD COLUMN IF NOT EXISTS profile_id text REFERENCES public.pvr_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pvr_sessions_profile ON public.pvr_sessions(profile_id);
CREATE TABLE IF NOT EXISTS public.pvr_connections (id text PRIMARY KEY, payload text NOT NULL, expires_at bigint);
ALTER TABLE public.pvr_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pvr_connections FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.pvr_connections TO service_role;
CREATE INDEX IF NOT EXISTS pvr_connections_expiry ON public.pvr_connections(expires_at);
CREATE INDEX IF NOT EXISTS pvr_assets_project ON public.pvr_assets(project_id);
CREATE INDEX IF NOT EXISTS pvr_comments_asset ON public.pvr_comments(asset_id);
CREATE INDEX IF NOT EXISTS pvr_reviews_asset ON public.pvr_reviews(asset_id);
CREATE INDEX IF NOT EXISTS pvr_sessions_expiry ON public.pvr_sessions(expires_at);
ALTER TABLE public.pvr_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pvr_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pvr_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pvr_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pvr_owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pvr_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pvr_projects,public.pvr_assets,public.pvr_comments,public.pvr_reviews,public.pvr_owner,public.pvr_sessions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.pvr_projects,public.pvr_assets,public.pvr_comments,public.pvr_reviews,public.pvr_owner,public.pvr_sessions TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
