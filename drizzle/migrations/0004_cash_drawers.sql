CREATE TABLE public.cash_drawers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drawer_date date NOT NULL DEFAULT (now() at time zone 'Asia/Dhaka')::date,
  user_id uuid NOT NULL,
  opening numeric(14,2) NOT NULL DEFAULT 0 CHECK (opening >= 0),
  counted numeric(14,2) CHECK (counted >= 0),
  note text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (drawer_date, user_id)
);
CREATE INDEX cash_drawers_date_idx ON public.cash_drawers (drawer_date);

GRANT SELECT ON public.cash_drawers TO authenticated;
GRANT ALL ON public.cash_drawers TO service_role;
ALTER TABLE public.cash_drawers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or manager read" ON public.cash_drawers FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_manager(auth.uid()));

CREATE TRIGGER cash_drawers_touch BEFORE UPDATE ON public.cash_drawers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.cash_drawer_open(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_date date := coalesce(nullif(p->>'date','')::date, (now() at time zone 'Asia/Dhaka')::date);
  v_open numeric := round(coalesce(nullif(p->>'opening','')::numeric, 0), 2);
  v_note text := nullif(p->>'note','');
  v_id uuid; v_opened timestamptz;
BEGIN
  IF NOT public.is_staff(v_uid) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF v_open < 0 THEN RAISE EXCEPTION 'Opening cash cannot be negative'; END IF;
  SELECT id, closed_at INTO v_id, v_opened FROM cash_drawers WHERE drawer_date = v_date AND user_id = v_uid;
  IF v_id IS NOT NULL AND v_opened IS NOT NULL THEN RAISE EXCEPTION 'Drawer is already closed for this day'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO cash_drawers (drawer_date, user_id, opening, note) VALUES (v_date, v_uid, v_open, v_note) RETURNING id INTO v_id;
  ELSE
    UPDATE cash_drawers SET opening = v_open, note = coalesce(v_note, note), updated_at = now() WHERE id = v_id;
  END IF;
  INSERT INTO audit_log(actor, action, entity, entity_id, details)
    VALUES (v_uid, 'cash_drawer_open', 'cash_drawer', v_id, jsonb_build_object('date', v_date, 'opening', v_open));
  RETURN jsonb_build_object('id', v_id, 'opening', v_open, 'date', v_date);
END $$;
REVOKE ALL ON FUNCTION public.cash_drawer_open(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cash_drawer_open(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_drawer_close(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := (p->>'id')::uuid;
  v_counted numeric := round((p->>'counted')::numeric, 2);
  v_note text := nullif(p->>'note','');
  v_row cash_drawers%ROWTYPE;
BEGIN
  IF NOT public.is_staff(v_uid) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Drawer not found'; END IF;
  IF v_counted IS NULL OR v_counted < 0 THEN RAISE EXCEPTION 'Counted cash must be 0 or more'; END IF;
  SELECT * INTO v_row FROM cash_drawers WHERE id = v_id AND (user_id = v_uid OR public.is_manager(v_uid));
  IF NOT FOUND THEN RAISE EXCEPTION 'Drawer not found'; END IF;
  IF v_row.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Drawer is already closed for this day'; END IF;
  UPDATE cash_drawers SET counted = v_counted, note = coalesce(v_note, note), closed_at = now(), updated_at = now()
    WHERE id = v_id RETURNING * INTO v_row;
  INSERT INTO audit_log(actor, action, entity, entity_id, details)
    VALUES (v_uid, 'cash_drawer_close', 'cash_drawer', v_id, jsonb_build_object('date', v_row.drawer_date, 'counted', v_counted));
  RETURN jsonb_build_object('id', v_id, 'counted', v_counted, 'closed_at', v_row.closed_at);
END $$;
REVOKE ALL ON FUNCTION public.cash_drawer_close(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cash_drawer_close(jsonb) TO authenticated;