import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { MessageCircle, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchAll, medicinesQuery, settingsQuery, suppliersQuery } from "@/lib/queries";
import { sellableStock } from "@/lib/pos";
import { packSize, stockLabel, suggestBoxes } from "@/lib/pack";
import { bdToday, taka } from "@/lib/format";
import { addDays } from "@/lib/cashQuery";
import { openWhatsApp, printElement } from "@/lib/share";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/reorder")({
  head: () => ({ meta: [{ title: "Reorder — Pharmacy POS" }, { name: "description", content: "What to order from each company, based on sales and stock." }] }),
  component: Reorder,
});

const ALL = "__all";

function Reorder() {
  const today = bdToday();
  const { data: meds = [] } = useQuery(medicinesQuery);
  const { data: settings } = useQuery(settingsQuery);
  const { data: suppliers = [] } = useQuery(suppliersQuery);
  const [company, setCompany] = useState(ALL);
  const [cover, setCover] = useState("30");
  const [onlyNeeded, setOnlyNeeded] = useState(true);
  const [qty, setQty] = useState<Record<string, string>>({});

  // Units sold per medicine in the last 30 days (returns taken off).
  const sold = useQuery({
    queryKey: ["sold-30d", today],
    queryFn: async () => {
      const from = new Date(addDays(today, -29) + "T00:00:00+06:00").toISOString();
      const sales = await fetchAll<{ id: string }>((a, b) => supabase.from("sales").select("id").gte("created_at", from).neq("status", "cancelled").order("id").range(a, b));
      const m = new Map<string, number>();
      const ids = sales.map((s) => s.id);
      for (let i = 0; i < ids.length; i += 150) {
        const items = await fetchAll<{ medicine_id: string; qty: number; returned_qty: number }>((a, b) =>
          supabase.from("sale_items").select("medicine_id, qty, returned_qty").in("sale_id", ids.slice(i, i + 150)).order("id").range(a, b));
        for (const it of items) m.set(it.medicine_id, (m.get(it.medicine_id) ?? 0) + Number(it.qty) - Number(it.returned_qty));
      }
      return m;
    },
  });

  const days = Math.max(1, Number(cover) || 30);
  const rows = useMemo(() => meds.filter((m) => m.is_active).map((m) => {
    const pack = packSize(m);
    const stock = sellableStock(m.batches, today);
    const s30 = sold.data?.get(m.id) ?? 0;
    const perDay = s30 / 30;
    const last = [...m.batches].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
    const boxCost = Number(last?.unit_cost ?? 0) * pack;
    return {
      m, pack, stock, s30, perDay, boxCost,
      daysLeft: perDay > 0 ? Math.floor(stock / perDay) : null,
      suggest: suggestBoxes(stock, perDay, pack, days),
      company: m.manufacturer || "Other",
    };
  }), [meds, sold.data, today, days]);

  const companies = useMemo(() => [...new Set(rows.map((r) => r.company))].sort(), [rows]);
  const boxes = (id: string, suggest: number) => { const t = qty[id]; return t == null ? suggest : Math.max(0, Math.floor(Number(t) || 0)); };
  const shown = rows.filter((r) => (company === ALL || r.company === company) && (!onlyNeeded || boxes(r.m.id, r.suggest) > 0))
    .sort((a, b) => a.company.localeCompare(b.company) || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999) || a.m.name.localeCompare(b.m.name));
  const groups = [...new Set(shown.map((r) => r.company))];
  const ordered = (list: typeof shown) => list.filter((r) => boxes(r.m.id, r.suggest) > 0);
  const total = (list: typeof shown) => ordered(list).reduce((a, r) => a + boxes(r.m.id, r.suggest) * r.boxCost, 0);

  function orderText(co: string) {
    const list = ordered(shown.filter((r) => r.company === co));
    return [
      `*Order — ${settings?.pharmacy_name ?? ""}*`, `To: ${co}`, `Date: ${today}`, "------------------------",
      ...list.map((r, i) => `${i + 1}. ${r.m.name}${r.m.strength ? " " + r.m.strength : ""} — ${boxes(r.m.id, r.suggest)} ${r.pack > 1 ? "box" : r.m.sale_unit}`),
      "------------------------", `Items: ${list.length}`, settings?.phone ? `Phone: ${settings.phone}` : "",
    ].filter(Boolean).join("\n");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reorder list</h1>
          <p className="text-sm text-muted-foreground">Based on the last 30 days of sales and the stock on the shelf. Change any quantity before sending.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => printElement(document.getElementById("print-area"))}><Printer className="mr-1.5 h-4 w-4" />Print</Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
        <div>
          <Label className="text-xs">Company</Label>
          <Select value={company} onValueChange={setCompany}>
            <SelectTrigger className="h-9 w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All companies</SelectItem>
              {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="cov" className="text-xs">Order enough for (days)</Label>
          <Input id="cov" type="number" min={7} max={120} value={cover} onChange={(e) => setCover(e.target.value)} className="h-9 w-28" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={onlyNeeded} onChange={(e) => setOnlyNeeded(e.target.checked)} className="h-4 w-4" />
          Only items to order
        </label>
        {sold.isLoading && <span className="pb-2 text-sm text-muted-foreground">Reading sales…</span>}
      </div>

      <div id="print-area" className="space-y-4">
        {groups.length === 0 && !sold.isLoading && <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Nothing to order right now.</p>}
        {groups.map((co) => {
          const list = shown.filter((r) => r.company === co);
          const sup = suppliers.find((s) => s.name.trim().toLowerCase() === co.trim().toLowerCase());
          return (
            <section key={co} className="overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-3">
                <div className="mr-auto">
                  <div className="font-semibold">{co}</div>
                  <div className="text-xs text-muted-foreground">{ordered(list).length} items · approx. {taka(total(list))} at last purchase price</div>
                </div>
                <Button size="sm" className="bg-[#25D366] text-white hover:bg-[#1ebe5b] print:hidden" disabled={ordered(list).length === 0}
                  onClick={() => openWhatsApp(sup?.phone, orderText(co))}>
                  <MessageCircle className="mr-1.5 h-4 w-4" />Send order
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-4 py-2">Product</th>
                    <th className="px-2 py-2">In stock</th>
                    <th className="hidden px-2 py-2 sm:table-cell">Sold (30 d)</th>
                    <th className="hidden px-2 py-2 md:table-cell">Lasts</th>
                    <th className="px-4 py-2 text-right">Order</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const b = boxes(r.m.id, r.suggest);
                    return (
                      <tr key={r.m.id} className={cn("border-b last:border-0", b === 0 && "text-muted-foreground")}>
                        <td className="px-4 py-2 font-medium">{r.m.name} {r.m.strength}</td>
                        <td className={cn("px-2 py-2 whitespace-nowrap", r.stock <= 0 && "font-medium text-destructive")}>{r.stock <= 0 ? "Out" : stockLabel(r.stock, r.m)}</td>
                        <td className="hidden px-2 py-2 sm:table-cell">{r.s30 ? stockLabel(r.s30, r.m) : "—"}</td>
                        <td className="hidden px-2 py-2 md:table-cell">
                          {r.daysLeft == null ? <span className="text-muted-foreground">no sales</span>
                            : <span className={r.daysLeft < 7 ? "font-medium text-destructive" : r.daysLeft < 15 ? "text-amber-600" : ""}>{r.daysLeft} days</span>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="inline-flex items-center gap-1.5">
                            <Input type="number" min={0} value={qty[r.m.id] ?? String(r.suggest)} onChange={(e) => setQty((q) => ({ ...q, [r.m.id]: e.target.value }))}
                              className="h-8 w-16 text-right print:border-0" aria-label={`Order quantity for ${r.m.name}`} />
                            <span className="w-10 text-left text-xs text-muted-foreground">{r.pack > 1 ? "box" : r.m.sale_unit}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </div>
  );
}
