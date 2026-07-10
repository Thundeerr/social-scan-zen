
DO $$
DECLARE
  new_user_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change,
    email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    'justinstinkt@instascanner.dev',
    crypt('justinhateinenkleinen', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Justinstinkt"}'::jsonb,
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    new_user_id,
    new_user_id::text,
    jsonb_build_object('sub', new_user_id::text, 'email', 'justinstinkt@instascanner.dev', 'email_verified', true),
    'email',
    now(), now(), now()
  );

  INSERT INTO public.profiles (id, email, display_name)
  VALUES (new_user_id, 'justinstinkt@instascanner.dev', 'Justinstinkt')
  ON CONFLICT (id) DO NOTHING;
END $$;
