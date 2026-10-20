-- index-pos: FULL database setup for a NEW, empty Supabase project.
-- Supabase Dashboard -> SQL Editor -> paste all -> Run. Run once.

-- ===================== 0000_pos_core.sql =====================

create type public.app_role as enum ('admin','manager','cashier');
create type public.pay_method as enum ('cash','bkash','nagad','rocket','bank');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id)
$$;
create or replace function public.is_manager(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin','manager'))
$$;

create policy "staff read profiles" on public.profiles for select to authenticated using (public.is_staff(auth.uid()) or id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "read own or admin roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

-- first user becomes admin, others cashier
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email);
  if not exists (select 1 from public.user_roles) then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'cashier');
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table public.settings (
  id int primary key default 1 check (id = 1),
  pharmacy_name text not null default 'My Pharmacy',
  address text not null default '',
  phone text not null default '',
  invoice_footer text not null default 'Thank you. Get well soon!',
  currency text not null default 'BDT',
  receipt_format text not null default 'thermal' check (receipt_format in ('thermal','a4')),
  low_stock_threshold int not null default 10 check (low_stock_threshold >= 0),
  expiry_alert_days int not null default 90 check (expiry_alert_days >= 0),
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);
grant select, update on public.settings to authenticated;
grant all on public.settings to service_role;
alter table public.settings enable row level security;
create policy "staff read settings" on public.settings for select to authenticated using (public.is_staff(auth.uid()));
create policy "admin update settings" on public.settings for update to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text, address text, notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null check (length(trim(name)) > 0),
  name_bn text,
  generic_name text,
  manufacturer text,
  category text,
  strength text,
  dosage_form text,
  sale_unit text not null default 'pcs',
  barcode text unique,
  prescription_required boolean not null default false,
  default_price numeric(14,2) not null default 0 check (default_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index medicines_name_idx on public.medicines (lower(name));
create index medicines_generic_idx on public.medicines (lower(generic_name));

create table public.medicine_batches (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id) on delete restrict,
  batch_no text not null,
  expiry_date date not null,
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  sale_price numeric(14,2) not null check (sale_price >= 0),
  qty_on_hand numeric(14,3) not null default 0 check (qty_on_hand >= 0),
  supplier_id uuid references public.suppliers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (medicine_id, batch_no)
);
create index batches_fefo_idx on public.medicine_batches (medicine_id, expiry_date);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text unique,
  address text, notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.purchase_no_seq;
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_no text not null unique,
  idempotency_key uuid not null unique,
  supplier_id uuid not null references public.suppliers(id),
  supplier_invoice_no text,
  purchase_date date not null default (now() at time zone 'Asia/Dhaka')::date,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null check (total >= 0),
  paid numeric(14,2) not null default 0 check (paid >= 0),
  status text not null default 'posted' check (status in ('posted','cancelled')),
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (paid <= total)
);
create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  medicine_id uuid not null references public.medicines(id),
  batch_id uuid not null references public.medicine_batches(id),
  batch_no text not null,
  expiry_date date not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  sale_price numeric(14,2) not null check (sale_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);
create index purchase_items_purchase_idx on public.purchase_items (purchase_id);

