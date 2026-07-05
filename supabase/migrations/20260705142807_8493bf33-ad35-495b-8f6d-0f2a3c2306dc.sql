CREATE TABLE IF NOT EXISTS public.provider_budget (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  monthly_cap integer NOT NULL DEFAULT 40000 CHECK (monthly_cap > 0),
  warn_at_percent integer NOT NULL DEFAULT 85 CHECK (warn_at_percent BETWEEN 1 AND 100),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT ON public.provider_budget TO authenticated;
GRANT ALL   ON public.provider_budget TO service_role;

ALTER TABLE public.provider_budget ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read provider_budget"
  ON public.provider_budget FOR SELECT TO authenticated USING (true);

CREATE POLICY "ops insert provider_budget"
  ON public.provider_budget FOR INSERT TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "ops update provider_budget"
  ON public.provider_budget FOR UPDATE TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE TRIGGER provider_budget_updated_at
  BEFORE UPDATE ON public.provider_budget
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.provider_budget (id, monthly_cap, warn_at_percent)
VALUES (true, 40000, 85)
ON CONFLICT (id) DO NOTHING;