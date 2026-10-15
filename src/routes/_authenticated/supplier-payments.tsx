import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bdToday, errMsg, taka } from "@/lib/format";
import { PAY_METHODS, type PayMethod } from "@/lib/pos";
import { supplierBalances } from "@/lib/supplier";

export const Route = createFileRoute("/_authenticated/supplier-payments")({
  head: () => ({
    meta: [
      { title: "Supplier Payments — Pharmacy POS" },
      { name: "description", content: "Pay supplier balances and see payment history." },
      { property: "og:title", content: "Supplier Payments — Pharmacy POS" },
      { property: "og:description", content: "Pay supplier balances." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupplierPayments,
});

function SupplierPayments() {
  const { role } = Route.useRouteContext();
  const qc = useQueryClient();
  const today = bdToday();
  const [f, setF] = useState({ supplier: "", amount: "", method: "cash" as PayMethod, date: today, note: "" });
  const [key, setKey] = useState(() => crypto.randomUUID());

  const data = useQuery({
    queryKey: ["supplier-payments"],
    queryFn: async () => {
      const [s, p, h] = await Promise.all([
        supabase.from("suppliers").select("id, name").order("name"),
        supabase.from("purchases").select("supplier_id, total, paid"),
        supabase.from("supplier_payments").select("*, suppliers(name)").order("created_at", { ascending: false }).limit(200),
      ]);
      if (s.error) throw s.error;
      if (p.error) throw p.error;
      if (h.error) throw h.error;
      return { suppliers: s.data, bal: supplierBalances(p.data), history: h.data };
    },
  });

  const pay = useMutation({
    mutationFn: async () => {
      if (!f.supplier) throw new Error("Choose a supplier");
      const amt = Number(f.amount);
      if (!(amt > 0)) throw new Error("Enter an amount");
      const { error } = await supabase.rpc("pay_supplier", { p: { idempotency_key: key, supplier_id: f.supplier, amount: amt, method: f.method, payment_date: f.date, note: f.note } as never });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Supplier payment saved");
      setKey(crypto.randomUUID());
      setF({ ...f, amount: "", note: "" });
      for (const k of ["supplier-payments", "supplier-balances", "report"]) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (role !== "admin" && role !== "manager") return <p className="text-muted-foreground">Only managers can pay suppliers.</p>;

  const owing = (data.data?.suppliers ?? []).map((s) => ({ ...s, balance: data.data?.bal.get(s.id)?.balance ?? 0 })).filter((s) => s.balance > 0);
  const sel = owing.find((s) => s.id === f.supplier);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold">Supplier Payments</h1>
      <form className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end" onSubmit={(e) => { e.preventDefault(); pay.mutate(); }}>
        <div className="lg:col-span-2"><Label>Supplier</Label>
          <Select value={f.supplier} onValueChange={(v) => setF({ ...f, supplier: v })}>
            <SelectTrigger><SelectValue placeholder={owing.length ? "Choose supplier" : "No supplier balance"} /></SelectTrigger>
            <SelectContent>{owing.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · owe {taka(s.balance)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label htmlFor="pa">Amount (৳)</Label>
          <Input id="pa" type="number" step="0.01" min="0" max={sel?.balance} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          {sel && <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => setF({ ...f, amount: String(sel.balance) })}>Pay full {taka(sel.balance)}</button>}
        </div>
        <div><Label>Paid by</Label>
          <Select value={f.method} onValueChange={(v) => setF({ ...f, method: v as PayMethod })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PAY_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label htmlFor="pd">Date</Label><Input id="pd" type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <Button type="submit" disabled={pay.isPending}>{pay.isPending ? "Saving…" : "Save payment"}</Button>
        <div className="sm:col-span-2 lg:col-span-6"><Label htmlFor="pn">Note</Label><Input id="pn" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      </form>
      <p className="text-xs text-muted-foreground">Payments clear the oldest purchase first. Paying a supplier is cash going out — it does not change gross profit, because medicine cost is counted when it is sold.</p>
      <div className="rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>Paid by</TableHead><TableHead>Note</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.isLoading && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {!data.isLoading && !data.data?.history.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No supplier payments yet.</TableCell></TableRow>}
            {data.data?.history.map((h) => (
              <TableRow key={h.id}>
                <TableCell>{h.payment_date}</TableCell><TableCell>{h.suppliers?.name}</TableCell>
                <TableCell className="capitalize">{h.method}</TableCell><TableCell className="text-muted-foreground">{h.note}</TableCell>
                <TableCell className="text-right font-medium">{taka(h.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
