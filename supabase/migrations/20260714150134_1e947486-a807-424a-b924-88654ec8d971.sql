
-- Restrict profiles SELECT to self only (removes operator-wide read of emails/telegram_chat_id)
DROP POLICY IF EXISTS "Owner or operator can view profiles" ON public.profiles;
CREATE POLICY "Owner can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Safe public view of non-sensitive profile fields for cross-operator UI (e.g. downloads log).
CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = true) AS
SELECT id, display_name, avatar_url
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO authenticated;

-- Allow authenticated users to read the safe columns via the view.
CREATE POLICY "Authenticated can view safe profile fields"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    current_setting('request.jwt.claims', true) IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      auth.uid() = id
    )
  );
