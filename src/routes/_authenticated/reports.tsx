import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, Package, Receipt, ShoppingBag, TrendingUp, Users, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { bdDateTime, bdToday, taka } from "@/lib/format";
import {
  customerReport, dailyReport, periodReport, productReport, saleProfits, toCsv,
  type DItem, type DSale, type RItem, type RSale,
} from "@/lib/report";
import { fetchAll } from "@/lib/queries";
import { addDays } from "@/lib/cashQuery";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — Pharmacy POS" }, { name: "description", content: "Sales, profit, top customers and top products." }] }),
  component: Reports,
});

const iso = (day: string) => new Date(day + "T00:00:00+06:00").toISOString();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
type Tab = "overview" | "customers" | "sales" | "products";
type Range = "today" | "7d" | "month" | "lastmonth" | "year" | "custom";

function rangeDates(r: Range, today: string, custom: { from: string; to: string }) {
  const y = today.slice(0, 4), m = today.slice(0, 7);
  const firstOfMonth = `${m}-01`;
  const lastMonthStart = new Date(Date.UTC(+y, +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 10);
  switch (r) {
    case "today": return { from: today, to: today };
    case "7d": return { from: addDays(today, -6), to: today };
    case "month": return { from: firstOfMonth, to: today };
    case "lastmonth": return { from: lastMonthStart, to: addDays(firstOfMonth, -1) };
    case "year": return { from: `${y}-01-01`, to: today };
    default: return custom;
  }
}

function Reports() {
  const { role } = Route.useRouteContext();
  const isMgr = role === "admin" || role === "manager";
  const today = bdToday();
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<Range>("month");
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const { from, to } = rangeDates(range, today, custom);
  const byMonth = range === "year" || (range === "custom" && from.slice(0, 7) !== to.slice(0, 7) && Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7)) - (Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7))) >= 3);

  const q = useQuery({
    queryKey: ["report-detail", from, to, isMgr],
    queryFn: async () => {
      const sales = await fetchAll<DSale & { customers: DSale["customer"] }>((a, b) => supabase.from("sales")
        .select("id, invoice_no, created_at, status, customer_id, subtotal, item_discount, bill_discount, total, returned_amount, due, customers(*)")
        .gte("created_at", iso(from)).lt("created_at", iso(addDays(to, 1))).order("created_at").order("id").range(a, b));
      const ids = sales.map((s) => s.id);
      const items: (DItem & RItem)[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const rows = await fetchAll<{ sale_id: string; medicine_id: string; medicine_name: string; qty: number; returned_qty: number; unit_cost: number; line_total: number; medicines: { strength: string | null } | null }>((a, b) =>
          supabase.from("sale_items").select("sale_id, medicine_id, medicine_name, qty, returned_qty, unit_cost, line_total, medicines(strength)").in("sale_id", ids.slice(i, i + 150)).order("id").range(a, b));
        items.push(...rows.map((r) => ({ ...r, name: r.medicines?.strength && !r.medicine_name.includes(r.medicines.strength) ? `${r.medicine_name} ${r.medicines.strength}` : r.medicine_name })));
      }
      let expenses: { expense_date: string; amount: number }[] = [];
      if (isMgr) {
        expenses = await fetchAll<{ expense_date: string; amount: number }>((a, b) =>
          supabase.from("expenses").select("expense_date, amount").gte("expense_date", from).lte("expense_date", to).order("id").range(a, b));
      }
      const ds: DSale[] = sales.map((s) => ({ ...s, customer: s.customers ?? null }));
      return { sales: ds, items, expenses };
    },
  });

  const r = useMemo(() => {
    if (!q.data) return null;
    const { sales, items, expenses } = q.data;
    const periods = periodReport(dailyReport(sales as unknown as RSale[], items), expenses, byMonth ? "month" : "day");
    const profits = saleProfits(sales, items);
    return { periods, profits, customers: customerReport(profits, sales), products: productReport(sales, items), expenses: expenses.reduce((a, e) => a + Number(e.amount), 0) };
  }, [q.data, byMonth]);

  const tot = (r?.profits ?? []).reduce((a, p) => ({ sales: a.sales + p.sales, cost: a.cost + p.cost, profit: a.profit + p.profit, due: a.due + p.due }), { sales: 0, cost: 0, profit: 0, due: 0 });
  const bills = r?.profits.length ?? 0;
  const margin = tot.sales > 0 ? Math.round((tot.profit / tot.sales) * 100) : 0;
  const label = (k: string) => (k.length === 7 ? `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(k + "T00:00:00Z")));

  function download() {
    if (!r) return;
    let rows: (string | number)[][] = [];
    if (tab === "overview") rows = [["Period", "Bills", "Net sales", "Cost", "Gross profit", "Due", ...(isMgr ? ["Expenses", "Net profit"] : [])],
      ...r.periods.map((p) => [label(p.day), p.invoices, p.sales, p.cost, p.profit, p.due, ...(isMgr ? [p.expenses, Math.round((p.profit - p.expenses) * 100) / 100] : [])])];
    if (tab === "customers") rows = [["Rank", "Customer", "Type", "Bills", "Bought", "Profit", "Due", "Last purchase"],
      ...r.customers.map((c, i) => [c.key === "walkin" ? "-" : i + 1, c.name, c.b2b ? "B2B" : "Retail", c.bills, c.sales, c.profit, c.due, bdDateTime(c.last)])];
    if (tab === "sales") rows = [["Invoice", "Date", "Customer", "Sale", "Cost", "Profit", "Margin %", "Due"],
      ...r.profits.map((p) => [p.invoice_no, bdDateTime(p.created_at), p.customer, p.sales, p.cost, p.profit, p.margin, p.due])];
    if (tab === "products") rows = [["Product", "Qty sold", "Sales", "Cost", "Profit", "Margin %"], ...r.products.map((p) => [p.name, p.qty, p.sales, p.cost, p.profit, p.margin])];
    const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${tab}-${from}-to-${to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  const RANGES: [Range, string][] = [["today", "Today"], ["7d", "7 days"], ["month", "This month"], ["lastmonth", "Last month"], ["year", "This year"], ["custom", "Custom"]];
  const TABS: [Tab, string, typeof Users][] = [["overview", "Overview", TrendingUp], ["customers", "Top customers", Users], ["sales", "Profit by sale", Receipt], ["products", "Top products", Package]];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">{label(from)} – {label(to)}{from.slice(0, 4) !== to.slice(0, 4) || range === "year" ? "" : ` ${to.slice(0, 4)}`}</p>
        </div>
        <Button variant="outline" size="sm" disabled={!r} onClick={download}><Download className="mr-1.5 h-4 w-4" />Download CSV</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border bg-card p-1">
          {RANGES.map(([k, l]) => (
            <Button key={k} size="sm" variant={range === k ? "secondary" : "ghost"} className="h-8" onClick={() => setRange(k)}>{l}</Button>
          ))}
        </div>
        {range === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input type="date" className="h-9 w-40" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} aria-label="From" />
            <span className="text-muted-foreground">–</span>
            <Input type="date" className="h-9 w-40" value={custom.to} min={custom.from} max={today} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} aria-label="To" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={ShoppingBag} tone="emerald" k="Net sales" v={taka(tot.sales)} sub={`${bills} bill${bills === 1 ? "" : "s"}`} />
        <Kpi icon={TrendingUp} tone="sky" k="Gross profit" v={taka(tot.profit)} sub={`${margin}% margin`} />
        {isMgr ? <Kpi icon={Wallet} tone="amber" k="Expenses" v={taka(r?.expenses)} sub="shop costs" /> : <Kpi icon={Wallet} tone="amber" k="Due created" v={taka(tot.due)} sub="still unpaid" />}
        {isMgr ? <Kpi icon={Receipt} tone="violet" k="Net profit" v={taka(tot.profit - (r?.expenses ?? 0))} sub="profit − expenses" strong /> : <Kpi icon={Receipt} tone="violet" k="Avg. bill" v={taka(bills ? tot.sales / bills : 0)} sub="per sale" />}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {TABS.map(([k, l, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn("-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm", tab === k ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <Icon className="h-4 w-4" />{l}
          </button>
        ))}
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.error && <p className="text-sm text-destructive">Could not load the report.</p>}
      {r && bills === 0 && <p className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">No sales in this period.</p>}

      {r && bills > 0 && tab === "overview" && (
        <section className="rounded-xl border bg-card">
          <div className="grid grid-cols-[1fr_auto] gap-x-4 border-b px-4 py-2 text-xs text-muted-foreground sm:grid-cols-[120px_1fr_90px_110px_110px_100px]">
            <span>{byMonth ? "Month" : "Day"}</span><span className="hidden sm:block">Sales</span><span className="hidden text-right sm:block">Bills</span>
            <span className="hidden text-right sm:block">Net sales</span><span className="text-right">Profit</span><span className="hidden text-right sm:block">Due</span>
          </div>
          {(() => {
            const max = Math.max(1, ...r.periods.map((p) => p.sales));
            return [...r.periods].reverse().map((p) => (
              <div key={p.day} className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-b px-4 py-2 text-sm last:border-0 sm:grid-cols-[120px_1fr_90px_110px_110px_100px]">
                <span className="font-medium">{label(p.day)}<span className="ml-2 text-xs font-normal text-muted-foreground sm:hidden">{taka(p.sales)}</span></span>
                <div className="hidden h-2 rounded-full bg-muted sm:block"><div className="h-2 rounded-full bg-primary" style={{ width: `${(p.sales / max) * 100}%` }} /></div>
                <span className="hidden text-right text-muted-foreground sm:block">{p.invoices}</span>
                <span className="hidden text-right sm:block">{taka(p.sales)}</span>
                <span className="text-right font-medium text-emerald-700">{taka(p.profit)}</span>
                <span className="hidden text-right text-muted-foreground sm:block">{p.due ? taka(p.due) : "—"}</span>
              </div>
            ));
          })()}
        </section>
      )}

      {r && bills > 0 && tab === "customers" && (
        <section className="rounded-xl border bg-card">
          {r.customers.map((c, i) => (
            <div key={c.key} className="flex items-center gap-3 border-b px-4 py-3 last:border-0">
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold", i < 3 && c.key !== "walkin" ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground")}>{c.key === "walkin" ? "—" : i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{c.name}</span>
                  {c.b2b && <Badge className="h-5 bg-indigo-600 px-1.5 text-[10px] hover:bg-indigo-600">B2B</Badge>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{c.sub} · {c.bills} bill{c.bills === 1 ? "" : "s"} · last {bdDateTime(c.last).split(",")[0]}</div>
                <div className="mt-1.5 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${c.share * 100}%` }} /></div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold">{taka(c.sales)}</div>
                <div className="text-xs text-emerald-700">profit {taka(c.profit)}</div>
                {c.due > 0 && <div className="text-xs text-destructive">due {taka(c.due)}</div>}
              </div>
            </div>
          ))}
        </section>
      )}

      {r && bills > 0 && tab === "sales" && <SalesProfit rows={r.profits} />}

      {r && bills > 0 && tab === "products" && (
        <section className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2">#</th><th className="px-2 py-2">Product</th><th className="px-2 py-2 text-right">Sold</th><th className="px-2 py-2 text-right">Sales</th><th className="hidden px-2 py-2 text-right sm:table-cell">Cost</th><th className="px-2 py-2 text-right">Profit</th><th className="px-4 py-2 text-right">Margin</th></tr>
            </thead>
            <tbody>
              {r.products.map((p, i) => (
                <tr key={p.medicine_id} className="border-b last:border-0">
                  <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-2 font-medium">{p.name}</td>
                  <td className="px-2 py-2 text-right">{p.qty}</td>
                  <td className="px-2 py-2 text-right">{taka(p.sales)}</td>
                  <td className="hidden px-2 py-2 text-right text-muted-foreground sm:table-cell">{taka(p.cost)}</td>
                  <td className="px-2 py-2 text-right font-semibold text-emerald-700">{taka(p.profit)}</td>
                  <td className="px-4 py-2 text-right"><MarginPill m={p.margin} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-xs text-muted-foreground">Profit = what the customer paid (after discounts and returns) − the purchase price of the items. Cancelled bills are not counted. Net profit also takes away shop expenses.</p>
    </div>
  );
}

function SalesProfit({ rows }: { rows: ReturnType<typeof saleProfits> }) {
  const [sort, setSort] = useState<"profit" | "date" | "margin">("profit");
  const list = [...rows].sort((a, b) => sort === "date" ? b.created_at.localeCompare(a.created_at) : sort === "margin" ? b.margin - a.margin : b.profit - a.profit);
  return (
    <section className="overflow-x-auto rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
        Sort by
        {(["profit", "margin", "date"] as const).map((k) => (
          <Button key={k} size="sm" variant={sort === k ? "secondary" : "ghost"} className="h-7 capitalize" onClick={() => setSort(k)}>{k === "date" ? "Newest" : k}</Button>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr><th className="px-4 py-2">Invoice</th><th className="hidden px-2 py-2 md:table-cell">Date</th><th className="px-2 py-2">Customer</th><th className="px-2 py-2 text-right">Sale</th><th className="hidden px-2 py-2 text-right sm:table-cell">Cost</th><th className="px-2 py-2 text-right">Profit</th><th className="px-4 py-2 text-right">Margin</th></tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id} className="border-b last:border-0">
              <td className="px-4 py-2 font-medium">{p.invoice_no}</td>
              <td className="hidden whitespace-nowrap px-2 py-2 text-muted-foreground md:table-cell">{bdDateTime(p.created_at)}</td>
              <td className="px-2 py-2"><span className="flex items-center gap-1">{p.customer}{p.b2b && <Badge className="h-4 bg-indigo-600 px-1 text-[9px] hover:bg-indigo-600">B2B</Badge>}</span></td>
              <td className="px-2 py-2 text-right">{taka(p.sales)}</td>
              <td className="hidden px-2 py-2 text-right text-muted-foreground sm:table-cell">{taka(p.cost)}</td>
              <td className={cn("px-2 py-2 text-right font-semibold", p.profit < 0 ? "text-destructive" : "text-emerald-700")}>{taka(p.profit)}</td>
              <td className="px-4 py-2 text-right"><MarginPill m={p.margin} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MarginPill({ m }: { m: number }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", m < 10 ? "bg-rose-50 text-rose-700" : m < 30 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>{m}%</span>;
}

const TONES: Record<string, string> = { emerald: "bg-emerald-50 text-emerald-600", sky: "bg-sky-50 text-sky-600", amber: "bg-amber-50 text-amber-600", violet: "bg-violet-50 text-violet-600" };
function Kpi({ icon: Icon, tone, k, v, sub, strong }: { icon: typeof Users; tone: string; k: string; v: string; sub: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-3 sm:p-4", strong && "border-primary/40 bg-primary/5")}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground sm:text-sm">{k}</span>
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg", TONES[tone])}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{v}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
