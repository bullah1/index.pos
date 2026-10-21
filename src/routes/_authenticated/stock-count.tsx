import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { medicinesQuery, suppliersQuery, type Batch, type MedicineWithBatches } from "@/lib/queries";
import { sellableStock } from "@/lib/pos";
import { packSize, parseCount, stockLabel } from "@/lib/pack";
import { NO_EXPIRY, autoBatchNo, bdToday, defaultCost, errMsg, taka } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DrawerGate } from "@/components/DrawerGate";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/stock-count")({
  head: () => ({ meta: [{ title: "Stock Entry — Pharmacy POS" }, { name: "description", content: "Type the stock you have for every medicine and save all at once." }] }),
  component: StockCountRoute,
});

function StockCountRoute() {
  const { user, role } = Route.useRouteContext();
  if (role === "cashier") return <p className="text-sm text-muted-foreground">Stock entry is available to managers and admins.</p>;
  return (
    <DrawerGate userId={user.id}>
      <StockCountPage />
    </DrawerGate>
  );
}

type Mode = "purchase" | "opening";
type Change = { m: MedicineWithBatches; current: number; target: number; diff: number; cost: number; price: number };
type Prices = { mrp?: string; cost?: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** MRP and purchase price per unit for new stock. Typed values are per box for box items. Default purchase = MRP − 55%. */
function unitPrices(m: MedicineWithBatches, last: Batch | undefined, typed: Prices | undefined) {
  const pack = packSize(m);
  const baseUnit = Number(last?.sale_price ?? m.default_price ?? 0);
  const mrpBox = typed?.mrp?.trim() ? Number(typed.mrp) : r2(baseUnit * pack);
  const price = r2(mrpBox / pack);
  const costBox = typed?.cost?.trim() ? Number(typed.cost) : defaultCost(mrpBox);
  const cost = r2(costBox / pack);
  return { pack, mrpBox, costBox, price, cost, valid: Number.isFinite(price) && price >= 0 && Number.isFinite(cost) && cost >= 0 };
}

const ALL = "__all";

/** Latest batch that can still be sold: new stock is added to it so batches don't pile up. */
function latestBatch(m: MedicineWithBatches, today: string): Batch | undefined {
  return [...m.batches].filter((b) => b.expiry_date > today).sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
}

function StockCountPage() {
  const qc = useQueryClient();
  const { data: meds = [], isLoading, error } = useQuery(medicinesQuery);
  const { data: suppliers = [] } = useQuery(suppliersQuery);
  const today = bdToday();
  const [q, setQ] = useState("");
  const [company, setCompany] = useState(ALL);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, Prices>>({});
  const setPrice = (id: string, k: keyof Prices, v: string) => setPrices((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));
  const [mode, setMode] = useState<Mode>("purchase");
  const [paid, setPaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());

  const active = useMemo(() => meds.filter((m) => m.is_active), [meds]);
  const companies = useMemo(() => [...new Set(active.map((m) => m.manufacturer || "Other"))].sort(), [active]);
  const shown = active.filter((m) => {
    const s = q.trim().toLowerCase();
    if (company !== ALL && (m.manufacturer || "Other") !== company) return false;
    return !s || [m.name, m.name_bn, m.generic_name, m.barcode, m.code].some((f) => f?.toLowerCase().includes(s));
  });

  const changes: Change[] = useMemo(() => {
    const out: Change[] = [];
    for (const m of active) {
      const text = counts[m.id];
      if (text == null) continue;
      const target = parseCount(text, packSize(m));
      if (target == null) continue;
      const current = sellableStock(m.batches, today);
      const diff = Math.round((target - current) * 1000) / 1000;
      if (diff === 0) continue;
      const { price, cost } = unitPrices(m, latestBatch(m, today), prices[m.id]);
      out.push({ m, current, target, diff, cost, price });
    }
    return out;
  }, [active, counts, prices, today]);

  const plus = changes.filter((c) => c.diff > 0);
  const minus = changes.filter((c) => c.diff < 0);
  const plusValue = plus.reduce((s, c) => s + c.diff * c.cost, 0);
  const minusValue = minus.reduce((s, c) => s - c.diff * c.cost, 0);
  const noPrice = plus.filter((c) => !(c.price > 0) || !(c.cost >= 0));
  const invalid = Object.entries(counts).filter(([id, t]) => {
    const m = active.find((x) => x.id === id);
    return m && t.trim() !== "" && parseCount(t, packSize(m)) == null;
  });

  function focusNext(id: string) {
    const ids = shown.map((m) => m.id);
    const next = ids[ids.indexOf(id) + 1];
    if (next) inputs.current.get(next)?.focus();
  }

  async function ensureSupplier(name: string): Promise<string> {
    const found = suppliers.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (found) return found.id;
    const { data, error } = await supabase.from("suppliers").insert({ name }).select("id").single();
    if (error) throw error;
    return data.id;
  }

  /** New stock joins the latest batch only when it has the same MRP and purchase price; otherwise it gets its own batch. */
  function sameBatch(c: Change): Batch | undefined {
    const last = latestBatch(c.m, today);
    return last && Number(last.sale_price) === c.price && Number(last.unit_cost) === c.cost ? last : undefined;
  }

  async function save() {
    if (busy || changes.length === 0) return;
    if (invalid.length) { toast.error("Fix the boxes marked in red first"); return; }
    if (noPrice.length) { toast.error(`${noPrice[0]!.m.name}: enter the MRP`); return; }
    setBusy(true);
    const done: string[] = [];
    try {
      // 1) Stock that went up.
      if (plus.length && mode === "purchase") {
        // One purchase per company, so each supplier's balance stays right.
        const byCompany = new Map<string, Change[]>();
        for (const c of plus) {
          const k = c.m.manufacturer || "Opening stock";
          byCompany.set(k, [...(byCompany.get(k) ?? []), c]);
        }
        for (const [name, list] of byCompany) {
          const supplierId = await ensureSupplier(name);
          const items = list.map((c) => {
            const last = sameBatch(c);
            return {
              medicine_id: c.m.id,
              batch_no: last?.batch_no ?? autoBatchNo(),
              expiry_date: last?.expiry_date ?? NO_EXPIRY,
              qty: c.diff,
              unit_cost: c.cost,
              sale_price: c.price,
            };
          });
          const total = Math.round(items.reduce((s, i) => s + Math.round(i.qty * i.unit_cost * 100) / 100, 0) * 100) / 100;
          const { data, error } = await supabase.rpc("post_purchase", {
            p: { idempotency_key: crypto.randomUUID(), supplier_id: supplierId, purchase_date: today, discount: 0, paid: paid ? total : 0, note: "Stock entry", items } as never,
          });
          if (error) throw new Error(`${name}: ${error.message}`);
          done.push((data as { purchase_no: string }).purchase_no);
        }
      } else if (plus.length) {
        for (const c of plus) {
          const last = sameBatch(c);
          const p = last
            ? { idempotency_key: crypto.randomUUID(), batch_id: last.id, mode: "add", qty: c.diff, reason: "opening" }
            : { idempotency_key: crypto.randomUUID(), medicine_id: c.m.id, batch_no: autoBatchNo(), expiry_date: NO_EXPIRY, unit_cost: c.cost, sale_price: c.price, qty: c.diff, reason: "opening" };
          const { error } = await supabase.rpc("adjust_stock", { p: p as never });
          if (error) throw new Error(`${c.m.name}: ${error.message}`);
        }
        done.push(`${plus.length} opening`);
      }

      // 2) Stock that went down: take it out of the oldest batches first (the ones that would have sold first).
      for (const c of minus) {
        let left = -c.diff;
        const batches = [...c.m.batches].filter((b) => b.expiry_date > today && Number(b.qty_on_hand) > 0)
          .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.created_at.localeCompare(b.created_at));
        for (const b of batches) {
          if (left <= 0) break;
          const take = Math.min(left, Number(b.qty_on_hand));
          const { error } = await supabase.rpc("adjust_stock", {
            p: { idempotency_key: crypto.randomUUID(), batch_id: b.id, mode: "remove", qty: take, reason: "count", note: "Stock entry" } as never,
          });
          if (error) throw new Error(`${c.m.name}: ${error.message}`);
          left = Math.round((left - take) * 1000) / 1000;
        }
      }
      if (minus.length) done.push(`${minus.length} reduced`);
      // Remember a changed MRP as the medicine's default price.
      for (const c of plus) {
        if (Number(c.m.default_price) !== c.price) await supabase.from("medicines").update({ default_price: c.price }).eq("id", c.m.id);
      }
      toast.success(`Stock saved for ${changes.length} medicine${changes.length > 1 ? "s" : ""}${done.length ? ` (${done.join(", ")})` : ""}`);
      setCounts({});
      setPrices({});
    } catch (e) {
      toast.error(`${errMsg(e)}${done.length ? ` — already saved: ${done.join(", ")}` : ""}`);
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["medicines"] });
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["stock-adjustments"] });
    }
  }

  return (
    <div className="space-y-4 pb-56 sm:pb-32">
      <div>
        <h1 className="text-xl font-semibold">Stock Entry</h1>
        <p className="text-sm text-muted-foreground">
          Type how many you have now. What you type becomes the stock. For boxes you can type <span className="font-medium text-foreground">4+6</span> = 4 box + 6 pieces. Leave blank to keep as is. MRP and purchase price are filled in for you (purchase = MRP − 55%); type over them only if they are different.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search medicine…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={company} onValueChange={setCompany}>
          <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All companies</SelectItem>
            {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Medicine</th>
              <th className="p-2">Now</th>
              <th className="p-2">New stock</th>
              <th className="hidden p-2 sm:table-cell">MRP</th>
              <th className="hidden p-2 sm:table-cell">Purchase <span className="font-normal">(MRP −55%)</span></th>
              <th className="hidden p-2 text-right sm:table-cell">Change</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {error && <tr><td colSpan={6} className="p-6 text-center text-destructive">{errMsg(error)}</td></tr>}
            {!isLoading && shown.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No medicines found. Add medicines in <Link to="/inventory" className="underline">Medicines &amp; Stock</Link>.</td></tr>
            )}
            {shown.map((m) => {
              const pack = packSize(m);
              const current = sellableStock(m.batches, today);
              const text = counts[m.id] ?? "";
              const target = parseCount(text, pack);
              const bad = text.trim() !== "" && target == null;
              const diff = target == null ? 0 : Math.round((target - current) * 1000) / 1000;
              const up = unitPrices(m, latestBatch(m, today), prices[m.id]);
              const per = up.pack > 1 ? "/box" : "";
              const priceInputs = (cls: string) => (
                <>
                  <Input inputMode="decimal" aria-label={`MRP for ${m.name}`} className={cls} placeholder={`৳${up.mrpBox}${per}`}
                    value={prices[m.id]?.mrp ?? ""} onChange={(e) => setPrice(m.id, "mrp", e.target.value)} />
                  <Input inputMode="decimal" aria-label={`Purchase price for ${m.name}`} className={cls} placeholder={`৳${up.costBox}${per}`}
                    value={prices[m.id]?.cost ?? ""} onChange={(e) => setPrice(m.id, "cost", e.target.value)} />
                </>
              );
              return (
                <tr key={m.id} className={cn("border-b last:border-0", diff !== 0 && "bg-primary/5")}>
                  <td className="p-2">
                    <div className="font-medium">{m.name} {m.strength}</div>
                    <div className="text-xs text-muted-foreground">{m.manufacturer}</div>
                  </td>
                  <td className="whitespace-nowrap p-2 text-muted-foreground">{stockLabel(current, m)}</td>
                  <td className="p-2">
                    <Input
                      ref={(el) => { if (el) inputs.current.set(m.id, el); else inputs.current.delete(m.id); }}
                      inputMode={pack > 1 ? "text" : "decimal"}
                      placeholder={pack > 1 ? "box+pcs" : ""}
                      value={text}
                      aria-label={`New stock for ${m.name}`}
                      className={cn("h-9 w-20 sm:w-28", bad && "border-destructive")}
                      onChange={(e) => setCounts((c) => ({ ...c, [m.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusNext(m.id); } }}
                    />
                    {target != null && pack > 1 && <div className="mt-0.5 text-[11px] text-muted-foreground">= {stockLabel(target, m)}</div>}
                    {diff !== 0 && <div className={cn("mt-0.5 text-xs font-medium sm:hidden", diff > 0 ? "text-primary" : "text-destructive")}>{diff > 0 ? `+${diff}` : diff}</div>}
                    {diff > 0 && (
                      <div className="mt-1 space-y-1 sm:hidden">
                        <div className="text-[11px] text-muted-foreground">MRP · Purchase{per}</div>
                        <div className="flex gap-1">{priceInputs("h-8 w-20 px-2 text-xs")}</div>
                      </div>
                    )}
                  </td>
                  <td className="hidden p-2 sm:table-cell">
                    <Input inputMode="decimal" aria-label={`MRP for ${m.name}`} className="h-9 w-28" placeholder={`৳${up.mrpBox}${per}`}
                      value={prices[m.id]?.mrp ?? ""} onChange={(e) => setPrice(m.id, "mrp", e.target.value)} />
                  </td>
                  <td className="hidden p-2 sm:table-cell">
                    <Input inputMode="decimal" aria-label={`Purchase price for ${m.name}`} className="h-9 w-28" placeholder={`৳${up.costBox}${per}`}
                      value={prices[m.id]?.cost ?? ""} onChange={(e) => setPrice(m.id, "cost", e.target.value)} />
                  </td>
                  <td className={cn("hidden whitespace-nowrap p-2 text-right font-medium sm:table-cell", diff > 0 && "text-primary", diff < 0 && "text-destructive")}>
                    {diff > 0 ? `+${diff}` : diff < 0 ? diff : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 shadow-lg backdrop-blur md:left-60 print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2">
          <div className="text-sm">
            <div className="font-medium">{changes.length} medicine{changes.length === 1 ? "" : "s"} changed</div>
            <div className="text-xs text-muted-foreground">
              {plus.length > 0 && <span className="text-primary">+{plus.length} up · {taka(plusValue)} at cost</span>}
              {plus.length > 0 && minus.length > 0 && " · "}
              {minus.length > 0 && <span className="text-destructive">{minus.length} down · {taka(minusValue)}</span>}
              {changes.length === 0 && "Type new stock in the boxes above"}
            </div>
          </div>
          {plus.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger className="h-9 w-auto min-w-60 gap-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase">Add as Purchase (by company)</SelectItem>
                  <SelectItem value="opening">Add as Opening stock</SelectItem>
                </SelectContent>
              </Select>
              {mode === "purchase" && (
                <div className="flex items-center gap-2">
                  <Switch id="sc-paid" checked={paid} onCheckedChange={setPaid} />
                  <Label htmlFor="sc-paid" className="font-normal">{paid ? "Paid to supplier" : "Supplier due"}</Label>
                </div>
              )}
            </div>
          )}
          <div className="ml-auto flex gap-2">
            {changes.length > 0 && <Button variant="ghost" onClick={() => { setCounts({}); setPrices({}); }} disabled={busy}>Clear</Button>}
            <Button className="h-10 px-6" disabled={busy || changes.length === 0} onClick={save}>
              {busy ? "Saving…" : `Save all (${changes.length})`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
