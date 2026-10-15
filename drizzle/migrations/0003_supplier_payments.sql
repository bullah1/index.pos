CREATE TABLE public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method pay_method NOT NULL DEFAULT 'cash',
  payment_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Dhaka'))::date,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_payments_supplier_idx ON public.supplier_payments(supplier_id, created_at);
GRANT SELECT ON public.supplier_payments TO authenticated;
GRANT ALL ON public.supplier_payments TO service_role;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mgr read" ON public.supplier_payments FOR SELECT TO authenticated USING (public.is_manager(auth.uid()));

CREATE OR REPLACE FUNCTION public.pay_supplier(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_sup uuid := (p->>'supplier_id')::uuid;
  v_amt numeric := round((p->>'amount')::numeric, 2);
  v_method pay_method := coalesce(nullif(p->>'method',''),'cash')::pay_method;
  v_total numeric; v_left numeric; v_take numeric; v_id uuid; r record;
BEGIN
  IF v_uid IS NULL OR NOT public.is_manager(v_uid) THEN RAISE EXCEPTION 'Not allowed: managers only'; END IF;
  IF v_key IS NULL THEN RAISE EXCEPTION 'Missing idempotency key'; END IF;
  SELECT id INTO v_id FROM supplier_payments WHERE idempotency_key = v_key;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('id', v_id, 'duplicate', true); END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'Amount must be more than 0'; END IF;
  PERFORM 1 FROM suppliers WHERE id = v_sup FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found'; END IF;
  SELECT coalesce(sum(total - paid),0) INTO v_total FROM purchases WHERE supplier_id = v_sup AND total > paid;
  IF v_amt > v_total THEN RAISE EXCEPTION 'Amount is more than the supplier balance (%)', v_total; END IF;
  INSERT INTO supplier_payments(idempotency_key, supplier_id, amount, method, payment_date, note, created_by)
  VALUES (v_key, v_sup, v_amt, v_method, coalesce((p->>'payment_date')::date, (now() AT TIME ZONE 'Asia/Dhaka')::date), nullif(p->>'note',''), v_uid)
  RETURNING id INTO v_id;
  v_left := v_amt;
  FOR r IN SELECT id, total - paid AS bal FROM purchases WHERE supplier_id = v_sup AND total > paid ORDER BY purchase_date, created_at FOR UPDATE LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_left, r.bal);
    UPDATE purchases SET paid = paid + v_take, updated_at = now() WHERE id = r.id;
    v_left := v_left - v_take;
  END LOOP;
  INSERT INTO audit_log(actor, action, entity, entity_id, details)
  VALUES (v_uid, 'pay_supplier', 'supplier', v_sup, jsonb_build_object('amount', v_amt, 'method', v_method));
  RETURN jsonb_build_object('id', v_id, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.pay_supplier(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pay_supplier(jsonb) TO authenticated;