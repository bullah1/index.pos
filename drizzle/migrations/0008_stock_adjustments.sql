-- 0008: stock adjustments (count correction, damage, expiry disposal, loss, opening stock) with a full history.

CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adj_no text NOT NULL UNIQUE,
  idempotency_key uuid NOT NULL UNIQUE,
  batch_id uuid NOT NULL REFERENCES public.medicine_batches(id),
  medicine_id uuid NOT NULL REFERENCES public.medicines(id),
  qty_before numeric(14,3) NOT NULL,
  qty_change numeric(14,3) NOT NULL CHECK (qty_change <> 0),
  qty_after numeric(14,3) NOT NULL CHECK (qty_after >= 0),
  unit_cost numeric(14,2) NOT NULL,
  reason text NOT NULL CHECK (reason IN ('count','damaged','expired','lost','opening','return_to_supplier','other')),
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_adjustments_created_idx ON public.stock_adjustments (created_at DESC);
CREATE SEQUENCE IF NOT EXISTS public.adjustment_no_seq;
GRANT SELECT ON public.stock_adjustments TO authenticated;
GRANT ALL ON public.stock_adjustments TO service_role;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mgr read" ON public.stock_adjustments;
CREATE POLICY "mgr read" ON public.stock_adjustments FOR SELECT TO authenticated USING (public.is_manager(auth.uid()));

-- Same open-drawer rule as every other stock/money change.
DROP TRIGGER IF EXISTS t_drawer_adjust ON public.stock_adjustments;
CREATE TRIGGER t_drawer_adjust BEFORE INSERT ON public.stock_adjustments FOR EACH ROW EXECUTE FUNCTION public.guard_open_drawer();

/*
  adjust_stock(p):
    Existing batch: { idempotency_key, batch_id, mode: 'set'|'add'|'remove', qty, reason, note }
      set    -> qty is the counted quantity now on the shelf
      add    -> qty is added
      remove -> qty is taken out
    New batch (opening stock / found stock): { idempotency_key, medicine_id, batch_no, expiry_date, unit_cost, sale_price, qty, reason, note }
*/
CREATE OR REPLACE FUNCTION public.adjust_stock(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_mode text := coalesce(nullif(p->>'mode',''), 'set');
  v_qty numeric := (p->>'qty')::numeric;
  v_reason text := coalesce(nullif(p->>'reason',''), 'count');
  v_note text := nullif(trim(coalesce(p->>'note','')), '');
  b record; ex record;
  v_batch uuid; v_med uuid; v_before numeric; v_change numeric; v_after numeric; v_cost numeric;
  v_id uuid := gen_random_uuid(); v_no text;
BEGIN
  IF uid IS NULL OR NOT public.is_manager(uid) THEN RAISE EXCEPTION 'Not allowed: managers only'; END IF;
  IF v_key IS NULL THEN RAISE EXCEPTION 'Missing idempotency key'; END IF;
  SELECT id, adj_no INTO ex FROM stock_adjustments WHERE idempotency_key = v_key;
  IF FOUND THEN RETURN jsonb_build_object('id', ex.id, 'adj_no', ex.adj_no, 'duplicate', true); END IF;
  IF v_qty IS NULL OR v_qty < 0 THEN RAISE EXCEPTION 'Enter a quantity (0 or more)'; END IF;
  IF v_reason NOT IN ('count','damaged','expired','lost','opening','return_to_supplier','other') THEN RAISE EXCEPTION 'Unknown reason'; END IF;
  IF v_reason = 'other' AND v_note IS NULL THEN RAISE EXCEPTION 'Write a note for "Other"'; END IF;

  IF nullif(p->>'batch_id','') IS NOT NULL THEN
    SELECT * INTO b FROM medicine_batches WHERE id = (p->>'batch_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found'; END IF;
    v_batch := b.id; v_med := b.medicine_id; v_before := b.qty_on_hand; v_cost := b.unit_cost;
    v_change := CASE v_mode
      WHEN 'set' THEN v_qty - v_before
      WHEN 'add' THEN v_qty
      WHEN 'remove' THEN -v_qty
      ELSE NULL END;
    IF v_change IS NULL THEN RAISE EXCEPTION 'Mode must be set, add or remove'; END IF;
  ELSE
    -- new batch
    v_med := (p->>'medicine_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM medicines WHERE id = v_med) THEN RAISE EXCEPTION 'Medicine not found'; END IF;
    IF nullif(trim(p->>'batch_no'),'') IS NULL THEN RAISE EXCEPTION 'Batch number required'; END IF;
    IF nullif(p->>'expiry_date','') IS NULL THEN RAISE EXCEPTION 'Expiry date required'; END IF;
    v_cost := (p->>'unit_cost')::numeric;
    IF v_cost IS NULL OR v_cost < 0 OR coalesce((p->>'sale_price')::numeric, -1) < 0 THEN RAISE EXCEPTION 'Enter cost and sale price'; END IF;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be more than 0'; END IF;
    INSERT INTO medicine_batches (medicine_id, batch_no, expiry_date, unit_cost, sale_price, qty_on_hand)
    VALUES (v_med, trim(p->>'batch_no'), (p->>'expiry_date')::date, v_cost, (p->>'sale_price')::numeric, 0)
    ON CONFLICT (medicine_id, batch_no) DO NOTHING
    RETURNING id INTO v_batch;
    IF v_batch IS NULL THEN RAISE EXCEPTION 'Batch % already exists for this medicine — adjust that batch instead', trim(p->>'batch_no'); END IF;
    v_before := 0; v_change := v_qty;
  END IF;

  IF v_change = 0 THEN RAISE EXCEPTION 'No change: the quantity is the same as now'; END IF;
  v_after := v_before + v_change;
  IF v_after < 0 THEN RAISE EXCEPTION 'Cannot remove % — only % in this batch', -v_change, v_before; END IF;

  v_no := 'ADJ-' || lpad(nextval('adjustment_no_seq')::text, 6, '0');
  INSERT INTO stock_adjustments (id, adj_no, idempotency_key, batch_id, medicine_id, qty_before, qty_change, qty_after, unit_cost, reason, note, created_by)
  VALUES (v_id, v_no, v_key, v_batch, v_med, v_before, v_change, v_after, v_cost, v_reason, v_note, uid);
  UPDATE medicine_batches SET qty_on_hand = v_after WHERE id = v_batch;
  INSERT INTO stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
  VALUES (v_batch, v_med, 'adjustment', v_change, 'stock_adjustments', v_id, uid);
  INSERT INTO audit_log (actor, action, entity, entity_id, details)
  VALUES (uid, 'adjust_stock', 'medicine_batches', v_batch,
          jsonb_build_object('adj_no', v_no, 'before', v_before, 'change', v_change, 'after', v_after, 'reason', v_reason));
  RETURN jsonb_build_object('id', v_id, 'adj_no', v_no, 'qty_after', v_after, 'change', v_change, 'duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.adjust_stock(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(jsonb) TO authenticated;
