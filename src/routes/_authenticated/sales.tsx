import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { bdDateTime, bdToday, errMsg, taka } from "@/lib/format";
import { PAY_METHODS, returnValue, splitRefund, type PayMethod } from "@/lib/pos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReceiptDialog } from "@/components/Receipt";
import { CourierDialog, COURIER_STATUS } from "@/components/CourierDialog";
import { Truck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sales")({
  head: () => ({ meta: [{ title: "Sales History — Pharmacy POS" }, { name: "description", content: "Find invoices, view sale details, process returns and cancellations." }] }),
  component: SalesPage,
});

const STATUS: Record<string, { label: string; v: "default" | "secondary" | "destructive" | "outline" }> = {
  completed: { label: "Completed", v: "secondary" },
  partially_returned: { label: "Partly returned", v: "outline" },
  returned: { label: "Returned", v: "outline" },
  cancelled: { label: "Cancelled", v: "destructive" },
};

function daysAgo(n: number) { return bdToday(new Date(Date.now() - n * 86400000)); }

function SalesPage() {
  const { role } = Route.useRouteContext();
  const isMgr = role === "admin" || role === "manager";
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(bdToday());
  const [openId, setOpenId] = useState<string | null>(null);
  const [courierId, setCourierId] = useState<string | null>(null);

  const { data = [], isLoading, error: loadError } = useQuery({
    queryKey: ["sales", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales")
        .select("*, customers(name, phone)")
        .gte("created_at", `${from}T00:00:00+06:00`).lte("created_at", `${to}T23:59:59.999+06:00`)
        .order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data;
    },
  });
  // Courier status is optional: if the courier table isn't set up yet, the sales list still works.
  const saleIds = data.map((r) => r.id);
  const { data: couriers } = useQuery({
    queryKey: ["sales-couriers", from, to, saleIds.length],
    enabled: saleIds.length > 0,
    retry: false,
    queryFn: async () => {
      const out = new Map<string, { status: string }[]>();
      for (let i = 0; i < saleIds.length; i += 150) {
        const { data: c, error } = await supabase.from("courier_orders").select("sale_id, status").in("sale_id", saleIds.slice(i, i + 150));
        if (error) return out;
        for (const x of c ?? []) out.set(x.sale_id, [...(out.get(x.sale_id) ?? []), { status: x.status }]);
      }
      return out;
    },
  });
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return data.filter((r) => [r.invoice_no, r.customers?.name, r.customers?.phone].some((f) => f?.toLowerCase().includes(s)));
  }, [q, data]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Sales History</h1>
      {data.length >= 1000 && <p className="text-xs text-muted-foreground">Showing the latest 1000 sales — narrow the dates to see older ones.</p>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice no, customer name or phone…" className="pl-9" />
        </div>
        <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="p-2">Invoice</th><th className="p-2">Date</th><th className="p-2">Customer</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Due</th><th className="p-2">Status</th><th className="p-2">Courier</th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {loadError && <tr><td colSpan={7} className="p-6 text-center text-destructive">Could not load sales: {errMsg(loadError)}</td></tr>}
            {!isLoading && !loadError && rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No sales found for this period.</td></tr>}
            {rows.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, v: "outline" as const };
              return (
                <tr key={r.id} className="cursor-pointer border-b last:border-0 hover:bg-accent/50" onClick={() => setOpenId(r.id)}>
                  <td className="p-2 font-medium">{r.invoice_no}</td>
                  <td className="p-2 whitespace-nowrap">{bdDateTime(r.created_at)}</td>
                  <td className="p-2">{r.customers?.name ?? "Walk-in"}</td>
                  <td className="p-2 text-right">{taka(Number(r.total) - Number(r.returned_amount))}</td>
                  <td className="p-2 text-right">{Number(r.due) > 0 ? taka(r.due) : "—"}</td>
                  <td className="p-2"><Badge variant={st.v}>{st.label}</Badge></td>
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const c = (couriers?.get(r.id) ?? []).find((x) => x.status !== "cancelled");
                      if (c) return (
                        <button type="button" onClick={() => setCourierId(r.id)} className="text-left">
                          <Badge variant={COURIER_STATUS[c.status]?.tone ?? "outline"}><Truck className="mr-1 h-3 w-3" />{COURIER_STATUS[c.status]?.label ?? c.status}</Badge>
                        </button>
                      );
                      if (r.status === "cancelled" || r.status === "returned") return <span className="text-muted-foreground">—</span>;
                      return <Button size="sm" variant="outline" className="h-7" onClick={() => setCourierId(r.id)}><Truck className="mr-1 h-3.5 w-3.5" />Courier</Button>;
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {courierId && <CourierDialog saleId={courierId} onClose={() => setCourierId(null)} />}
      <SaleDetail key={openId ?? "none"} saleId={openId} isMgr={isMgr} onClose={() => setOpenId(null)} />
    </div>
  );
}

