-- Quotations (price offers) for B2B / wholesale customers. A quotation does not touch stock or money;
-- when the customer confirms, it is opened in the POS and sold as a normal bill.
-- Safe to run more than once.
CREATE SEQUENCE IF NOT EXISTS public.quotation_no_seq;
CREATE TABLE IF NOT EXISTS public.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_no text NOT NULL UNIQUE DEFAULT ('Q-' || lpad(nextval('public.quotation_no_seq')::text, 5, '0')),
  customer_id uuid REFERENCES public.customers(id),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  note text,
  valid_until date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted','cancelled')),
  sale_id uuid REFERENCES public.sales(id),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotations_created_idx ON public.quotations (created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.quotations TO authenticated;
GRANT USAGE ON SEQUENCE public.quotation_no_seq TO authenticated;
GRANT ALL ON public.quotations TO service_role;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read quotations" ON public.quotations;
CREATE POLICY "staff read quotations" ON public.quotations FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "staff add quotations" ON public.quotations;
CREATE POLICY "staff add quotations" ON public.quotations FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()) AND created_by = auth.uid());
DROP POLICY IF EXISTS "staff update quotations" ON public.quotations;
CREATE POLICY "staff update quotations" ON public.quotations FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS t_quotations_touch ON public.quotations;
CREATE TRIGGER t_quotations_touch BEFORE UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
