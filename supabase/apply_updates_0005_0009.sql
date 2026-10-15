-- PharmaNest POS: all database updates 0005 → 0009 in one file.
-- Safe to run more than once. Run in the Supabase / Lovable Cloud SQL editor.

-- ===================== 0005_fixes.sql =====================
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

-- ===================== 0006_drawer_gate_expense_delete.sql =====================
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

-- ===================== 0007_sale_price_override.sql =====================
-- 0007: the counter can change the selling price of a line.
-- sale_items.unit_price is the price actually charged; list_price keeps the batch price for reports/audit.
-- Cashiers cannot sell below the batch cost; managers/admins can.

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS list_price numeric(14,2);
UPDATE public.sale_items SET list_price = unit_price WHERE list_price IS NULL;

CREATE OR REPLACE FUNCTION public.post_sale(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_existing record;
  v_id uuid; v_no text;
  it jsonb; pay jsonb; b record; m record;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_need numeric; v_take numeric; v_price numeric; v_line_disc numeric; v_ratio numeric;
  v_override numeric; v_mgr boolean;
  v_sub numeric(14,2) := 0; v_idisc numeric(14,2) := 0;
  v_bdisc numeric(14,2) := coalesce((p->>'bill_discount')::numeric, 0);
  v_paid numeric(14,2) := 0; v_total numeric(14,2);
  v_alloc numeric(14,2);
  v_cust uuid := nullif(p->>'customer_id','')::uuid;
begin
  if uid is null or not public.is_staff(uid) then raise exception 'Not allowed'; end if;
  v_mgr := public.is_manager(uid);
  if v_key is null then raise exception 'Missing idempotency key'; end if;
  select id, invoice_no into v_existing from sales where idempotency_key = v_key;
  if found then return jsonb_build_object('id', v_existing.id, 'invoice_no', v_existing.invoice_no, 'duplicate', true); end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Cart is empty'; end if;
  if v_bdisc < 0 then raise exception 'Invalid discount'; end if;

  v_id := gen_random_uuid();
  v_no := 'INV-' || lpad(nextval('invoice_no_seq')::text, 6, '0');
  insert into sales (id, invoice_no, idempotency_key, customer_id, subtotal, total, created_by)
  values (v_id, v_no, v_key, v_cust, 0, 0, uid);

  for it in select * from jsonb_array_elements(p->'items') loop
    v_need := (it->>'qty')::numeric;
    v_line_disc := coalesce((it->>'discount')::numeric, 0);
    v_override := round(nullif(it->>'unit_price','')::numeric, 2);
    if v_need is null or v_need <= 0 then raise exception 'Quantity must be positive'; end if;
    if v_line_disc < 0 then raise exception 'Invalid line discount'; end if;
    if v_override is not null and v_override < 0 then raise exception 'Price cannot be negative'; end if;
    select * into m from medicines where id = (it->>'medicine_id')::uuid;
    if not found or not m.is_active then raise exception 'Medicine not available'; end if;
    v_ratio := v_need;

    if (select coalesce(sum(qty_on_hand),0) from medicine_batches where medicine_id = m.id and expiry_date > v_today) < v_need then
      raise exception 'Insufficient stock for %', m.name;
    end if;
    for b in select * from medicine_batches
             where medicine_id = m.id and expiry_date > v_today and qty_on_hand > 0
             order by expiry_date, created_at for update loop
      exit when v_need <= 0;
      v_take := least(v_need, b.qty_on_hand);
      v_price := coalesce(v_override, b.sale_price);
      if v_override is not null and v_override < b.unit_cost and not v_mgr then
        raise exception 'Price % for % is below cost (%). Only a manager can sell below cost.', v_override, m.name, b.unit_cost;
      end if;
      v_alloc := round(v_line_disc * v_take / v_ratio, 2);
      update medicine_batches set qty_on_hand = qty_on_hand - v_take where id = b.id;
      insert into sale_items (sale_id, medicine_id, batch_id, medicine_name, batch_no, expiry_date, qty, unit_price, list_price, discount, unit_cost, line_total)
      values (v_id, m.id, b.id, m.name, b.batch_no, b.expiry_date, v_take, v_price, b.sale_price, v_alloc, b.unit_cost, round(v_take*v_price - v_alloc, 2));
      insert into stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
      values (b.id, m.id, 'sale', -v_take, 'sales', v_id, uid);
      if v_alloc > round(v_take*v_price,2) then raise exception 'Discount exceeds line amount for %', m.name; end if;
      v_sub := v_sub + round(v_take*v_price, 2); v_idisc := v_idisc + v_alloc;
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then raise exception 'Insufficient stock for %', m.name; end if;
    if v_override is not null then
      insert into audit_log (actor, action, entity, entity_id, details)
      values (uid, 'price_change', 'sales', v_id, jsonb_build_object('medicine', m.name, 'price', v_override, 'qty', v_ratio));
    end if;
  end loop;

  v_total := v_sub - v_idisc - v_bdisc;
  if v_total < 0 then raise exception 'Discount exceeds bill amount'; end if;

  for pay in select * from jsonb_array_elements(coalesce(p->'payments','[]'::jsonb)) loop
    if coalesce((pay->>'amount')::numeric,0) <= 0 then continue; end if;
    insert into sale_payments (sale_id, method, amount, kind, created_by)
    values (v_id, (pay->>'method')::pay_method, (pay->>'amount')::numeric, 'sale', uid);
    v_paid := v_paid + (pay->>'amount')::numeric;
  end loop;
  if v_paid > v_total then raise exception 'Paid amount (%) exceeds payable (%). Give change in cash outside the system.', v_paid, v_total; end if;
  if v_total - v_paid > 0 and v_cust is null then raise exception 'Select a customer for due/credit sales'; end if;

  update sales set subtotal = v_sub, item_discount = v_idisc, bill_discount = v_bdisc, total = v_total,
         paid = v_paid, due = v_total - v_paid where id = v_id;
  return jsonb_build_object('id', v_id, 'invoice_no', v_no, 'duplicate', false);
end $$;

revoke execute on function public.post_sale(jsonb) from public, anon;
grant execute on function public.post_sale(jsonb) to authenticated;

-- ===================== 0008_stock_adjustments.sql =====================
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

-- ===================== 0009_courier_orders.sql =====================
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

