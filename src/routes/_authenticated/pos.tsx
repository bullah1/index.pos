import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Search, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { customersQuery, medicinesQuery, type MedicineWithBatches } from "@/lib/queries";
import {
  PAY_METHODS,
  computeTotals,
  fefoAllocate,
  fefoGross,
  lineTotal,
  sellableStock,
  settlePayments,
  validateCart,
  type CartLine,
  type PayMethod,
  type Payment,
} from "@/lib/pos";
import { bdToday, errMsg, taka } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReceiptDialog } from "@/components/Receipt";
import { SearchSelect } from "@/components/SearchSelect";
import { DrawerGate } from "@/components/DrawerGate";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/pos")({
  head: () => ({ meta: [{ title: "POS Counter — Pharmacy POS" }, { name: "description", content: "Sell medicines at the counter." }] }),
  component: PosRoute,
});

function PosRoute() {
  const { user } = Route.useRouteContext();
  return (
    <DrawerGate userId={user.id}>
      <PosPage />
    </DrawerGate>
  );
}

const WALKIN = "walkin";
const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

function matches(m: MedicineWithBatches, s: string) {
  return [m.name, m.name_bn, m.generic_name, m.barcode, m.code, m.manufacturer].some((f) => f?.toLowerCase().includes(s));
}

