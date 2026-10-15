-- 0005: fixes found in the POS audit
-- 1) Returns/cancellations always failed: return_sale writes statuses and movement types the checks did not allow.
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_status_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_status_check
  CHECK (status IN ('completed','partially_returned','returned','cancelled'));

ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN ('purchase','sale','return','cancel','sale_return','sale_cancel','purchase_cancel','adjustment'));

-- 2) Blank phone numbers collided on the unique index; store them as NULL.
CREATE OR REPLACE FUNCTION public.clean_customer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.name := trim(NEW.name);
  NEW.phone := nullif(regexp_replace(coalesce(NEW.phone, ''), '\s', '', 'g'), '');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t_cus_clean ON public.customers;
CREATE TRIGGER t_cus_clean BEFORE INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.clean_customer();
UPDATE public.customers SET phone = NULL WHERE phone IS NOT NULL AND trim(phone) = '';

-- Blank barcode / code must not block other medicines either.
CREATE OR REPLACE FUNCTION public.clean_medicine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.name := trim(NEW.name);
  NEW.barcode := nullif(trim(coalesce(NEW.barcode, '')), '');
  NEW.code := nullif(trim(coalesce(NEW.code, '')), '');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t_med_clean ON public.medicines;
CREATE TRIGGER t_med_clean BEFORE INSERT OR UPDATE ON public.medicines FOR EACH ROW EXECUTE FUNCTION public.clean_medicine();

-- 3) Security: anyone who signed up on the public site became a cashier and could sell stock.
--    Now only the very first account is admin; everyone else waits until an admin gives them a role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'full_name', ''), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END $$;

-- Admin sees every role (needed for the Staff page)
DROP POLICY IF EXISTS "read own or admin roles" ON public.user_roles;
CREATE POLICY "read own or admin roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Admin assigns one role per staff member (NULL removes access). The last admin cannot be removed.
CREATE OR REPLACE FUNCTION public.admin_set_role(p_user uuid, p_role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not allowed: admins only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user) THEN RAISE EXCEPTION 'User not found'; END IF;
  IF public.has_role(p_user, 'admin') AND (p_role IS NULL OR p_role <> 'admin')
     AND (SELECT count(*) FROM public.user_roles WHERE role = 'admin') <= 1 THEN
    RAISE EXCEPTION 'Keep at least one admin';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = p_user;
  IF p_role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (p_user, p_role);
  END IF;
  INSERT INTO public.audit_log (actor, action, entity, entity_id, details)
  VALUES (auth.uid(), 'set_role', 'user', p_user, jsonb_build_object('role', p_role));
END $$;
REVOKE ALL ON FUNCTION public.admin_set_role(uuid, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role) TO authenticated;

-- 4) Settings row must always exist (receipt header, thresholds).
INSERT INTO public.settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
