import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bdToday, taka } from "@/lib/format";
import { dailyReport, periodReport, toCsv, type RItem, type RSale } from "@/lib/report";
import { fetchAll } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Pharmacy POS" },
      { name: "description", content: "Monthly and yearly sales, gross profit and expense reports with CSV download." },
      { property: "og:title", content: "Reports — Pharmacy POS" },
      { property: "og:description", content: "Monthly and yearly pharmacy reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Reports,
});

const iso = (day: string) => new Date(day + "T00:00:00+06:00").toISOString();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Reports() {
  const { role } = Route.useRouteContext();
  const isMgr = role === "admin" || role === "manager";
  const today = bdToday();
  const [mode, setMode] = useState<"month" | "year">("month");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(today.slice(0, 4));

  const from = mode === "month" ? `${month}-01` : `${year}-01-01`;
  const to = mode === "month"
    ? new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString().slice(0, 10)
    : `${+year + 1}-01-01`; // exclusive

  const q = useQuery({
    queryKey: ["report-period", from, to, isMgr],
    queryFn: async () => {
      const sales = await fetchAll<RSale>((a, b) => supabase.from("sales").select("id, created_at, total, returned_amount, due")
        .gte("created_at", iso(from)).lt("created_at", iso(to)).order("created_at").order("id").range(a, b));
      const ids = sales.map((s) => s.id);
      const items: RItem[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const chunk = ids.slice(i, i + 150);
        items.push(...(await fetchAll<RItem>((a, b) => supabase.from("sale_items").select("sale_id, qty, returned_qty, unit_cost").in("sale_id", chunk).order("id").range(a, b))));
      }
      let expenses: { expense_date: string; amount: number }[] = [];
      if (isMgr) {
        expenses = await fetchAll<{ expense_date: string; amount: number }>((a, b) =>
          supabase.from("expenses").select("expense_date, amount").gte("expense_date", from).lt("expense_date", to).order("id").range(a, b));
      }
      return periodReport(dailyReport(sales, items), expenses, mode === "year" ? "month" : "day");
    },
  });

  const rows = q.data ?? [];
  const tot = rows.reduce((a, r) => ({ invoices: a.invoices + r.invoices, sales: a.sales + r.sales, cost: a.cost + r.cost, profit: a.profit + r.profit, due: a.due + r.due, expenses: a.expenses + r.expenses }),
    { invoices: 0, sales: 0, cost: 0, profit: 0, due: 0, expenses: 0 });
  const label = (k: string) => (mode === "year" ? `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` : k);
  const r2 = (n: number) => Math.round(n * 100) / 100;

  function download() {
    const head = ["Period", "Invoices", "Net sales", "Cost of goods sold", "Gross profit (est.)", "Due created", ...(isMgr ? ["Expenses", "Net profit (est.)"] : [])];
    const line = (k: string, r: typeof tot) => [k, r.invoices, r2(r.sales), r2(r.cost), r2(r.profit), r2(r.due), ...(isMgr ? [r2(r.expenses), r2(r.profit - r.expenses)] : [])];
    const csv = toCsv([head, ...rows.map((r) => line(label(r.day), r)), line("Total", tot)]);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `report-${mode === "month" ? month : year}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <div><Label>Report type</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as "month" | "year")}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="month">Monthly</SelectItem><SelectItem value="year">Yearly</SelectItem></SelectContent>
          </Select>
        </div>
        {mode === "month"
          ? <div><Label htmlFor="m">Month</Label><Input id="m" type="month" max={today.slice(0, 7)} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>
          : <div><Label htmlFor="y">Year</Label><Input id="y" type="number" min={2020} max={+today.slice(0, 4)} value={year} onChange={(e) => e.target.value.length === 4 && setYear(e.target.value)} className="w-28" /></div>}
        <Button className="ml-auto" variant="outline" disabled={!rows.length} onClick={download}><Download className="mr-2 h-4 w-4" />Download CSV</Button>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-4">
        <Mini k="Net sales" v={taka(tot.sales)} />
        <Mini k="Gross profit (est.)" v={taka(tot.profit)} />
        {isMgr ? <Mini k="Expenses" v={taka(tot.expenses)} /> : <Mini k="Invoices" v={String(tot.invoices)} />}
        {isMgr ? <Mini k="Net profit (est.)" v={taka(tot.profit - tot.expenses)} /> : <Mini k="Due created" v={taka(tot.due)} />}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{mode === "year" ? "Month" : "Day"}</TableHead><TableHead className="text-right">Invoices</TableHead>
            <TableHead className="text-right">Net sales</TableHead><TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Gross profit</TableHead><TableHead className="text-right">Due</TableHead>
            {isMgr && <TableHead className="text-right">Expenses</TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {q.isLoading && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {q.error && <TableRow><TableCell colSpan={7} className="text-destructive">Could not load the report.</TableCell></TableRow>}
            {!q.isLoading && !q.error && rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No records in this period.</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.day}>
                <TableCell>{label(r.day)}</TableCell><TableCell className="text-right">{r.invoices}</TableCell>
                <TableCell className="text-right">{taka(r.sales)}</TableCell><TableCell className="text-right">{taka(r.cost)}</TableCell>
                <TableCell className="text-right font-medium">{taka(r.profit)}</TableCell><TableCell className="text-right">{taka(r.due)}</TableCell>
                {isMgr && <TableCell className="text-right">{taka(r.expenses)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
          {rows.length > 0 && (
            <TableFooter><TableRow>
              <TableCell>Total</TableCell><TableCell className="text-right">{tot.invoices}</TableCell>
              <TableCell className="text-right">{taka(tot.sales)}</TableCell><TableCell className="text-right">{taka(tot.cost)}</TableCell>
              <TableCell className="text-right">{taka(tot.profit)}</TableCell><TableCell className="text-right">{taka(tot.due)}</TableCell>
              {isMgr && <TableCell className="text-right">{taka(tot.expenses)}</TableCell>}
            </TableRow></TableFooter>
          )}
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">Gross profit = net sales after discounts and returns minus the actual batch cost of items sold. Supplier payments are not counted again. Net profit also subtracts expenses.</p>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return <div className="rounded-md bg-muted px-3 py-2"><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-semibold">{v}</div></div>;
}
