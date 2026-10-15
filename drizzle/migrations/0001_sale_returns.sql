alter table public.sale_items add column returned_qty numeric(14,3) not null default 0;
alter table public.sales add column returned_amount numeric(14,2) not null default 0;
alter table public.sales add column refunded numeric(14,2) not null default 0;
create sequence if not exists public.return_no_seq;

create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  return_no text not null unique,
  idempotency_key uuid not null unique,
  sale_id uuid not null references public.sales(id),
  kind text not null default 'return',
  amount numeric(14,2) not null,
  due_reduced numeric(14,2) not null default 0,
  refund numeric(14,2) not null default 0,
  refund_method pay_method,
  reason text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns(id),
  sale_item_id uuid not null references public.sale_items(id),
  batch_id uuid not null references public.medicine_batches(id),
  qty numeric(14,3) not null,
  amount numeric(14,2) not null
);
grant select on public.sale_returns, public.sale_return_items to authenticated;
grant all on public.sale_returns, public.sale_return_items to service_role;
alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;
create policy "staff read" on public.sale_returns for select to authenticated
  using (exists (select 1 from sales s where s.id = sale_id and (public.is_manager(auth.uid()) or s.created_by = auth.uid())));
create policy "staff read" on public.sale_return_items for select to authenticated
  using (exists (select 1 from sale_returns r join sales s on s.id = r.sale_id where r.id = return_id and (public.is_manager(auth.uid()) or s.created_by = auth.uid())));

create or replace function public.return_sale(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_cancel boolean := coalesce((p->>'cancel')::boolean, false);
  v_method pay_method := coalesce(nullif(p->>'refund_method',''), 'cash')::pay_method;
  s record; si record; it jsonb; ex record;
  v_id uuid := gen_random_uuid(); v_no text;
  v_net numeric; v_factor numeric; v_qty numeric; v_amt numeric(14,2); v_total numeric(14,2) := 0;
  v_due numeric(14,2); v_refund numeric(14,2); v_left numeric;
begin
  if uid is null or not public.is_manager(uid) then raise exception 'Not allowed: managers only'; end if;
  if v_key is null then raise exception 'Missing idempotency key'; end if;
  select id, return_no into ex from sale_returns where idempotency_key = v_key;
  if found then return jsonb_build_object('id', ex.id, 'return_no', ex.return_no, 'duplicate', true); end if;
  select * into s from sales where id = (p->>'sale_id')::uuid for update;
  if not found then raise exception 'Sale not found'; end if;
  if s.status = 'cancelled' then raise exception 'Sale is already cancelled'; end if;
  if v_cancel and s.returned_amount > 0 then raise exception 'Sale has returns; return the remaining items instead'; end if;

  v_no := 'RET-' || lpad(nextval('return_no_seq')::text, 6, '0');
  insert into sale_returns (id, return_no, idempotency_key, sale_id, kind, amount, refund_method, reason, created_by)
  values (v_id, v_no, v_key, s.id, case when v_cancel then 'cancel' else 'return' end, 0, v_method, nullif(trim(p->>'reason'),''), uid);

  v_net := s.subtotal - s.item_discount;
  v_factor := case when v_net > 0 then (v_net - s.bill_discount) / v_net else 0 end;

  for si in select * from sale_items where sale_id = s.id order by id for update loop
    v_left := si.qty - si.returned_qty;
    if v_cancel then v_qty := v_left;
    else
      select coalesce(sum((x->>'qty')::numeric),0) into v_qty from jsonb_array_elements(coalesce(p->'items','[]')) x
        where (x->>'sale_item_id')::uuid = si.id;
    end if;
    continue when v_qty is null or v_qty = 0;
    if v_qty < 0 then raise exception 'Quantity must be positive'; end if;
    if v_qty > v_left then raise exception 'Cannot return % of % — only % left to return', v_qty, si.medicine_name, v_left; end if;
    v_amt := round(si.line_total * v_qty / si.qty * v_factor, 2);
    update sale_items set returned_qty = returned_qty + v_qty where id = si.id;
    update medicine_batches set qty_on_hand = qty_on_hand + v_qty where id = si.batch_id;
    insert into stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
    values (si.batch_id, si.medicine_id, case when v_cancel then 'cancel' else 'return' end, v_qty, 'sale_returns', v_id, uid);
    insert into sale_return_items (return_id, sale_item_id, batch_id, qty, amount) values (v_id, si.id, si.batch_id, v_qty, v_amt);
    v_total := v_total + v_amt;
  end loop;
  if v_total = 0 and not exists (select 1 from sale_return_items where return_id = v_id) then raise exception 'Select at least one item to return'; end if;

  -- last items back: settle exact remaining value to avoid rounding leftovers
  if not exists (select 1 from sale_items where sale_id = s.id and returned_qty < qty) then
    v_total := s.total - s.returned_amount;
  end if;
  v_due := least(s.due, v_total);
  v_refund := v_total - v_due;
  if v_refund > s.paid - s.refunded then v_refund := s.paid - s.refunded; end if;
  if v_refund > 0 then
    insert into sale_payments (sale_id, method, amount, kind, created_by) values (s.id, v_method, v_refund, 'refund', uid);
  end if;
  update sale_returns set amount = v_total, due_reduced = v_due, refund = v_refund where id = v_id;
  update sales set returned_amount = returned_amount + v_total, refunded = refunded + v_refund, due = due - v_due,
    status = case when v_cancel then 'cancelled'
                  when not exists (select 1 from sale_items where sale_id = s.id and returned_qty < qty) then 'returned'
                  else 'partially_returned' end
  where id = s.id;
  insert into audit_log (actor, action, entity, entity_id, details)
  values (uid, case when v_cancel then 'cancel_sale' else 'return_sale' end, 'sales', s.id, jsonb_build_object('return_no', v_no, 'amount', v_total));
  return jsonb_build_object('id', v_id, 'return_no', v_no, 'amount', v_total, 'refund', v_refund, 'due_reduced', v_due, 'duplicate', false);
end $$;
revoke all on function public.return_sale(jsonb) from public, anon;
grant execute on function public.return_sale(jsonb) to authenticated;