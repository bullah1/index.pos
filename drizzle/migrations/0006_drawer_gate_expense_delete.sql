-- 0006: no money movement unless the staff member's cash drawer is open today; managers can delete expenses.

-- True when this user opened a drawer today (Bangladesh date) and has not closed it yet.
CREATE OR REPLACE FUNCTION public.drawer_is_open(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cash_drawers
    WHERE user_id = _user_id
      AND drawer_date = (now() AT TIME ZONE 'Asia/Dhaka')::date
      AND closed_at IS NULL
  )
$$;
REVOKE ALL ON FUNCTION public.drawer_is_open(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.drawer_is_open(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.require_open_drawer()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Backend jobs (no signed-in user) are not blocked.
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF NOT public.drawer_is_open(auth.uid()) THEN
    RAISE EXCEPTION 'Cash drawer is not open. Open your cash drawer for today first (Cash Drawer page).'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- One trigger function guards every table where money or stock moves.
CREATE OR REPLACE FUNCTION public.guard_open_drawer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_open_drawer();
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS t_drawer_sales ON public.sales;
CREATE TRIGGER t_drawer_sales BEFORE INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION public.guard_open_drawer();
DROP TRIGGER IF EXISTS t_drawer_purchases ON public.purchases;
CREATE TRIGGER t_drawer_purchases BEFORE INSERT ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.guard_open_drawer();
DROP TRIGGER IF EXISTS t_drawer_returns ON public.sale_returns;
CREATE TRIGGER t_drawer_returns BEFORE INSERT ON public.sale_returns FOR EACH ROW EXECUTE FUNCTION public.guard_open_drawer();
DROP TRIGGER IF EXISTS t_drawer_custpay ON public.customer_payments;
CREATE TRIGGER t_drawer_custpay BEFORE INSERT ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION public.guard_open_drawer();
DROP TRIGGER IF EXISTS t_drawer_suppay ON public.supplier_payments;
CREATE TRIGGER t_drawer_suppay BEFORE INSERT ON public.supplier_payments FOR EACH ROW EXECUTE FUNCTION public.guard_open_drawer();
DROP TRIGGER IF EXISTS t_drawer_expenses ON public.expenses;
CREATE TRIGGER t_drawer_expenses BEFORE INSERT OR DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.guard_open_drawer();

-- Managers can remove a wrong expense. The full row is kept in the audit log.
CREATE OR REPLACE FUNCTION public.delete_expense(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.expenses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_manager(auth.uid()) THEN RAISE EXCEPTION 'Not allowed: managers only'; END IF;
  PERFORM public.require_open_drawer();
  DELETE FROM public.expenses WHERE id = p_id RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  INSERT INTO public.audit_log (actor, action, entity, entity_id, details)
  VALUES (auth.uid(), 'delete_expense', 'expenses', p_id, to_jsonb(r));
END $$;
REVOKE ALL ON FUNCTION public.delete_expense(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_expense(uuid) TO authenticated;
