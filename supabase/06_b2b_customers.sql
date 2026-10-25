-- B2B (wholesale) customers: type, business name, default discount from MRP, and credit (due) limit.
-- Safe to run more than once.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS customer_type text NOT NULL DEFAULT 'retail';
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_customer_type_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_customer_type_check CHECK (customer_type IN ('retail','b2b'));
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS business_name text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS discount_pct numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_discount_pct_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_discount_pct_check CHECK (discount_pct >= 0 AND discount_pct < 100);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS credit_limit numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_credit_limit_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_credit_limit_check CHECK (credit_limit >= 0);
