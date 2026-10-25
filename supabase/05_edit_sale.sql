-- Edit a sale safely: the old invoice is cancelled (items back to stock, money refunded / due cleared)
-- and the corrected sale is posted as a new invoice — both in ONE step, so it never half-saves.
CREATE OR REPLACE FUNCTION public.edit_sale(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old record; v_new jsonb; v_cancel jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_manager(auth.uid()) THEN RAISE EXCEPTION 'Not allowed: managers only'; END IF;
  SELECT id, invoice_no, status, returned_amount INTO v_old FROM sales WHERE id = (p->>'sale_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  -- same request sent twice: the new invoice already exists
  IF v_old.status = 'cancelled' AND EXISTS (SELECT 1 FROM sales WHERE idempotency_key = ((p->'sale')->>'idempotency_key')::uuid) THEN
    RETURN public.post_sale(p->'sale');
  END IF;
  IF v_old.status <> 'completed' OR v_old.returned_amount > 0 THEN
    RAISE EXCEPTION 'Only a sale without returns can be edited (%)', v_old.invoice_no;
  END IF;
  v_cancel := public.return_sale(jsonb_build_object(
    'idempotency_key', p->>'cancel_key', 'sale_id', v_old.id, 'cancel', true,
    'refund_method', coalesce(nullif(p->>'refund_method',''), 'cash'),
    'reason', 'Edited'));
  v_new := public.post_sale(p->'sale');
  INSERT INTO audit_log (actor, action, entity, entity_id, details)
    VALUES (auth.uid(), 'edit_sale', 'sales', v_old.id, jsonb_build_object('old', v_old.invoice_no, 'new', v_new->>'invoice_no'));
  RETURN v_new || jsonb_build_object('replaced', v_old.invoice_no);
END $$;
REVOKE ALL ON FUNCTION public.edit_sale(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.edit_sale(jsonb) TO authenticated;