function SaleDetail({ saleId, isMgr, onClose }: { saleId: string | null; isMgr: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"view" | "return" | "cancel">("view");
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PayMethod>("cash");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [receipt, setReceipt] = useState<string | null>(null);

  const { data, error: detailError } = useQuery({
    queryKey: ["sale-detail", saleId],
    enabled: !!saleId,
    queryFn: async () => {
      const [s, i, p, r] = await Promise.all([
        supabase.from("sales").select("*, customers(name, phone)").eq("id", saleId!).single(),
        supabase.from("sale_items").select("*").eq("sale_id", saleId!),
        supabase.from("sale_payments").select("*").eq("sale_id", saleId!).order("created_at"),
        supabase.from("sale_returns").select("*").eq("sale_id", saleId!).order("created_at"),
      ]);
      if (s.error) throw s.error;
      return { sale: s.data, items: i.data ?? [], payments: p.data ?? [], returns: r.data ?? [] };
    },
  });

  function close() { setMode("view"); setQtys({}); setReason(""); onClose(); }

  const preview = useMemo(() => {
    if (!data) return null;
    const lines = mode === "cancel"
      ? data.items.map((i) => ({ line_total: i.line_total, qty: i.qty, returnQty: Number(i.qty) - Number(i.returned_qty) }))
      : data.items.map((i) => ({ line_total: i.line_total, qty: i.qty, returnQty: qtys[i.id] ?? 0 }));
    const value = mode === "cancel" ? Number(data.sale.total) - Number(data.sale.returned_amount) : returnValue(data.sale, lines);
    return { value, ...splitRefund(value, Number(data.sale.due)) };
  }, [data, qtys, mode]);

  async function submit() {
    if (!data || busy) return;
    if (mode === "return" && !Object.values(qtys).some((v) => v > 0)) { toast.error("Enter a quantity to return"); return; }
    setBusy(true);
    const { data: res, error } = await supabase.rpc("return_sale", {
      p: {
        idempotency_key: key, sale_id: data.sale.id, cancel: mode === "cancel", refund_method: method, reason,
        items: Object.entries(qtys).filter(([, v]) => v > 0).map(([sale_item_id, qty]) => ({ sale_item_id, qty })),
      } as never,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const r = res as { return_no: string; refund: number; due_reduced: number };
    toast.success(`${r.return_no}: refund ${taka(r.refund)}${r.due_reduced > 0 ? `, due reduced ${taka(r.due_reduced)}` : ""}`);
    setKey(crypto.randomUUID()); setMode("view"); setQtys({}); setReason("");
    for (const k of [["sale-detail", saleId], ["sales"], ["medicines"], ["sale", saleId]]) qc.invalidateQueries({ queryKey: k });
  }

  const s = data?.sale;
  const open = s && s.status !== "cancelled" && s.status !== "returned";

  return (
    <>
      <Dialog open={!!saleId} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {detailError && <p className="text-sm text-destructive">Could not load this sale: {errMsg(detailError)}</p>}
          <DialogHeader><DialogTitle>{s ? `${s.invoice_no} · ${bdDateTime(s.created_at)}` : "Loading…"}</DialogTitle></DialogHeader>
          {data && s && (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span>Customer: <b>{s.customers?.name ?? "Walk-in"}</b>{s.customers?.phone && ` · ${s.customers.phone}`}</span>
                <Badge variant={STATUS[s.status]?.v ?? "secondary"}>{STATUS[s.status]?.label ?? s.status}</Badge>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full">
                  <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr><th className="p-2">Medicine / batch</th><th className="p-2">Qty</th><th className="p-2">Price</th><th className="p-2 text-right">Total</th>{mode === "return" && <th className="p-2">Return</th>}</tr>
                  </thead>
                  <tbody>
                    {data.items.map((i) => {
                      const left = Number(i.qty) - Number(i.returned_qty);
                      return (
                        <tr key={i.id} className="border-b last:border-0">
                          <td className="p-2"><div className="font-medium">{i.medicine_name}</div><div className="text-xs text-muted-foreground">{i.batch_no} · exp {i.expiry_date}</div></td>
                          <td className="p-2">{i.qty}{Number(i.returned_qty) > 0 && <div className="text-xs text-muted-foreground">{i.returned_qty} returned</div>}</td>
                          <td className="p-2">{taka(i.unit_price)}{Number(i.discount) > 0 && <div className="text-xs text-muted-foreground">−{taka(i.discount)}</div>}</td>
                          <td className="p-2 text-right">{taka(i.line_total)}</td>
                          {mode === "return" && <td className="p-2"><Input type="number" min={0} max={left} disabled={left <= 0} value={qtys[i.id] ?? 0} className="h-7 w-20"
                            onChange={(e) => setQtys((q) => ({ ...q, [i.id]: Math.min(left, Math.max(0, Number(e.target.value))) }))} /></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Row k="Subtotal" v={taka(s.subtotal)} />
                  {Number(s.item_discount) > 0 && <Row k="Item discount" v={"−" + taka(s.item_discount)} />}
                  {Number(s.bill_discount) > 0 && <Row k="Bill discount" v={"−" + taka(s.bill_discount)} />}
                  <Row k="Total" v={taka(s.total)} b />
                  {Number(s.returned_amount) > 0 && <Row k="Returned" v={"−" + taka(s.returned_amount)} />}
                  <Row k="Paid" v={taka(s.paid)} />
                  {Number(s.refunded) > 0 && <Row k="Refunded" v={"−" + taka(s.refunded)} />}
                  <Row k="Due" v={taka(s.due)} b />
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Payments</div>
                  {data.payments.map((p) => <Row key={p.id} k={`${p.kind === "refund" ? "Refund" : "Paid"} · ${PAY_METHODS.find((m) => m.value === p.method)?.label}`} v={(p.kind === "refund" ? "−" : "") + taka(p.amount)} />)}
                  {data.returns.length > 0 && <div className="pt-2 text-xs font-medium text-muted-foreground">Returns</div>}
                  {data.returns.map((r) => <Row key={r.id} k={`${r.return_no} (${r.kind}) ${bdDateTime(r.created_at)}`} v={taka(r.amount)} />)}
                </div>
              </div>

              {mode !== "view" && preview && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                  <div className="font-medium">{mode === "cancel" ? "Cancel whole sale — all items go back to stock" : "Return selected items to stock"}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div><Label className="text-xs">Refund method</Label>
                      <Select value={method} onValueChange={(v) => setMethod(v as PayMethod)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label className="text-xs">Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" /></div>
                  </div>
                  <Row k="Return value" v={taka(preview.value)} />
                  {preview.dueReduced > 0 && <Row k="Clears customer due" v={taka(preview.dueReduced)} />}
                  <Row k="Refund to customer" v={taka(preview.refund)} b />
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {mode === "view" ? (
              <>
                <Button variant="outline" onClick={() => setReceipt(saleId)}>Print receipt</Button>
                {isMgr && open && <Button variant="outline" onClick={() => setMode("return")}>Return items</Button>}
                {isMgr && open && Number(s?.returned_amount) === 0 && <Button variant="destructive" onClick={() => setMode("cancel")}>Cancel sale</Button>}
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => { setMode("view"); setQtys({}); }}>Back</Button>
                <Button variant={mode === "cancel" ? "destructive" : "default"} disabled={busy} onClick={submit}>
                  {busy ? "Saving…" : mode === "cancel" ? "Confirm cancellation" : "Confirm return"}
                </Button>
              </>
            )}
          </DialogFooter>
          {!isMgr && <p className="text-xs text-muted-foreground">Only managers can process returns or cancellations.</p>}
        </DialogContent>
      </Dialog>
      <ReceiptDialog saleId={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}

function Row({ k, v, b }: { k: string; v: string; b?: boolean }) {
  return <div className={b ? "flex justify-between gap-3 font-semibold" : "flex justify-between gap-3"}><span className="text-muted-foreground">{k}</span><span className="shrink-0">{v}</span></div>;
}