create sequence public.invoice_no_seq;
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  idempotency_key uuid not null unique,
  customer_id uuid references public.customers(id),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  item_discount numeric(14,2) not null default 0 check (item_discount >= 0),
  bill_discount numeric(14,2) not null default 0 check (bill_discount >= 0),
  total numeric(14,2) not null check (total >= 0),
  paid numeric(14,2) not null default 0 check (paid >= 0),
  due numeric(14,2) not null default 0 check (due >= 0),
  status text not null default 'completed' check (status in ('completed','cancelled')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sales_created_idx on public.sales (created_at desc);
create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  medicine_id uuid not null references public.medicines(id),
  batch_id uuid not null references public.medicine_batches(id),
  medicine_name text not null,
  batch_no text not null,
  expiry_date date not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  method public.pay_method not null,
  amount numeric(14,2) not null check (amount > 0),
  kind text not null default 'sale' check (kind in ('sale','due_collection','refund')),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index sale_payments_sale_idx on public.sale_payments (sale_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default (now() at time zone 'Asia/Dhaka')::date,
  method public.pay_method not null default 'cash',
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.medicine_batches(id),
  medicine_id uuid not null references public.medicines(id),
  movement_type text not null check (movement_type in ('purchase','sale','sale_return','sale_cancel','purchase_cancel','adjustment')),
  qty_change numeric(14,3) not null check (qty_change <> 0),
  ref_table text, ref_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index stock_movements_batch_idx on public.stock_movements (batch_id, created_at);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid, action text not null, entity text, entity_id uuid, details jsonb,
  created_at timestamptz not null default now()
);

-- timestamps
create trigger t_med before update on public.medicines for each row execute function public.touch_updated_at();
create trigger t_bat before update on public.medicine_batches for each row execute function public.touch_updated_at();
create trigger t_sup before update on public.suppliers for each row execute function public.touch_updated_at();
create trigger t_cus before update on public.customers for each row execute function public.touch_updated_at();
create trigger t_prof before update on public.profiles for each row execute function public.touch_updated_at();

-- grants: reads for staff; direct writes only on master data
grant select, insert, update on public.medicines, public.suppliers, public.customers to authenticated;
grant select on public.medicine_batches, public.purchases, public.purchase_items, public.sales, public.sale_items, public.sale_payments, public.stock_movements to authenticated;
grant select, insert on public.expenses to authenticated;
grant select on public.audit_log to authenticated;
grant all on public.medicines, public.suppliers, public.customers, public.medicine_batches, public.purchases, public.purchase_items, public.sales, public.sale_items, public.sale_payments, public.stock_movements, public.expenses, public.audit_log to service_role;

alter table public.medicines enable row level security;
alter table public.suppliers enable row level security;
alter table public.customers enable row level security;
alter table public.medicine_batches enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
alter table public.stock_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_log enable row level security;

create policy "staff read" on public.medicines for select to authenticated using (public.is_staff(auth.uid()));
create policy "mgr insert" on public.medicines for insert to authenticated with check (public.is_manager(auth.uid()));
create policy "mgr update" on public.medicines for update to authenticated using (public.is_manager(auth.uid())) with check (public.is_manager(auth.uid()));
create policy "staff read" on public.suppliers for select to authenticated using (public.is_staff(auth.uid()));
create policy "mgr insert" on public.suppliers for insert to authenticated with check (public.is_manager(auth.uid()));
create policy "mgr update" on public.suppliers for update to authenticated using (public.is_manager(auth.uid())) with check (public.is_manager(auth.uid()));
create policy "staff read" on public.customers for select to authenticated using (public.is_staff(auth.uid()));
create policy "staff insert" on public.customers for insert to authenticated with check (public.is_staff(auth.uid()));
create policy "mgr update" on public.customers for update to authenticated using (public.is_manager(auth.uid())) with check (public.is_manager(auth.uid()));
create policy "staff read" on public.medicine_batches for select to authenticated using (public.is_staff(auth.uid()));
create policy "mgr read" on public.purchases for select to authenticated using (public.is_manager(auth.uid()));
create policy "mgr read" on public.purchase_items for select to authenticated using (public.is_manager(auth.uid()));
create policy "staff read" on public.sales for select to authenticated using (public.is_manager(auth.uid()) or created_by = auth.uid());
create policy "staff read" on public.sale_items for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id and (public.is_manager(auth.uid()) or s.created_by = auth.uid())));
create policy "staff read" on public.sale_payments for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id and (public.is_manager(auth.uid()) or s.created_by = auth.uid())));
create policy "mgr read" on public.stock_movements for select to authenticated using (public.is_manager(auth.uid()));
create policy "mgr read" on public.expenses for select to authenticated using (public.is_manager(auth.uid()));
create policy "mgr insert" on public.expenses for insert to authenticated with check (public.is_manager(auth.uid()) and created_by = auth.uid());
create policy "admin read" on public.audit_log for select to authenticated using (public.has_role(auth.uid(),'admin'));

