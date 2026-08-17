DO $$
DECLARE
  uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = 'operator@instascanner.dev';
  IF uid IS NULL THEN RAISE EXCEPTION 'admin user not found'; END IF;

  UPDATE auth.users
  SET email = 'admin@instascanner.dev',
      encrypted_password = crypt('Pokemon2301%', gen_salt('bf')),
      email_confirmed_at = now(),
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"display_name":"Admin"}'::jsonb,
      updated_at = now()
  WHERE id = uid;

  UPDATE auth.identities
  SET identity_data = jsonb_build_object('sub', uid::text, 'email', 'admin@instascanner.dev', 'email_verified', true),
      updated_at = now()
  WHERE user_id = uid AND provider = 'email';

  UPDATE public.profiles
  SET email = 'admin@instascanner.dev', display_name = 'Admin'
  WHERE id = uid;
END $$;