function PosPage() {
  const qc = useQueryClient();
  const { data: meds = [], isLoading, error: medsError } = useQuery(medicinesQuery);
  const { data: customers = [] } = useQuery(customersQuery);
  const today = bdToday();
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string>(WALKIN);
  const [billDiscount, setBillDiscount] = useState("");
  // While "auto" is on, the first payment line always equals the payable amount.
  const [autoPay, setAutoPay] = useState(true);
  const [payments, setPayments] = useState<{ method: PayMethod; amount: string }[]>([{ method: "cash", amount: "" }]);
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [receipt, setReceipt] = useState<{ id: string; cash?: number | undefined; change?: number | undefined } | null>(null);
  const [newCust, setNewCust] = useState(false);

  const medById = useMemo(() => new Map(meds.map((m) => [m.id, m])), [meds]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const active = meds.filter((m) => m.is_active);
    // Exact barcode / code first (scanner), then names that start with the text, then everything else.
    const exact = active.filter((m) => m.barcode?.toLowerCase() === s || m.code?.toLowerCase() === s);
    const starts = active.filter((m) => !exact.includes(m) && (m.name.toLowerCase().startsWith(s) || m.generic_name?.toLowerCase().startsWith(s)));
    const rest = active.filter((m) => !exact.includes(m) && !starts.includes(m) && matches(m, s));
    return [...exact, ...starts, ...rest].slice(0, 10);
  }, [q, meds]);

  // Cart lines priced exactly the way the database will charge them (FEFO, each batch at its own price).
  const priced: CartLine[] = useMemo(
    () => cart.map((l) => {
      const m = medById.get(l.medicine_id);
      return m ? { ...l, gross: fefoGross(m.batches, l.qty, today) } : l;
    }),
    [cart, medById, today],
  );

  const bill = num(billDiscount);
  const baseTotals = computeTotals(priced, bill, []);
  const pays: Payment[] = payments.map((p, i) => ({
    method: p.method,
    amount: autoPay && i === 0 ? Math.max(0, baseTotals.payable) : num(p.amount),
  }));
  const totals = computeTotals(priced, bill, pays);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F9" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); void complete(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function add(medId: string) {
    const m = medById.get(medId);
    if (!m) return;
    const avail = sellableStock(m.batches, today);
    if (avail <= 0) { toast.error(`${m.name} is out of stock (or only expired batches left)`); return; }
    const price = Number(fefoAllocate(m.batches, 1, today).allocations[0]?.batch.sale_price ?? m.default_price);
    const inCart = cart.find((l) => l.medicine_id === medId);
    if (inCart && inCart.qty >= avail) toast.warning(`Only ${avail} ${m.sale_unit} of ${m.name} in stock`);
    setCart((c) => {
      const ex = c.find((l) => l.medicine_id === medId);
      if (ex) return c.map((l) => (l.medicine_id === medId ? { ...l, qty: Math.min(l.qty + 1, avail), available: avail } : l));
      return [...c, { medicine_id: m.id, name: `${m.name}${m.strength ? " " + m.strength : ""}`, qty: 1, unit_price: price, discount: 0, available: avail }];
    });
    setQ("");
    setHi(0);
    searchRef.current?.focus();
  }
  const update = (id: string, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (l.medicine_id === id ? { ...l, ...patch } : l)));

  function reset() {
    setCart([]);
    setBillDiscount("");
    setPayments([{ method: "cash", amount: "" }]);
    setAutoPay(true);
    setCustomerId(WALKIN);
    setIdemKey(crypto.randomUUID());
    searchRef.current?.focus();
  }

  async function complete() {
    if (busy || cart.length === 0) return;
    const hasCustomer = customerId !== WALKIN;
    const err = validateCart(priced, bill, pays, hasCustomer);
    if (err) { toast.error(err); return; }
    setBusy(true);
    const toSave = settlePayments(pays, totals.change);
    const cashGiven = pays.filter((p) => p.method === "cash").reduce((s, p) => s + p.amount, 0);
    const { data, error } = await supabase.rpc("post_sale", {
      p: {
        idempotency_key: idemKey,
        customer_id: hasCustomer ? customerId : null,
        bill_discount: bill,
        items: cart.map((l) => ({ medicine_id: l.medicine_id, qty: l.qty, discount: l.discount })),
        payments: toSave,
      } as never,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      qc.invalidateQueries({ queryKey: ["medicines"] }); // stock may have changed at another counter
      return;
    }
    const r = data as { id: string; invoice_no: string; duplicate?: boolean };
    if (r.duplicate) toast.warning(`This sale was already saved as ${r.invoice_no}`);
    else toast.success(`Sale ${r.invoice_no} saved`);
    qc.invalidateQueries({ queryKey: ["medicines"] });
    qc.invalidateQueries({ queryKey: ["sales"] });
    qc.invalidateQueries({ queryKey: ["report"] });
    qc.invalidateQueries({ queryKey: ["customer-dues"] });
    setReceipt({ id: r.id, cash: cashGiven > 0 ? cashGiven : undefined, change: totals.change > 0 ? totals.change : undefined });
    reset();
  }

  const customerOptions = useMemo(
    () => [
      { value: WALKIN, label: "Walk-in customer" },
      ...customers.map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? undefined, keywords: c.phone ?? "" })),
    ],
    [customers],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="min-w-0 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            autoFocus
            value={q}
            placeholder="Search medicine, generic or barcode…  (F2)"
            className="h-11 pl-9 text-base"
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && results[hi]) { e.preventDefault(); add(results[hi].id); }
              if (e.key === "Escape") setQ("");
            }}
          />
          {results.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-[60vh] w-full overflow-y-auto rounded-md border bg-popover shadow-md">
              {results.map((m, i) => {
                const st = sellableStock(m.batches, today);
                const next = fefoAllocate(m.batches, 1, today).allocations[0]?.batch;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHi(i)}
                      onClick={() => add(m.id)}
                      className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm", i === hi && "bg-accent")}
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{m.name}</span>
                        {m.strength && <span className="text-muted-foreground"> {m.strength}</span>}
                        {m.dosage_form && <span className="text-muted-foreground"> · {m.dosage_form}</span>}
                        {m.name_bn && <span className="text-muted-foreground"> · {m.name_bn}</span>}
                        <span className="block truncate text-xs text-muted-foreground">
                          {[m.generic_name, m.manufacturer].filter(Boolean).join(" · ")}
                          {m.prescription_required && " · Rx"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs">
                        <span className="block font-medium">{next ? taka(next.sale_price) : "—"}</span>
                        <span className={cn(st <= 0 ? "text-destructive" : "text-muted-foreground")}>
                          {st > 0 ? `${st} ${m.sale_unit}` : "Out of stock"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {q && results.length === 0 && !isLoading && <p className="mt-2 text-sm text-muted-foreground">No medicine matches “{q}”.</p>}
          {medsError && <p className="mt-2 text-sm text-destructive">Could not load medicines: {errMsg(medsError)}</p>}
          {!isLoading && !medsError && meds.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">No medicines yet. Add medicines in Inventory, then receive stock in Purchases.</p>
          )}
        </div>

        <div className="rounded-lg border">
          {cart.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Cart is empty. Search or scan a medicine and press Enter.
              <div className="mt-1 text-xs">Shortcuts: F2 search · F9 or Ctrl+Enter complete sale</div>
            </div>
          ) : (
            <>
            <ul className="divide-y sm:hidden">
              {priced.map((l) => {
                const m = medById.get(l.medicine_id);
                const alloc = m ? fefoAllocate(m.batches, l.qty, today).allocations : [];
                return (
                  <li key={l.medicine_id} className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{l.name}</div>
                        <div className="text-xs text-muted-foreground">{alloc.map((a) => `${a.batch.batch_no} ×${a.qty} @ ${taka(a.batch.sale_price)}`).join(", ")}</div>
                      </div>
                      <div className="shrink-0 text-right font-semibold">{taka(lineTotal(l))}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="icon" variant="outline" className="h-9 w-9" aria-label="Decrease" onClick={() => update(l.medicine_id, { qty: Math.max(1, l.qty - 1) })}><Minus className="h-4 w-4" /></Button>
                      <Input type="number" inputMode="numeric" value={l.qty || ""} className="h-9 w-16 px-1 text-center" aria-label="Quantity"
                        onChange={(e) => update(l.medicine_id, { qty: num(e.target.value) })}
                        onBlur={() => { if (!(l.qty > 0)) update(l.medicine_id, { qty: 1 }); }} />
                      <Button size="icon" variant="outline" className="h-9 w-9" aria-label="Increase" onClick={() => update(l.medicine_id, { qty: Math.min(l.available, l.qty + 1) })}><Plus className="h-4 w-4" /></Button>
                      <Input type="number" inputMode="decimal" placeholder="Disc ৳" value={l.discount || ""} className="h-9 w-20 px-2" aria-label="Discount"
                        onChange={(e) => update(l.medicine_id, { discount: num(e.target.value) })} />
                      <Button size="icon" variant="ghost" className="ml-auto h-9 w-9" aria-label="Remove" onClick={() => setCart((c) => c.filter((x) => x.medicine_id !== l.medicine_id))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    {l.qty > l.available && <div className="text-xs text-destructive">Only {l.available} left</div>}
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">Medicine</th>
                    <th className="p-2">Price</th>
                    <th className="p-2">Qty</th>
                    <th className="p-2">Disc ৳</th>
                    <th className="p-2 text-right">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {priced.map((l) => {
                    const m = medById.get(l.medicine_id);
                    const alloc = m ? fefoAllocate(m.batches, l.qty, today).allocations : [];
                    const prices = [...new Set(alloc.map((a) => Number(a.batch.sale_price)))];
                    return (
                      <tr key={l.medicine_id} className="border-b align-top last:border-0">
                        <td className="p-2">
                          <div className="font-medium">{l.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {alloc.map((a) => `${a.batch.batch_no} (exp ${a.batch.expiry_date}) ×${a.qty}`).join(", ")}
                          </div>
                        </td>
                        <td className="whitespace-nowrap p-2">
                          {prices.length > 1 ? prices.map((x) => taka(x)).join(" / ") : taka(prices[0] ?? l.unit_price)}
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Decrease" onClick={() => update(l.medicine_id, { qty: Math.max(1, l.qty - 1) })}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={l.available}
                              value={l.qty || ""}
                              className="h-8 w-16 px-1 text-center"
                              onChange={(e) => update(l.medicine_id, { qty: num(e.target.value) })}
                              onBlur={() => { if (!(l.qty > 0)) update(l.medicine_id, { qty: 1 }); }}
                            />
                            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Increase" onClick={() => update(l.medicine_id, { qty: Math.min(l.available, l.qty + 1) })}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          {l.qty > l.available && <div className="text-xs text-destructive">Only {l.available} left</div>}
                        </td>
                        <td className="p-2">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.01"
                            value={l.discount || ""}
                            placeholder="0"
                            className="h-8 w-20 px-1"
                            onChange={(e) => update(l.medicine_id, { discount: num(e.target.value) })}
                          />
                        </td>
                        <td className="whitespace-nowrap p-2 text-right font-medium">{taka(lineTotal(l))}</td>
                        <td className="p-2">
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Remove" onClick={() => setCart((c) => c.filter((x) => x.medicine_id !== l.medicine_id))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      </section>

      <aside className="space-y-4 rounded-lg border bg-card p-4 lg:sticky lg:top-6 lg:self-start">
        <div>
          <Label>Customer</Label>
          <div className="mt-1 flex gap-2">
            <SearchSelect
              value={customerId}
              onChange={setCustomerId}
              options={customerOptions}
              searchPlaceholder="Name or phone…"
              empty="No customer found"
            />
            <Button variant="outline" size="icon" className="shrink-0" aria-label="New customer" onClick={() => setNewCust(true)}>
              <UserPlus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <Line k="Subtotal" v={taka(totals.subtotal)} />
          {totals.itemDiscount > 0 && <Line k="Item discount" v={"−" + taka(totals.itemDiscount)} />}
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Bill discount</span>
            <Input type="number" inputMode="decimal" min={0} step="0.01" placeholder="0" value={billDiscount} className="h-8 w-28 text-right" onChange={(e) => setBillDiscount(e.target.value)} />
          </div>
          <div className="flex justify-between border-t pt-2 text-lg font-bold">
            <span>Payable</span>
            <span>{taka(totals.payable)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Payment</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAutoPay(false);
                setPayments((p) => [
                  ...p.map((x, i) => (i === 0 && autoPay ? { ...x, amount: String(baseTotals.payable > 0 ? baseTotals.payable : "") } : x)),
                  { method: "bkash", amount: "" },
                ]);
              }}
            >
              + Split
            </Button>
          </div>
          {payments.map((p, i) => (
            <div key={i} className="flex gap-2">
              <Select value={p.method} onValueChange={(v) => setPayments((ps) => ps.map((x, j) => (j === i ? { ...x, method: v as PayMethod } : x)))}>
                <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="0"
                aria-label={p.method === "cash" ? "Cash received" : "Amount"}
                value={autoPay && i === 0 ? (baseTotals.payable > 0 ? String(baseTotals.payable) : "") : p.amount}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  if (i === 0) setAutoPay(false);
                  setPayments((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)));
                }}
              />
              {payments.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label="Remove payment"
                  onClick={() => setPayments((ps) => ps.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {!autoPay && (
            <Button variant="outline" size="sm" className="w-full" onClick={() => {
              const others = pays.slice(1).reduce((s, x) => s + x.amount, 0);
              setPayments((ps) => [{ method: ps[0]?.method ?? "cash", amount: String(Math.max(0, Math.round((totals.payable - others) * 100) / 100)) }, ...ps.slice(1)]);
            }}>
              Pay full amount
            </Button>
          )}
          <p className="text-xs text-muted-foreground">For cash, type the note the customer gave (e.g. 500) — change is shown below.</p>
        </div>

        <div className="space-y-1 text-sm">
          <Line k="Paid" v={taka(totals.paid)} />
          {totals.due > 0 && (
            <div className="flex justify-between font-medium text-warning-foreground">
              <span>Due</span>
              <span>{taka(totals.due)} <Badge variant="outline">credit</Badge></span>
            </div>
          )}
          {totals.change > 0 && (
            <div className="flex justify-between rounded-md bg-primary/10 px-2 py-1.5 text-base font-bold text-primary">
              <span>Change to return</span>
              <span>{taka(totals.change)}</span>
            </div>
          )}
          {totals.overpaid > 0 && totals.change === 0 && (
            <div className="text-xs font-medium text-destructive">bKash / Nagad / Rocket / Bank amount is more than payable.</div>
          )}
          {totals.due > 0 && customerId === WALKIN && <div className="text-xs text-destructive">Select a customer to keep the rest as due.</div>}
        </div>

        <Button className="h-12 w-full text-base" disabled={busy || cart.length === 0} onClick={complete}>
          {busy ? "Saving…" : `Complete sale · ${taka(totals.payable)}`}
        </Button>
        {cart.length > 0 && <Button variant="ghost" size="sm" className="w-full" onClick={reset}>Clear cart</Button>}
      </aside>

      <QuickCustomer open={newCust} onClose={() => setNewCust(false)} onCreated={(id) => { setCustomerId(id); qc.invalidateQueries({ queryKey: ["customers"] }); }} />
      <ReceiptDialog
        saleId={receipt?.id ?? null}
        cashReceived={receipt?.cash}
        change={receipt?.change}
        title="Sale complete"
        onClose={() => { setReceipt(null); searchRef.current?.focus(); }}
      />
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{k}</span><span>{v}</span></div>;
}

function QuickCustomer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name.trim()) { toast.error("Name is required"); return; }
    const ph = phone.replace(/\s/g, "");
    if (ph && !/^(\+?88)?01[3-9]\d{8}$/.test(ph)) { toast.error("Enter a valid mobile number (01XXXXXXXXX)"); return; }
    setBusy(true);
    const { data, error } = await supabase.from("customers").insert({ name: name.trim(), phone: ph || null }).select("id").single();
    setBusy(false);
    if (error) { toast.error(error.code === "23505" ? "A customer with this phone already exists" : errMsg(error)); return; }
    toast.success("Customer added");
    onCreated(data.id);
    setName("");
    setPhone("");
    onClose();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>New customer</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div><Label htmlFor="qc-name">Name</Label><Input id="qc-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div><Label htmlFor="qc-phone">Phone</Label><Input id="qc-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" /></div>
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
