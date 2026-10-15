CREATE TABLE public.customer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method public.pay_method NOT NULL DEFAULT 'cash',
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.customer_payments TO authenticated;
GRANT ALL ON public.customer_payments TO service_role;
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read" ON public.customer_payments FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.customer_dues()
RETURNS TABLE(customer_id uuid, due numeric, open_invoices bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.customer_id, sum(s.due), count(*) FROM sales s
  WHERE public.is_staff(auth.uid()) AND s.customer_id IS NOT NULL AND s.due > 0
  GROUP BY s.customer_id
$$;
REVOKE ALL ON FUNCTION public.customer_dues() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.customer_dues() TO authenticated;

CREATE OR REPLACE FUNCTION public.collect_due(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_cust uuid := (p->>'customer_id')::uuid;
  v_amt numeric := round((p->>'amount')::numeric, 2);
  v_method pay_method := coalesce(p->>'method','cash')::pay_method;
  v_total numeric; v_left numeric; v_take numeric; v_id uuid; r record;
BEGIN
  IF NOT public.is_staff(v_uid) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT id INTO v_id FROM customer_payments WHERE idempotency_key = v_key;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('id', v_id, 'duplicate', true); END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'Amount must be more than 0'; END IF;
  PERFORM 1 FROM customers WHERE id = v_cust FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found'; END IF;
  SELECT coalesce(sum(due),0) INTO v_total FROM sales WHERE customer_id = v_cust AND due > 0;
  IF v_amt > v_total THEN RAISE EXCEPTION 'Amount is more than the due (%)', v_total; END IF;
  INSERT INTO customer_payments(idempotency_key, customer_id, amount, method, note, created_by)
    VALUES (v_key, v_cust, v_amt, v_method, nullif(p->>'note',''), v_uid) RETURNING id INTO v_id;
  v_left := v_amt;
  FOR r IN SELECT id, due FROM sales WHERE customer_id = v_cust AND due > 0 ORDER BY created_at FOR UPDATE LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, r.due);
    UPDATE sales SET due = due - v_take, paid = paid + v_take, updated_at = now() WHERE id = r.id;
    INSERT INTO sale_payments(sale_id, method, amount, kind, created_by) VALUES (r.id, v_method, v_take, 'due_collection', v_uid);
    v_left := v_left - v_take;
  END LOOP;
  INSERT INTO audit_log(actor, action, entity, entity_id, details)
    VALUES (v_uid, 'collect_due', 'customer', v_cust, jsonb_build_object('amount', v_amt, 'method', v_method));
  RETURN jsonb_build_object('id', v_id, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.collect_due(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.collect_due(jsonb) TO authenticated;