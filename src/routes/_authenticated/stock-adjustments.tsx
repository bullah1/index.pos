import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/queries";
import { bdDateTime, bdToday, errMsg, taka } from "@/lib/format";
import { toCsv } from "@/lib/report";
import { ADJ_REASONS, reasonLabel } from "@/components/StockAdjust";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/stock-adjustments")({
  head: () => ({ meta: [{ title: "Stock Adjustments — Pharmacy POS" }, { name: "description", content: "History of stock corrections, damage, expiry and opening stock." }] }),
  component: StockAdjustments,
});

type Row = {
  id: string; adj_no: string; created_at: string; created_by: string; reason: string; note: string | null;
  qty_before: number; qty_change: number; qty_after: number; unit_cost: number;
  medicines: { name: string; strength: string | null } | null;
  medicine_batches: { batch_no: string; expiry_date: string } | null;
};

function monthStart(d: string) { return d.slice(0, 8) + "01"; }
const iso = (day: string) => new Date(day + "T00:00:00+06:00").toISOString();
const nextDay = (day: string) => { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

function StockAdjustments() {
  const { role } = Route.useRouteContext();
  const today = bdToday();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("all");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["stock-adjustments", from, to],
    queryFn: async () => {
      const [rows, people] = await Promise.all([
        fetchAll<Row>((a, b) => supabase.from("stock_adjustments")
          .select("id, adj_no, created_at, created_by, reason, note, qty_before, qty_change, qty_after, unit_cost, medicines(name, strength), medicine_batches(batch_no, expiry_date)")
          .gte("created_at", iso(from)).lt("created_at", iso(nextDay(to)))
          .order("created_at", { ascending: false }).order("id").range(a, b) as never),
        supabase.from("profiles").select("id, full_name"),
      ]);
      return { rows, names: new Map((people.data ?? []).map((p) => [p.id, p.full_name])) };
    },
  });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list.data?.rows ?? []).filter((r) =>
      (reason === "all" || r.reason === reason) &&
      (!s || [r.medicines?.name, r.medicine_batches?.batch_no, r.adj_no, r.note].some((f) => f?.toLowerCase().includes(s))));
  }, [list.data, reason, q]);

  if (role !== "admin" && role !== "manager") return <p className="text-muted-foreground">Only managers can see stock adjustments.</p>;

  const value = (r: Row) => Number(r.qty_change) * Number(r.unit_cost);
  const added = rows.filter((r) => r.qty_change > 0).reduce((a, r) => a + value(r), 0);
  const removed = rows.filter((r) => r.qty_change < 0).reduce((a, r) => a - value(r), 0);

  function download() {
    const csv = toCsv([
      ["No", "Date", "Medicine", "Batch", "Reason", "Before", "Change", "After", "Cost/unit", "Value", "By", "Note"],
      ...rows.map((r) => [r.adj_no, bdDateTime(r.created_at), `${r.medicines?.name ?? ""} ${r.medicines?.strength ?? ""}`.trim(), r.medicine_batches?.batch_no ?? "",
        reasonLabel(r.reason), Number(r.qty_before), Number(r.qty_change), Number(r.qty_after), Number(r.unit_cost), Math.round(value(r) * 100) / 100,
        list.data?.names.get(r.created_by) ?? "", r.note ?? ""]),
    ]);
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `stock-adjustments-${from}-to-${to}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Stock Adjustments</h1>
        <Button variant="outline" size="sm" disabled={!rows.length} onClick={download}><Download className="mr-1 h-4 w-4" />CSV</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        To adjust, open <Link to="/inventory" className="text-primary underline-offset-4 hover:underline">Medicines / Inventory</Link>, expand a medicine and press <b>Adjust</b> on a batch, or <b>Add stock</b> for opening stock.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor="sa-f">From</Label><Input id="sa-f" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="sa-t">To</Label><Input id="sa-t" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></div>
        <div>
          <Label>Reason</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasons</SelectItem>
              {ADJ_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Input className="max-w-xs" placeholder="Medicine, batch or note…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-md bg-muted px-3 py-2"><div className="text-xs text-muted-foreground">Adjustments</div><div className="text-lg font-semibold">{rows.length}</div></div>
        <div className="rounded-md bg-muted px-3 py-2"><div className="text-xs text-muted-foreground">Stock added (at cost)</div><div className="text-lg font-semibold">{taka(added)}</div></div>
        <div className="rounded-md bg-muted px-3 py-2"><div className="text-xs text-muted-foreground">Stock removed / loss (at cost)</div><div className="text-lg font-semibold text-destructive">{taka(removed)}</div></div>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader><TableRow>
            <TableHead>No. / date</TableHead><TableHead>Medicine / batch</TableHead><TableHead>Reason</TableHead>
            <TableHead className="text-right">Before</TableHead><TableHead className="text-right">Change</TableHead><TableHead className="text-right">After</TableHead>
            <TableHead className="text-right">Value</TableHead><TableHead>By</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {list.isLoading && <TableRow><TableCell colSpan={8} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {list.error && <TableRow><TableCell colSpan={8} className="text-destructive">{errMsg(list.error)}</TableCell></TableRow>}
            {!list.isLoading && !list.error && rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No adjustments in this period.</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><div className="font-medium">{r.adj_no}</div><div className="text-xs text-muted-foreground">{bdDateTime(r.created_at)}</div></TableCell>
                <TableCell>
                  <div className="font-medium">{r.medicines?.name} {r.medicines?.strength}</div>
                  <div className="text-xs text-muted-foreground">{r.medicine_batches?.batch_no} · exp {r.medicine_batches?.expiry_date}</div>
                </TableCell>
                <TableCell>{reasonLabel(r.reason)}{r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}</TableCell>
                <TableCell className="text-right">{Number(r.qty_before)}</TableCell>
                <TableCell className={cn("text-right font-semibold", r.qty_change > 0 ? "text-primary" : "text-destructive")}>{r.qty_change > 0 ? "+" : ""}{Number(r.qty_change)}</TableCell>
                <TableCell className="text-right">{Number(r.qty_after)}</TableCell>
                <TableCell className="text-right">{value(r) < 0 ? "−" : "+"}{taka(Math.abs(value(r)))}</TableCell>
                <TableCell>{list.data?.names.get(r.created_by) || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
