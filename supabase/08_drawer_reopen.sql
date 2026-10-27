-- Let a manager reopen a drawer that was closed by mistake (counted cash is cleared; kept in the audit log).
CREATE OR REPLACE FUNCTION public.cash_drawer_reopen(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); r record;
BEGIN
  IF v_uid IS NULL OR NOT public.is_manager(v_uid) THEN RAISE EXCEPTION 'Only a manager can reopen a drawer'; END IF;
  SELECT * INTO r FROM cash_drawers WHERE id = (p->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Drawer not found'; END IF;
  IF r.closed_at IS NULL THEN RETURN jsonb_build_object('id', r.id, 'reopened', false); END IF;
  UPDATE cash_drawers SET closed_at = NULL, counted = NULL, updated_at = now() WHERE id = r.id;
  INSERT INTO audit_log(actor, action, entity, entity_id, details)
    VALUES (v_uid, 'cash_drawer_reopen', 'cash_drawer', r.id, jsonb_build_object('date', r.drawer_date, 'counted_was', r.counted, 'closed_was', r.closed_at));
  RETURN jsonb_build_object('id', r.id, 'reopened', true);
END $$;
REVOKE ALL ON FUNCTION public.cash_drawer_reopen(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cash_drawer_reopen(jsonb) TO authenticated;
