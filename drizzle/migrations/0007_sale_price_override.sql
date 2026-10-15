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
