-- Add nickname profiles without changing existing projects, feedback or passwords.
BEGIN;
CREATE TABLE IF NOT EXISTS public.pvr_profiles (
  id text PRIMARY KEY,
  nickname text NOT NULL CHECK(length(nickname) BETWEEN 1 AND 80),
  nickname_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pvr_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pvr_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pvr_profiles TO service_role;
ALTER TABLE public.pvr_sessions
  ADD COLUMN IF NOT EXISTS profile_id text REFERENCES public.pvr_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pvr_sessions_profile ON public.pvr_sessions(profile_id);
NOTIFY pgrst, 'reload schema';
COMMIT;
