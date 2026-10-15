-- 0009: courier bookings (Steadfast) from Sales History.

CREATE TABLE IF NOT EXISTS public.courier_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  provider text NOT NULL DEFAULT 'steadfast',
  consignment_id text NOT NULL,
  tracking_code text,
  courier_invoice text NOT NULL,
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  recipient_address text NOT NULL,
  cod_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (cod_amount >= 0),
  delivery_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  delivery_type smallint NOT NULL DEFAULT 0 CHECK (delivery_type IN (0, 1)),
  note text,
  status text NOT NULL DEFAULT 'in_review',
  status_checked_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One live booking per sale (a cancelled booking can be booked again).
CREATE UNIQUE INDEX IF NOT EXISTS courier_orders_one_live_per_sale
  ON public.courier_orders (sale_id) WHERE status NOT IN ('cancelled');
CREATE INDEX IF NOT EXISTS courier_orders_created_idx ON public.courier_orders (created_at DESC);

GRANT SELECT ON public.courier_orders TO authenticated;
GRANT ALL ON public.courier_orders TO service_role;
ALTER TABLE public.courier_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read" ON public.courier_orders;
CREATE POLICY "staff read" ON public.courier_orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id AND (public.is_manager(auth.uid()) OR s.created_by = auth.uid())));

-- Called by the server after Steadfast accepted the parcel.
CREATE OR REPLACE FUNCTION public.save_courier_order(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF uid IS NULL OR NOT public.is_staff(uid) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO courier_orders (sale_id, provider, consignment_id, tracking_code, courier_invoice, recipient_name, recipient_phone,
                              recipient_address, cod_amount, delivery_charge, delivery_type, note, status, created_by)
  VALUES ((p->>'sale_id')::uuid, coalesce(p->>'provider','steadfast'), p->>'consignment_id', nullif(p->>'tracking_code',''), p->>'courier_invoice',
          p->>'recipient_name', p->>'recipient_phone', p->>'recipient_address', coalesce((p->>'cod_amount')::numeric,0),
          coalesce((p->>'delivery_charge')::numeric,0), coalesce((p->>'delivery_type')::smallint,0), nullif(p->>'note',''),
          coalesce(nullif(p->>'status',''),'in_review'), uid)
  RETURNING id INTO v_id;
  INSERT INTO audit_log (actor, action, entity, entity_id, details)
  VALUES (uid, 'courier_book', 'sales', (p->>'sale_id')::uuid, jsonb_build_object('consignment_id', p->>'consignment_id', 'cod', p->>'cod_amount'));
  RETURN jsonb_build_object('id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.save_courier_order(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_courier_order(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_courier_status(p_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE courier_orders SET status = p_status, status_checked_at = now(), updated_at = now() WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.set_courier_status(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_courier_status(uuid, text) TO authenticated;