-- ===== post_purchase =====
create or replace function public.post_purchase(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_existing record;
  v_id uuid; v_no text;
  it jsonb; v_batch uuid;
  v_sub numeric(14,2) := 0; v_disc numeric(14,2) := coalesce((p->>'discount')::numeric,0);
  v_paid numeric(14,2) := coalesce((p->>'paid')::numeric,0);
  v_qty numeric; v_cost numeric; v_price numeric; v_exp date; v_bno text; v_med uuid;
begin
  if uid is null or not public.is_manager(uid) then raise exception 'Not allowed: managers only'; end if;
  if v_key is null then raise exception 'Missing idempotency key'; end if;
  select id, purchase_no into v_existing from purchases where idempotency_key = v_key;
  if found then return jsonb_build_object('id', v_existing.id, 'purchase_no', v_existing.purchase_no, 'duplicate', true); end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one item'; end if;
  if v_disc < 0 or v_paid < 0 then raise exception 'Invalid discount or paid amount'; end if;

  v_id := gen_random_uuid();
  v_no := 'PUR-' || lpad(nextval('purchase_no_seq')::text, 6, '0');
  insert into purchases (id, purchase_no, idempotency_key, supplier_id, supplier_invoice_no, purchase_date, subtotal, discount, total, paid, note, created_by)
  values (v_id, v_no, v_key, (p->>'supplier_id')::uuid, nullif(p->>'supplier_invoice_no',''),
          coalesce((p->>'purchase_date')::date, (now() at time zone 'Asia/Dhaka')::date), 0, 0, 0, 0, p->>'note', uid);

  for it in select * from jsonb_array_elements(p->'items') loop
    v_med := (it->>'medicine_id')::uuid; v_bno := trim(it->>'batch_no'); v_exp := (it->>'expiry_date')::date;
    v_qty := (it->>'qty')::numeric; v_cost := (it->>'unit_cost')::numeric; v_price := (it->>'sale_price')::numeric;
    if v_bno is null or v_bno = '' then raise exception 'Batch number required'; end if;
    if v_exp is null then raise exception 'Expiry date required'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be positive'; end if;
    if v_cost is null or v_cost < 0 or v_price is null or v_price < 0 then raise exception 'Invalid cost or price'; end if;

    insert into medicine_batches (medicine_id, batch_no, expiry_date, unit_cost, sale_price, qty_on_hand, supplier_id)
    values (v_med, v_bno, v_exp, v_cost, v_price, 0, (p->>'supplier_id')::uuid)
    on conflict (medicine_id, batch_no) do update set unit_cost = excluded.unit_cost, sale_price = excluded.sale_price
    returning id into v_batch;
    if (select expiry_date from medicine_batches where id = v_batch) <> v_exp then
      raise exception 'Batch % already exists with a different expiry date', v_bno;
    end if;
    update medicine_batches set qty_on_hand = qty_on_hand + v_qty where id = v_batch;
    insert into purchase_items (purchase_id, medicine_id, batch_id, batch_no, expiry_date, qty, unit_cost, sale_price, line_total)
    values (v_id, v_med, v_batch, v_bno, v_exp, v_qty, v_cost, v_price, round(v_qty * v_cost, 2));
    insert into stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
    values (v_batch, v_med, 'purchase', v_qty, 'purchases', v_id, uid);
    v_sub := v_sub + round(v_qty * v_cost, 2);
  end loop;

  if v_disc > v_sub then raise exception 'Discount exceeds subtotal'; end if;
  if v_paid > v_sub - v_disc then raise exception 'Paid amount exceeds total'; end if;
  update purchases set subtotal = v_sub, discount = v_disc, total = v_sub - v_disc, paid = v_paid where id = v_id;
  insert into audit_log (actor, action, entity, entity_id) values (uid, 'post_purchase', 'purchases', v_id);
  return jsonb_build_object('id', v_id, 'purchase_no', v_no, 'duplicate', false);
end $$;

-- ===== post_sale (FEFO, row locks) =====
create or replace function public.post_sale(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_existing record;
  v_id uuid; v_no text;
  it jsonb; pay jsonb; b record; m record;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_need numeric; v_take numeric; v_price numeric; v_line_disc numeric; v_ratio numeric;
  v_sub numeric(14,2) := 0; v_idisc numeric(14,2) := 0;
  v_bdisc numeric(14,2) := coalesce((p->>'bill_discount')::numeric, 0);
  v_paid numeric(14,2) := 0; v_total numeric(14,2);
  v_alloc numeric(14,2);
  v_cust uuid := nullif(p->>'customer_id','')::uuid;
begin
  if uid is null or not public.is_staff(uid) then raise exception 'Not allowed'; end if;
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
    if v_need is null or v_need <= 0 then raise exception 'Quantity must be positive'; end if;
    if v_line_disc < 0 then raise exception 'Invalid line discount'; end if;
    select * into m from medicines where id = (it->>'medicine_id')::uuid;
    if not found or not m.is_active then raise exception 'Medicine not available'; end if;
    v_ratio := v_need;  -- remember for discount split

    if it ? 'batch_id' and nullif(it->>'batch_id','') is not null then
      select * into b from medicine_batches where id = (it->>'batch_id')::uuid and medicine_id = m.id for update;
      if not found then raise exception 'Batch not found for %', m.name; end if;
      if b.expiry_date <= v_today then raise exception 'Batch % of % is expired', b.batch_no, m.name; end if;
      if b.qty_on_hand < v_need then raise exception 'Insufficient stock for % (batch %): % available', m.name, b.batch_no, b.qty_on_hand; end if;
      v_price := b.sale_price;
      update medicine_batches set qty_on_hand = qty_on_hand - v_need where id = b.id;
      insert into sale_items (sale_id, medicine_id, batch_id, medicine_name, batch_no, expiry_date, qty, unit_price, discount, unit_cost, line_total)
      values (v_id, m.id, b.id, m.name, b.batch_no, b.expiry_date, v_need, v_price, v_line_disc, b.unit_cost, round(v_need*v_price - v_line_disc, 2));
      insert into stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
      values (b.id, m.id, 'sale', -v_need, 'sales', v_id, uid);
      if v_line_disc > round(v_need*v_price,2) then raise exception 'Discount exceeds line amount for %', m.name; end if;
      v_sub := v_sub + round(v_need*v_price, 2); v_idisc := v_idisc + v_line_disc;
    else
      -- FEFO across non-expired batches; discount allocated proportionally
      if (select coalesce(sum(qty_on_hand),0) from medicine_batches where medicine_id = m.id and expiry_date > v_today) < v_need then
        raise exception 'Insufficient stock for %', m.name;
      end if;
      for b in select * from medicine_batches
               where medicine_id = m.id and expiry_date > v_today and qty_on_hand > 0
               order by expiry_date, created_at for update loop
        exit when v_need <= 0;
        v_take := least(v_need, b.qty_on_hand);
        v_alloc := round(v_line_disc * v_take / v_ratio, 2);
        update medicine_batches set qty_on_hand = qty_on_hand - v_take where id = b.id;
        insert into sale_items (sale_id, medicine_id, batch_id, medicine_name, batch_no, expiry_date, qty, unit_price, discount, unit_cost, line_total)
        values (v_id, m.id, b.id, m.name, b.batch_no, b.expiry_date, v_take, b.sale_price, v_alloc, b.unit_cost, round(v_take*b.sale_price - v_alloc, 2));
        insert into stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
        values (b.id, m.id, 'sale', -v_take, 'sales', v_id, uid);
        if v_alloc > round(v_take*b.sale_price,2) then raise exception 'Discount exceeds line amount for %', m.name; end if;
        v_sub := v_sub + round(v_take*b.sale_price, 2); v_idisc := v_idisc + v_alloc;
        v_need := v_need - v_take;
      end loop;
      if v_need > 0 then raise exception 'Insufficient stock for %', m.name; end if;
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
revoke execute on function public.post_purchase(jsonb) from public, anon;
grant execute on function public.post_sale(jsonb) to authenticated;
grant execute on function public.post_purchase(jsonb) to authenticated;

-- ===================== 0001_sale_returns.sql =====================
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
-- ===================== 0002_customer_due_collection.sql =====================
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
-- ===================== 0003_supplier_payments.sql =====================
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
-- ===================== 0004_cash_drawers.sql =====================
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

