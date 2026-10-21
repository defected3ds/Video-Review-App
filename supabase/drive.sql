-- Add to an existing workspace that already ran schema.sql.
-- OAuth refresh tokens and state are encrypted by the application.
BEGIN;
CREATE TABLE IF NOT EXISTS public.pvr_connections (id text PRIMARY KEY, payload text NOT NULL, expires_at bigint);
ALTER TABLE public.pvr_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pvr_connections FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.pvr_connections TO service_role;
CREATE INDEX IF NOT EXISTS pvr_connections_expiry ON public.pvr_connections(expires_at);
NOTIFY pgrst, 'reload schema';
COMMIT;
