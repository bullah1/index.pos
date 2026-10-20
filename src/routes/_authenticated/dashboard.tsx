import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, TrendingUp, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bdToday, daysUntil, taka } from "@/lib/format";
import { dailyReport, type RItem, type RSale } from "@/lib/report";
import { fetchAll, medicinesQuery, settingsQuery } from "@/lib/queries";
import { isLowStock } from "@/lib/pack";
import { sellableStock } from "@/lib/pos";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Pharmacy POS" },
      { name: "description", content: "Daily sales, gross profit, dues and stock alerts." },
      { property: "og:title", content: "Dashboard — Pharmacy POS" },
      { property: "og:description", content: "Daily sales, gross profit, dues and stock alerts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function dhakaStartIso(day: string) {
  return new Date(day + "T00:00:00+06:00").toISOString();
}
function addDays(day: string, n: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function Dashboard() {
  const { role } = Route.useRouteContext();
  const isMgr = role === "admin" || role === "manager";
  const today = bdToday();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);

  const report = useQuery({
    queryKey: ["report", from, to],
    queryFn: async () => {
      const sales = await fetchAll<RSale>((a, b) => supabase.from("sales").select("id, created_at, total, returned_amount, due")
        .gte("created_at", dhakaStartIso(from)).lt("created_at", dhakaStartIso(addDays(to, 1))).order("created_at").order("id").range(a, b));
      const ids = sales.map((s) => s.id);
      const items: RItem[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const chunk = ids.slice(i, i + 150);
        items.push(...(await fetchAll<RItem>((a, b) => supabase.from("sale_items").select("sale_id, qty, returned_qty, unit_cost").in("sale_id", chunk).order("id").range(a, b))));
      }
      let expenses = 0, supplierPaid = 0, supplierOwed = 0;
      if (isMgr) {
        const [ex, sp, pu] = await Promise.all([
          fetchAll<{ amount: number }>((a, b) => supabase.from("expenses").select("amount").gte("expense_date", from).lte("expense_date", to).order("id").range(a, b)),
          fetchAll<{ amount: number }>((a, b) => supabase.from("supplier_payments").select("amount").gte("payment_date", from).lte("payment_date", to).order("id").range(a, b)),
          fetchAll<{ total: number; paid: number }>((a, b) => supabase.from("purchases").select("total, paid").order("id").range(a, b)),
        ]);
        expenses = ex.reduce((a, x) => a + Number(x.amount), 0);
        supplierPaid = sp.reduce((a, x) => a + Number(x.amount), 0);
        supplierOwed = pu.reduce((a, x) => a + Number(x.total) - Number(x.paid), 0);
      }
      return { rows: dailyReport(sales, items), expenses, supplierPaid, supplierOwed };
    },
  });

  const { data: meds } = useSuspenseQuery(medicinesQuery);
  const { data: settings } = useSuspenseQuery(settingsQuery);

  const alerts = useMemo(() => {
    let low = 0, expiring = 0, expired = 0;
    for (const m of meds) {
      if (!m.is_active) continue;
      if (isLowStock(sellableStock(m.batches, today), m, settings.low_stock_threshold)) low++;
      for (const b of m.batches) {
        if (Number(b.qty_on_hand) <= 0) continue;
        const d = daysUntil(b.expiry_date, today);
        if (d < 0) expired++;
        else if (d <= settings.expiry_alert_days) expiring++;
      }
    }
    return { low, expiring, expired };
  }, [meds, settings, today]);

  const rows = report.data?.rows ?? [];
  const tot = rows.reduce((a, r) => ({ sales: a.sales + r.sales, profit: a.profit + r.profit, invoices: a.invoices + r.invoices, due: a.due + r.due }), { sales: 0, profit: 0, invoices: 0, due: 0 });
  const todayRow = rows.find((r) => r.day === today);
  const max = Math.max(1, ...rows.map((r) => r.sales));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={TrendingUp} label="Today's sales" value={taka(todayRow?.sales)} sub={`${todayRow?.invoices ?? 0} invoices`} />
        <Stat icon={Wallet} label="Today's gross profit" value={taka(todayRow?.profit)} sub={`Due today ${taka(todayRow?.due)}`} />
        <Stat icon={AlertTriangle} label="Low stock medicines" value={String(alerts.low)} sub={`${settings.low_stock_threshold} box/bottle or less`} />
        <Stat icon={CalendarClock} label="Expiring batches" value={String(alerts.expiring)} sub={`${alerts.expired} already expired`} />
      </div>

      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="mr-auto font-semibold">Daily sales & profit</h2>
          <div><Label htmlFor="f">From</Label><Input id="f" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="t">To</Label><Input id="t" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></div>
        </div>

        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
          <Mini label="Net sales" value={taka(tot.sales)} />
          <Mini label="Gross profit" value={taka(tot.profit)} />
          {isMgr && <Mini label="Expenses" value={taka(report.data?.expenses)} />}
          {isMgr && <Mini label="Net profit" value={taka(tot.profit - (report.data?.expenses ?? 0))} />}
          {!isMgr && <Mini label="Invoices" value={String(tot.invoices)} />}
        </div>
        {isMgr && (
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
            <Mini label="Paid to suppliers (cash out)" value={taka(report.data?.supplierPaid)} />
            <Mini label="Still owed to suppliers" value={taka(report.data?.supplierOwed)} />
            <p className="text-xs text-muted-foreground sm:col-span-2">Supplier payments are not deducted from profit — medicine cost is already counted when it is sold.</p>
          </div>
        )}

        {report.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          : report.error ? <p className="mt-4 text-sm text-destructive">Could not load the report.</p>
          : rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No sales in this period.</p>
          : (
            <Table className="mt-4">
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead className="text-right">Invoices</TableHead>
                <TableHead className="w-1/4">Sales</TableHead><TableHead className="text-right">Net sales</TableHead>
                <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Due</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.day}>
                    <TableCell className="whitespace-nowrap">{r.day}</TableCell>
                    <TableCell className="text-right">{r.invoices}</TableCell>
                    <TableCell><div className="h-2 rounded bg-primary" style={{ width: `${(r.sales / max) * 100}%` }} /></TableCell>
                    <TableCell className="text-right">{taka(r.sales)}</TableCell>
                    <TableCell className="text-right">{taka(r.cost)}</TableCell>
                    <TableCell className="text-right font-medium">{taka(r.profit)}</TableCell>
                    <TableCell className="text-right">{taka(r.due)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        {!isMgr && <p className="mt-3 text-xs text-muted-foreground">Showing only your own sales.</p>}
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: typeof TrendingUp; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4 text-primary" />{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-muted p-3"><div className="text-muted-foreground">{label}</div><div className="text-lg font-semibold">{value}</div></div>;
}
